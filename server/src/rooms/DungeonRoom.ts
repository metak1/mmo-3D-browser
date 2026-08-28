import { Room, Client } from "@colyseus/core";
import {
  ACTIVE_DUNGEON,
  ActionFailedMessage,
  ActionFailReason,
  CastMessage,
  ChatMessage,
  DungeonSpawnDef,
  ENEMY_RESPAWN_MS,
  ENEMY_TYPES,
  EQUIP_SLOTS,
  GuildRosterSnapshot,
  INVENTORY_SIZE,
  InputMessage,
  LOOT_BAG_AGGREGATE_RADIUS,
  LOOT_BAG_DESPAWN_MS,
  LOOT_DROP_CHANCE,
  LOOT_PICKUP_RADIUS,
  LootTakeMessage,
  ITEM_IDS,
  decodeItemToken,
  encodeItemToken,
  resolveClassId,
  rollRarity,
} from "@mmo/shared";
import { verifyToken } from "../auth/jwt.js";
import { getCharacterForUser, saveCharacterProgress } from "../db/characters.js";
import * as friendsDb from "../db/friends.js";
import * as guildsDb from "../db/guilds.js";
import { EquippedItemIds, listCharacterItems, replaceCharacterItems } from "../db/items.js";
import { isOnline, notifyCharacter, registerOnline, SocialCapableRoom, unregisterOnline } from "../onlineRegistry.js";
import { handleChatMessage } from "./chat.js";
import { CombatEngine } from "./combat/CombatEngine.js";
import { getEquippedItemId, setEquippedItemId } from "./equipment.js";
import { DungeonState, Enemy, LootBag, Player } from "./schema/DungeonState.js";
import { FriendEntry, FriendRequestEntry, GuildInviteEntry } from "./schema/WorldState.js";

const SIMULATION_INTERVAL_MS = 1000 / 30;
const BOSS_GUARANTEED_DROPS = 3;

export class DungeonRoom extends Room<DungeonState> implements SocialCapableRoom {
  private combat!: CombatEngine;
  private characterIdBySession = new Map<string, number>();
  private lootBagSeq = 0;

  onCreate() {
    this.setState(new DungeonState());

    this.combat = new CombatEngine({
      state: this.state,
      onEnemyKilled: (enemyId, enemyTypeId, killerSessionId, x, z) =>
        this.handleEnemyKilled(enemyId, enemyTypeId, killerSessionId, x, z),
      onPlayerRespawn: (sessionId, player) => this.handlePlayerRespawn(sessionId, player),
      onCombatText: (event) => this.broadcast("combat_text", event),
      // No collidableStructures - a dungeon has none of its own, and STRUCTURES is the overworld's
      // global list at unrelated overworld coordinates (see WorldRoom's own comment on this flag).
      // No blockWaterTerrain either - a dungeon has no hex terrain of its own.
      enemiesWander: true,
    });

    // Every DungeonSpawnDef is live for the whole run from the moment it's created - no wave
    // gating, so the whole dungeon reads as one real space to fight through rather than a box that
    // dispenses enemies as you clear it. See spawnDungeonEnemy/handleEnemyKilled for how a killed
    // trash spawn respawns in place, and the boss (the one "boss"-behavior entry) doesn't.
    for (const point of ACTIVE_DUNGEON?.spawns ?? []) this.spawnDungeonEnemy(point);

    this.onMessage("input", (client, message: InputMessage) => this.combat.handleInput(client.sessionId, message));
    this.onMessage("cast", (client, message: CastMessage) => this.combat.handleCast(client, message));
    this.onMessage("loot_take", (client, message: LootTakeMessage) => this.handleLootTake(client, message));
    this.onMessage("chat", (client, message: ChatMessage) => handleChatMessage(this, client, message));
    this.onMessage("guild_leave", (client) => this.handleGuildLeave(client));
    this.onMessage("guild_roster_request", (client) => this.handleGuildRosterRequest(client));

    this.setSimulationInterval(() => this.combat.tick(SIMULATION_INTERVAL_MS / 1000), SIMULATION_INTERVAL_MS);
  }

  async onJoin(client: Client, options?: { token?: string; characterId?: number; partyId?: string }) {
    if (!options?.token || !options?.characterId) {
      throw new Error("Missing token or characterId");
    }

    let userId: number;
    try {
      userId = verifyToken(options.token).userId;
    } catch {
      throw new Error("Invalid or expired session");
    }

    const character = await getCharacterForUser(options.characterId, userId);
    if (!character) {
      throw new Error("Character not found");
    }

    const player = new Player();
    player.x = 0;
    player.y = 0;
    player.z = 0;
    player.name = character.name;
    // Carried over from the WorldRoom party that started this instance (see
    // WorldRoom.handleDungeonStart) - without this every dungeon Player defaults to the
    // schema's "" partyId, which reads client-side as "not grouped" and hides the party UI
    // the moment players arrive, even though they're the same party that queued together.
    player.partyId = options.partyId ?? "";
    player.classId = resolveClassId(character.class_id);
    player.level = character.level;
    player.xp = character.xp;
    player.mainStat = character.main_stat;
    player.vitality = character.vitality;
    player.luck = character.luck;
    player.armor = character.armor;
    player.gold = character.gold;
    player.talentPoints = character.talent_points;
    // Talent ranks matter for combat formulas (getTalentBonusFor) even though talents
    // aren't spendable mid-dungeon, so they're loaded read-only here.
    const savedRanks = (character.talent_ranks as Record<string, number>) ?? {};
    for (const [talentId, rank] of Object.entries(savedRanks)) {
      player.talentRanks.set(talentId, rank);
    }
    // Loaded read-only, same reasoning as talentRanks above - gathering/crafting/use-item aren't
    // available mid-dungeon (WorldRoom-only, matching how quest turn-in already is), but they
    // still need round-tripping through onLeave's saveCharacterProgress call unchanged, or that
    // unconditional UPDATE would silently wipe them back to {} in the DB.
    const savedProfessionXp = (character.profession_xp as Record<string, number>) ?? {};
    for (const [professionId, xp] of Object.entries(savedProfessionXp)) {
      player.professionXp.set(professionId, xp);
    }
    const savedProfessionLevel = (character.profession_level as Record<string, number>) ?? {};
    for (const [professionId, level] of Object.entries(savedProfessionLevel)) {
      player.professionLevel.set(professionId, level);
    }
    const savedMaterials = (character.materials as Record<string, number>) ?? {};
    for (const [itemId, count] of Object.entries(savedMaterials)) {
      player.materials.set(itemId, count);
    }
    player.hasMount = character.has_mount ?? false;

    const items = await listCharacterItems(character.id);
    for (const row of items) {
      if (row.slot) setEquippedItemId(player, row.slot, row.item_id);
      else player.inventory.push(row.item_id);
    }

    // Mid-dungeon, only the "who's a friend / what guild" facts matter - unlike WorldRoom's own
    // onJoin, pending friend requests/guild invites are skipped here since responding to a social
    // invite mid-run isn't a supported flow (see plan: guild management stays world-only for v1).
    const friendRows = await friendsDb.listFriends(character.id);
    for (const row of friendRows) {
      const entry = new FriendEntry();
      entry.characterId = row.character_id;
      entry.name = row.name;
      entry.level = row.level;
      entry.classId = row.class_id;
      entry.online = isOnline(row.character_id);
      player.friends.set(String(row.character_id), entry);
    }

    const guildMembership = await guildsDb.getGuildForCharacter(character.id);
    if (guildMembership) {
      player.guildId = guildMembership.guild_id;
      player.guildName = guildMembership.guild_name;
      player.guildRole = guildMembership.role;
    }

    this.combat.recomputeMaxHp(player);
    player.hp = player.maxHp;

    this.state.players.set(client.sessionId, player);
    this.characterIdBySession.set(client.sessionId, character.id);
    registerOnline({
      sessionId: client.sessionId,
      roomId: this.roomId,
      characterId: character.id,
      name: character.name,
      level: player.level,
      classId: player.classId,
    });
    for (const row of friendRows) {
      if (!isOnline(row.character_id)) continue;
      notifyCharacter(row.character_id, (room, sid) => room.applyFriendOnlineChange(sid, character.id, true));
    }
    console.log(`[DungeonRoom] ${client.sessionId} joined as ${character.name}`);
  }

  async onLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    const characterId = this.characterIdBySession.get(client.sessionId);
    if (characterId !== undefined) {
      unregisterOnline(characterId);
      if (player) {
        for (const friend of player.friends.values()) {
          notifyCharacter(friend.characterId, (room, sid) => room.applyFriendOnlineChange(sid, characterId, false));
        }
      }
    }
    if (player && characterId) {
      try {
        await saveCharacterProgress(characterId, {
          level: player.level,
          xp: player.xp,
          stats: { mainStat: player.mainStat, vitality: player.vitality, luck: player.luck, armor: player.armor },
          gold: player.gold,
          talentPoints: player.talentPoints,
          talentRanks: Object.fromEntries(player.talentRanks),
          questProgress: {},
          questCompleted: {},
          professionXp: Object.fromEntries(player.professionXp),
          professionLevel: Object.fromEntries(player.professionLevel),
          materials: Object.fromEntries(player.materials),
          hasMount: player.hasMount,
        });
      } catch (err) {
        console.error(`[DungeonRoom] failed to save character ${characterId}:`, err);
      }
    }

    this.combat.clearSessionTracking(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.characterIdBySession.delete(client.sessionId);
  }

  private spawnDungeonEnemy(point: DungeonSpawnDef) {
    const enemyType = ENEMY_TYPES[point.enemyTypeId];
    if (!enemyType) return; // admin deleted/renamed this enemy type after the spawn point was authored

    const enemy = new Enemy();
    enemy.enemyTypeId = point.enemyTypeId;
    enemy.behavior = enemyType.behavior;
    enemy.x = point.x;
    enemy.z = point.z;
    enemy.homeX = point.x;
    enemy.homeZ = point.z;
    enemy.hp = enemyType.stats.maxHp;
    enemy.maxHp = enemyType.stats.maxHp;
    this.state.enemies.set(point.id, enemy);
  }

  // CombatEngine hook: called once an enemy's hp hits 0 (already removed from state by then).
  private handleEnemyKilled(enemyId: string, enemyTypeId: string, _killerSessionId: string, x: number, z: number) {
    const enemyType = ENEMY_TYPES[enemyTypeId];
    if (!enemyType) return;

    for (const player of this.state.players.values()) {
      this.combat.grantXp(player, enemyType.xpReward);
      player.gold += enemyType.goldReward;
    }

    if (enemyType.behavior === "boss") {
      for (let i = 0; i < BOSS_GUARANTEED_DROPS; i++) this.maybeDropLoot(x, z, true);
      this.state.cleared = true;
    } else {
      this.maybeDropLoot(x, z, false);
      // Same respawn-in-place contract as the overworld's SPAWN_POINTS (WorldRoom.spawnEnemy) -
      // doesn't match anything for a boss's own add spawns (their ids are `add-...`, never a
      // DungeonSpawnDef id), so those correctly never respawn either.
      const point = ACTIVE_DUNGEON?.spawns.find((p) => p.id === enemyId);
      if (point) this.clock.setTimeout(() => this.spawnDungeonEnemy(point), point.respawnMs ?? ENEMY_RESPAWN_MS);
    }
  }

  // CombatEngine hook: called after a dead player's hp/ailments/cast have already been reset.
  private handlePlayerRespawn(_sessionId: string, player: Player) {
    player.x = 0;
    player.y = 0;
    player.z = 0;
  }

  private maybeDropLoot(x: number, z: number, guaranteed: boolean) {
    if (!guaranteed && Math.random() >= LOOT_DROP_CHANCE) return;
    const itemId = ITEM_IDS[Math.floor(Math.random() * ITEM_IDS.length)];
    this.dropLoot(x, z, encodeItemToken(itemId, rollRarity()));
  }

  private dropLoot(x: number, z: number, itemId: string) {
    for (const bag of this.state.lootBags.values()) {
      const dist = Math.hypot(bag.x - x, bag.z - z);
      if (dist <= LOOT_BAG_AGGREGATE_RADIUS) {
        bag.items.push(itemId);
        return;
      }
    }

    const bag = new LootBag();
    bag.x = x;
    bag.z = z;
    bag.items.push(itemId);

    const id = `bag-${this.lootBagSeq++}`;
    this.state.lootBags.set(id, bag);
    this.clock.setTimeout(() => this.state.lootBags.delete(id), LOOT_BAG_DESPAWN_MS);
  }

  // Sends an ActionFailedMessage back to just this one client - mirrors WorldRoom's own
  // rejectAction (each room keeps its own copy of handleLootTake, so this small helper is
  // duplicated too rather than sharing a base class for one line of behavior).
  private rejectAction(client: Client, reason: ActionFailReason) {
    const failure: ActionFailedMessage = { reason };
    client.send("action_failed", failure);
  }

  private handleLootTake(client: Client, message: LootTakeMessage) {
    const player = this.state.players.get(client.sessionId);
    const bag = this.state.lootBags.get(message.bagId);
    if (!player || !bag) return;

    const dist = Math.hypot(player.x - bag.x, player.z - bag.z);
    if (dist > LOOT_PICKUP_RADIUS) return this.rejectAction(client, "too_far");

    const index = bag.items.indexOf(message.itemId);
    if (index === -1) return this.rejectAction(client, "not_available");
    if (player.inventory.length >= INVENTORY_SIZE) return this.rejectAction(client, "inventory_full");

    bag.items.splice(index, 1);
    player.inventory.push(message.itemId);

    if (bag.items.length === 0) {
      this.state.lootBags.delete(message.bagId);
    }

    this.persistItems(client.sessionId);
  }

  private async persistItems(sessionId: string) {
    const player = this.state.players.get(sessionId);
    const characterId = this.characterIdBySession.get(sessionId);
    if (!player || !characterId) return;

    try {
      const equipped = Object.fromEntries(EQUIP_SLOTS.map((slot) => [slot, getEquippedItemId(player, slot)])) as EquippedItemIds;
      await replaceCharacterItems(characterId, [...player.inventory], equipped);
    } catch (err) {
      console.error(`[DungeonRoom] failed to persist items for character ${characterId}:`, err);
    }
  }

  // --- Guilds (leave/roster only - see plan: creation/invite/kick/promote/disband stay world-only) ---

  private async handleGuildLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    const characterId = this.characterIdBySession.get(client.sessionId);
    if (!player || characterId === undefined) return;
    if (player.guildId === 0) return;

    const guildId = player.guildId;
    const guildName = player.guildName;
    const wasLeader = player.guildRole === "leader";
    await guildsDb.removeGuildMember(characterId);
    player.guildId = 0;
    player.guildName = "";
    player.guildRole = "";

    if (wasLeader) {
      const promotedId = await guildsDb.promoteNextMemberAsLeader(guildId);
      if (promotedId === null) {
        await guildsDb.deleteGuild(guildId);
      } else {
        notifyCharacter(promotedId, (room, sid) => room.applyGuildFieldsChange(sid, guildId, guildName, "leader"));
      }
    }
  }

  private async handleGuildRosterRequest(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.guildId === 0) return;

    const members = await guildsDb.listGuildMembers(player.guildId);
    const snapshot: GuildRosterSnapshot = {
      guildId: player.guildId,
      guildName: player.guildName,
      members: members.map((m) => ({
        characterId: m.character_id,
        name: m.name,
        level: m.level,
        classId: m.class_id,
        role: m.role,
        online: isOnline(m.character_id),
      })),
    };
    client.send("guild_roster", snapshot);
  }

  // --- SocialCapableRoom (see onlineRegistry.ts's own doc comment - lets notifyCharacter reach a
  // specific online character's client regardless of which room instance currently holds them) ---

  applyFriendOnlineChange(sessionId: string, characterId: number, online: boolean) {
    const entry = this.state.players.get(sessionId)?.friends.get(String(characterId));
    if (entry) entry.online = online;
  }

  applyFriendRequestPush(sessionId: string, entry: { requestId: number; fromCharacterId: number; fromName: string }) {
    // Requests are irrelevant mid-dungeon (no accept/decline UI here) - the DB row still exists,
    // so it'll surface correctly on this character's next onJoin regardless of which room type.
    void sessionId;
    void entry;
  }

  applyFriendAdded(sessionId: string, entry: { characterId: number; name: string; level: number; classId: string; online: boolean }) {
    const player = this.state.players.get(sessionId);
    if (!player) return;
    const friendEntry = new FriendEntry();
    friendEntry.characterId = entry.characterId;
    friendEntry.name = entry.name;
    friendEntry.level = entry.level;
    friendEntry.classId = entry.classId;
    friendEntry.online = entry.online;
    player.friends.set(String(entry.characterId), friendEntry);
  }

  applyFriendRemoved(sessionId: string, characterId: number) {
    this.state.players.get(sessionId)?.friends.delete(String(characterId));
  }

  applyGuildInvitePush(sessionId: string, entry: { inviteId: number; guildId: number; guildName: string; invitedByName: string }) {
    // Same reasoning as applyFriendRequestPush - no accept/decline UI mid-dungeon.
    void sessionId;
    void entry;
  }

  applyGuildFieldsChange(sessionId: string, guildId: number, guildName: string, guildRole: string) {
    const player = this.state.players.get(sessionId);
    if (!player) return;
    player.guildId = guildId;
    player.guildName = guildName;
    player.guildRole = guildRole;
  }
}
