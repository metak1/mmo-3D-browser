import { Room, Client } from "@colyseus/core";
import {
  ACTIVE_DUNGEON,
  CastMessage,
  ChatMessage,
  DUNGEON_SPAWN_POSITION,
  DungeonSpawnDef,
  ENEMY_RESPAWN_MS,
  ENEMY_TYPES,
  EQUIP_SLOTS,
  InputMessage,
  LootTakeMessage,
  decodeItemToken,
  resolveClassId,
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
import { LootManager } from "./loot.js";
import { PersistQueue } from "./persistQueue.js";
import { respawnPlayerPosition } from "./roomUtil.js";
import { DungeonState, Enemy, Player } from "./schema/DungeonState.js";
import { FriendEntry } from "./schema/WorldState.js";
import { addFriendEntryToPlayer, handleGuildLeave, handleGuildRosterRequest, removeFriendEntry, setFriendOnline, setGuildFields } from "./social.js";

const SIMULATION_INTERVAL_MS = 1000 / 30;
const BOSS_GUARANTEED_DROPS = 3;

export class DungeonRoom extends Room<DungeonState> implements SocialCapableRoom {
  private combat!: CombatEngine;
  private loot!: LootManager;
  // Not private: read by the GuildCapableRoom structural interface (social.ts's
  // handleGuildLeave/handleGuildRosterRequest), same reasoning as WorldRoom's own field.
  characterIdBySession = new Map<string, number>();
  // See PersistQueue's own doc comment (persistItems + the onLeave save both go through this -
  // WorldRoom already had this guard, DungeonRoom didn't until now, which was a real gap: a loot
  // pickup right as a player disconnects could otherwise race the onLeave save and lose data).
  private persistQueue = new PersistQueue();

  onCreate() {
    this.setState(new DungeonState());

    this.combat = new CombatEngine({
      state: this.state,
      onEnemyKilled: (enemyId, enemyTypeId, killerSessionId, x, z) =>
        this.handleEnemyKilled(enemyId, enemyTypeId, killerSessionId, x, z),
      onPlayerRespawn: (_sessionId, player) => respawnPlayerPosition(player),
      onCombatText: (event) => this.broadcast("combat_text", event),
      // No collidableStructures - a dungeon has none of its own, and STRUCTURES is the overworld's
      // global list at unrelated overworld coordinates (see WorldRoom's own comment on this flag).
      // No blockWaterTerrain either - a dungeon has no hex terrain of its own.
      enemiesWander: true,
    });
    this.loot = new LootManager(this);

    // Every DungeonSpawnDef is live for the whole run from the moment it's created - no wave
    // gating, so the whole dungeon reads as one real space to fight through rather than a box that
    // dispenses enemies as you clear it. See spawnDungeonEnemy/handleEnemyKilled for how a killed
    // trash spawn respawns in place, and the boss (the one "boss"-behavior entry) doesn't.
    for (const point of ACTIVE_DUNGEON?.spawns ?? []) this.spawnDungeonEnemy(point);

    this.onMessage("input", (client, message: InputMessage) => this.combat.handleInput(client.sessionId, message));
    this.onMessage("cast", (client, message: CastMessage) => this.combat.handleCast(client, message));
    this.onMessage("loot_take", (client, message: LootTakeMessage) => this.loot.handleLootTake(client, message));
    this.onMessage("chat", (client, message: ChatMessage) => handleChatMessage(this, client, message));
    this.onMessage("guild_leave", (client) => handleGuildLeave(this, client));
    this.onMessage("guild_roster_request", (client) => handleGuildRosterRequest(this, client));

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
    // The admin-editable dungeon entry point (dungeon_ground's own spawn_x/spawn_z, edited via
    // the map editor's spawn marker the same way as the overworld's - see WorldRoom.onJoin's
    // identical use of SPAWN_POSITION) - defaults to (0,0), matching every existing fixed enemy
    // spawn in this dungeon's layout (see DUNGEON_SPAWN_POINTS), so this is a no-op until an
    // admin actually moves it.
    player.x = DUNGEON_SPAWN_POSITION.x;
    player.y = 0;
    player.z = DUNGEON_SPAWN_POSITION.z;
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
      await this.persistQueue.run(client.sessionId, async () => {
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
      });
    }

    this.combat.clearSessionTracking(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.characterIdBySession.delete(client.sessionId);
    this.persistQueue.clear(client.sessionId); // the save above already settled
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
      for (let i = 0; i < BOSS_GUARANTEED_DROPS; i++) this.loot.maybeDropLoot(x, z, true);
      this.state.cleared = true;
    } else {
      this.loot.maybeDropLoot(x, z, false);
      // Same respawn-in-place contract as the overworld's SPAWN_POINTS (WorldRoom.spawnEnemy) -
      // doesn't match anything for a boss's own add spawns (their ids are `add-...`, never a
      // DungeonSpawnDef id), so those correctly never respawn either.
      const point = ACTIVE_DUNGEON?.spawns.find((p) => p.id === enemyId);
      if (point) this.clock.setTimeout(() => this.spawnDungeonEnemy(point), point.respawnMs ?? ENEMY_RESPAWN_MS);
    }
  }

  async persistItems(sessionId: string) {
    return this.persistQueue.run(sessionId, async () => {
      const player = this.state.players.get(sessionId);
      const characterId = this.characterIdBySession.get(sessionId);
      if (!player || !characterId) return;

      try {
        const equipped = Object.fromEntries(EQUIP_SLOTS.map((slot) => [slot, getEquippedItemId(player, slot)])) as EquippedItemIds;
        await replaceCharacterItems(characterId, [...player.inventory], equipped);
      } catch (err) {
        console.error(`[DungeonRoom] failed to persist items for character ${characterId}:`, err);
      }
    });
  }

  // --- SocialCapableRoom (see onlineRegistry.ts's own doc comment - lets notifyCharacter reach a
  // specific online character's client regardless of which room instance currently holds them) ---

  applyFriendOnlineChange(sessionId: string, characterId: number, online: boolean) {
    setFriendOnline(this.state.players.get(sessionId), characterId, online);
  }

  applyFriendRequestPush(sessionId: string, entry: { requestId: number; fromCharacterId: number; fromName: string }) {
    // Requests are irrelevant mid-dungeon (no accept/decline UI here) - the DB row still exists,
    // so it'll surface correctly on this character's next onJoin regardless of which room type.
    void sessionId;
    void entry;
  }

  applyFriendAdded(sessionId: string, entry: { characterId: number; name: string; level: number; classId: string; online: boolean }) {
    const player = this.state.players.get(sessionId);
    if (player) addFriendEntryToPlayer(player, entry.characterId, entry.name, entry.level, entry.classId, entry.online);
  }

  applyFriendRemoved(sessionId: string, characterId: number) {
    removeFriendEntry(this.state.players.get(sessionId), characterId);
  }

  applyGuildInvitePush(sessionId: string, entry: { inviteId: number; guildId: number; guildName: string; invitedByName: string }) {
    // Same reasoning as applyFriendRequestPush - no accept/decline UI mid-dungeon.
    void sessionId;
    void entry;
  }

  applyGuildFieldsChange(sessionId: string, guildId: number, guildName: string, guildRole: string) {
    setGuildFields(this.state.players.get(sessionId), guildId, guildName, guildRole);
  }
}
