import { Room, Client, matchMaker } from "@colyseus/core";
import {
  AcceptQuestMessage,
  ALL_PROFESSIONS,
  BuyItemMessage,
  ChatMessage,
  CraftRecipeMessage,
  DUNGEON_PARTY_SIZE,
  DUNGEON_ROOM_NAME,
  DungeonJoinListingMessage,
  ENEMY_RESPAWN_MS,
  ENEMY_TYPES,
  EnemySpawnDef,
  EnemySpawnZoneDef,
  EquipMessage,
  EQUIP_SLOTS,
  ForgetProfessionMessage,
  FriendRemoveMessage,
  FriendRequestMessage,
  FriendRespondMessage,
  GatherNodeMessage,
  GATHER_INTERACT_RADIUS,
  GATHERING_NODES,
  GATHERING_NODE_TYPES,
  GuildCreateMessage,
  GuildInviteMessage,
  GuildKickMessage,
  GuildPromoteMessage,
  GuildRespondMessage,
  GUILD_NAME_MAX_LENGTH,
  INVENTORY_SIZE,
  ITEMS,
  InputMessage,
  LearnProfessionMessage,
  LootTakeMessage,
  MAX_LEARNED_PROFESSIONS,
  MAX_LEVEL,
  NPCS,
  NPC_INTERACT_RADIUS,
  PARTY_MAX_SIZE,
  PARTY_XP_SHARE_RADIUS,
  PartyInviteMessage,
  PartyRespondMessage,
  ProfessionId,
  QUESTS,
  RARITY_MULTIPLIER,
  RECIPES,
  RefundTalentMessage,
  SetTimeOfDayMessage,
  SPAWN_POINTS,
  SPAWN_ZONES,
  SellItemMessage,
  SpendTalentMessage,
  TALENTS,
  TimeOfDaySetBroadcast,
  TRADE_RANGE_CHECK_INTERVAL_MS,
  TradeOfferMessage,
  TradeRequestMessage,
  TradeRespondMessage,
  TurnInQuestMessage,
  UnequipMessage,
  VENDOR_SELL_FRACTION,
  UseItemMessage,
  SwapInventorySlotsMessage,
  WAYPOINTS,
  WAYPOINT_INTERACT_RADIUS,
  WaypointTravelMessage,
  CastMessage,
  decodeItemToken,
  encodeItemToken,
  hasRankedDependents,
  isTalentUnlocked,
  resolveClassId,
} from "@mmo/shared";
import { verifyToken } from "../auth/jwt.js";
import { findCharacterByName, getCharacterById, getCharacterForUser, saveCharacterProgress } from "../db/characters.js";
import * as friendsDb from "../db/friends.js";
import * as guildsDb from "../db/guilds.js";
import { EquippedItemIds, listCharacterItems, replaceCharacterItems } from "../db/items.js";
import { isUniqueViolation } from "../db/client.js";
import { findUserRoleById } from "../db/users.js";
import { getOnlineEntry, isOnline, notifyCharacter, registerOnline, SocialCapableRoom, unregisterOnline } from "../onlineRegistry.js";
import { handleChatMessage } from "./chat.js";
import { CombatEngine } from "./combat/CombatEngine.js";
import { getEquippedItemId, setEquippedItemId } from "./equipment.js";
import { LootManager } from "./loot.js";
import { PersistQueue } from "./persistQueue.js";
import { rejectAction, respawnPlayerPosition } from "./roomUtil.js";
import { DungeonListing, Enemy, FriendEntry, FriendRequestEntry, GatheringNode, GuildInviteEntry, Player, WorldState } from "./schema/WorldState.js";
import { addFriendEntryToPlayer, handleGuildLeave, handleGuildRosterRequest, removeFriendEntry, setFriendOnline, setGuildFields } from "./social.js";
import { TradeManager } from "./trade.js";

const SIMULATION_INTERVAL_MS = 1000 / 30;
const AUTOSAVE_INTERVAL_MS = 30_000;
const BOSS_GUARANTEED_DROPS = 3; // bypasses LOOT_DROP_CHANCE - a group should always walk away with something

export class WorldRoom extends Room<WorldState> implements SocialCapableRoom {
  private combat!: CombatEngine;
  private trade!: TradeManager;
  private loot!: LootManager;
  // Not private: read by the GuildCapableRoom structural interface (social.ts's
  // handleGuildLeave/handleGuildRosterRequest), same reasoning as TradeCapableRoom's own fields.
  characterIdBySession = new Map<string, number>();
  private tokenBySession = new Map<string, string>(); // kept for re-use when reserving dungeon seats
  // See PersistQueue's own doc comment for why every persistItems/saveCharacter call is chained
  // through this instead of fired off directly.
  private persistQueue = new PersistQueue();
  // Which zone a given state.enemies slot key belongs to - populated once per slot at onCreate
  // (see the SPAWN_ZONES loop below) and read again on every respawn, so membership survives a
  // slot's whole death/respawn cycle for the life of the room (mirrors why SPAWN_POINTS.find(...)
  // works for point spawns: the lookup key is stable for as long as the room exists).
  private zoneBySlotKey = new Map<string, EnemySpawnZoneDef>();

  onCreate() {
    this.setState(new WorldState());

    this.combat = new CombatEngine({
      state: this.state,
      onEnemyKilled: (enemyId, enemyTypeId, killerSessionId, x, z) =>
        this.handleEnemyKilled(enemyId, enemyTypeId, killerSessionId, x, z),
      onPlayerRespawn: (_sessionId, player) => respawnPlayerPosition(player),
      onCombatText: (event) => this.broadcast("combat_text", event),
      collidableStructures: true,
      enemiesWander: true,
      blockWaterTerrain: true,
      collidableFurniture: true,
    });
    this.trade = new TradeManager(this);
    this.loot = new LootManager(this);

    for (const point of SPAWN_POINTS) {
      this.spawnEnemy(point);
    }

    // Each zone gets `maxPopulation` stable slot keys (zoneId::0, zoneId::1, ...) so its
    // membership map (used by handleEnemyKilled's respawn dispatch below) stays populated across
    // however many times that slot dies and respawns, not just its first spawn.
    for (const zone of SPAWN_ZONES) {
      for (let i = 0; i < zone.maxPopulation; i++) {
        const slotKey = `${zone.id}::${i}`;
        this.zoneBySlotKey.set(slotKey, zone);
        this.spawnZoneMember(zone, slotKey);
      }
    }

    for (const point of GATHERING_NODES) {
      if (!GATHERING_NODE_TYPES[point.nodeTypeId]) continue; // admin deleted/renamed the type after this node was placed
      const node = new GatheringNode();
      node.nodeTypeId = point.nodeTypeId;
      node.x = point.x;
      node.z = point.z;
      this.state.gatheringNodes.set(point.id, node);
    }

    this.onMessage("input", (client, message: InputMessage) => this.combat.handleInput(client.sessionId, message));
    this.onMessage("cast", (client, message: CastMessage) => this.combat.handleCast(client, message));
    this.onMessage("loot_take", (client, message: LootTakeMessage) => this.loot.handleLootTake(client, message));
    this.onMessage("equip", (client, message: EquipMessage) => this.handleEquip(client, message));
    this.onMessage("unequip", (client, message: UnequipMessage) => this.handleUnequip(client, message));
    this.onMessage("spend_talent", (client, message: SpendTalentMessage) => this.handleSpendTalent(client, message));
    this.onMessage("refund_talent", (client, message: RefundTalentMessage) => this.handleRefundTalent(client, message));
    this.onMessage("accept_quest", (client, message: AcceptQuestMessage) => this.handleAcceptQuest(client, message));
    this.onMessage("turn_in_quest", (client, message: TurnInQuestMessage) => this.handleTurnInQuest(client, message));
    this.onMessage("buy_item", (client, message: BuyItemMessage) => this.handleBuyItem(client, message));
    this.onMessage("sell_item", (client, message: SellItemMessage) => this.handleSellItem(client, message));
    this.onMessage("party_invite", (client, message: PartyInviteMessage) => this.handlePartyInvite(client, message));
    this.onMessage("party_respond", (client, message: PartyRespondMessage) => this.handlePartyRespond(client, message));
    this.onMessage("party_leave", (client) => this.handlePartyLeave(client));
    this.onMessage("dungeon_open_listing", (client) => this.handleDungeonOpenListing(client));
    this.onMessage("dungeon_close_listing", (client) => this.handleDungeonCloseListing(client));
    this.onMessage("dungeon_join_listing", (client, message: DungeonJoinListingMessage) =>
      this.handleDungeonJoinListing(client, message),
    );
    this.onMessage("dungeon_start", (client) => this.handleDungeonStart(client));
    this.onMessage("chat", (client, message: ChatMessage) => handleChatMessage(this, client, message));
    this.onMessage("set_time_of_day", (client, message: SetTimeOfDayMessage) => this.handleSetTimeOfDay(client, message));
    this.onMessage("trade_request", (client, message: TradeRequestMessage) => this.trade.handleRequest(client, message));
    this.onMessage("trade_respond", (client, message: TradeRespondMessage) => this.trade.handleRespond(client, message));
    this.onMessage("trade_offer", (client, message: TradeOfferMessage) => this.trade.handleOffer(client, message));
    this.onMessage("trade_accept", (client) => this.trade.handleAccept(client));
    this.onMessage("trade_cancel", (client) => this.trade.handleCancel(client));
    this.onMessage("waypoint_travel", (client, message: WaypointTravelMessage) => this.handleWaypointTravel(client, message));
    this.onMessage("learn_profession", (client, message: LearnProfessionMessage) => this.handleLearnProfession(client, message));
    this.onMessage("forget_profession", (client, message: ForgetProfessionMessage) => this.handleForgetProfession(client, message));
    this.onMessage("gather_node", (client, message: GatherNodeMessage) => this.handleGatherNode(client, message));
    this.onMessage("craft_recipe", (client, message: CraftRecipeMessage) => this.handleCraftRecipe(client, message));
    this.onMessage("use_item", (client, message: UseItemMessage) => this.handleUseItem(client, message));
    this.onMessage("swap_inventory_slots", (client, message: SwapInventorySlotsMessage) => this.handleSwapInventorySlots(client, message));
    this.onMessage("toggle_mount", (client) => this.handleToggleMount(client));
    this.onMessage("friend_request", (client, message: FriendRequestMessage) => this.handleFriendRequest(client, message));
    this.onMessage("friend_respond", (client, message: FriendRespondMessage) => this.handleFriendRespond(client, message));
    this.onMessage("friend_remove", (client, message: FriendRemoveMessage) => this.handleFriendRemove(client, message));
    this.onMessage("guild_create", (client, message: GuildCreateMessage) => this.handleGuildCreate(client, message));
    this.onMessage("guild_invite", (client, message: GuildInviteMessage) => this.handleGuildInvite(client, message));
    this.onMessage("guild_respond", (client, message: GuildRespondMessage) => this.handleGuildRespond(client, message));
    this.onMessage("guild_leave", (client) => handleGuildLeave(this, client));
    this.onMessage("guild_kick", (client, message: GuildKickMessage) => this.handleGuildKick(client, message));
    this.onMessage("guild_promote", (client, message: GuildPromoteMessage) => this.handleGuildPromote(client, message));
    this.onMessage("guild_disband", (client) => this.handleGuildDisband(client));
    this.onMessage("guild_roster_request", (client) => handleGuildRosterRequest(this, client));

    this.setSimulationInterval(() => this.combat.tick(SIMULATION_INTERVAL_MS / 1000), SIMULATION_INTERVAL_MS);
    this.clock.setInterval(() => this.autosaveAll(), AUTOSAVE_INTERVAL_MS);
    this.clock.setInterval(() => this.trade.checkRanges(), TRADE_RANGE_CHECK_INTERVAL_MS);
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

    const classId = resolveClassId(character.class_id);

    const player = new Player();
    player.x = 0;
    player.y = 0;
    player.z = 0;
    player.name = character.name;
    // Restores a party that was already formed before entering a dungeon (see
    // DungeonRoom.onJoin's identical carry-through and the Leave Dungeon flow in main.ts) -
    // without this, returning from a dungeon silently drops everyone from their group even
    // though nothing about the party actually changed.
    player.partyId = options.partyId ?? "";
    player.classId = classId;
    player.level = character.level;
    player.xp = character.xp;
    player.mainStat = character.main_stat;
    player.vitality = character.vitality;
    player.luck = character.luck;
    player.armor = character.armor;
    player.gold = character.gold;
    player.talentPoints = character.talent_points;
    const savedRanks = (character.talent_ranks as Record<string, number>) ?? {};
    for (const [talentId, rank] of Object.entries(savedRanks)) {
      player.talentRanks.set(talentId, rank);
    }
    const savedQuestProgress = (character.quest_progress as Record<string, number>) ?? {};
    for (const [questId, count] of Object.entries(savedQuestProgress)) {
      player.questProgress.set(questId, count);
    }
    const savedQuestCompleted = (character.quest_completed as Record<string, number>) ?? {};
    for (const [questId, completedAt] of Object.entries(savedQuestCompleted)) {
      player.questCompleted.set(questId, completedAt);
    }
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
    player.hasMount = character.has_mount ?? false; // mounted itself never persists - always starts dismounted

    const items = await listCharacterItems(character.id);
    for (const row of items) {
      if (row.slot) setEquippedItemId(player, row.slot, row.item_id);
      else player.inventory.push(row.item_id);
    }

    // Friends/guild are real DB-persisted player data (see WorldState.ts's own doc comment on
    // FriendEntry) - hydrated here the same way inventory/quests already are above, not derived
    // from currently-connected sessions the way party is.
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
    for (const row of await friendsDb.listIncomingFriendRequests(character.id)) {
      const entry = new FriendRequestEntry();
      entry.requestId = row.id;
      entry.fromCharacterId = row.from_character_id;
      entry.fromName = row.from_name;
      player.pendingFriendRequests.push(entry);
    }

    const guildMembership = await guildsDb.getGuildForCharacter(character.id);
    if (guildMembership) {
      player.guildId = guildMembership.guild_id;
      player.guildName = guildMembership.guild_name;
      player.guildRole = guildMembership.role;
    } else {
      // Pending invites are only meaningful while guildless - a character already in a guild
      // has no way to accept a second one (see handleGuildRespond), so there's nothing to show.
      for (const row of await guildsDb.listIncomingGuildInvites(character.id)) {
        const entry = new GuildInviteEntry();
        entry.inviteId = row.id;
        entry.guildId = row.guild_id;
        entry.guildName = row.guild_name;
        entry.invitedByName = row.invited_by_name;
        player.pendingGuildInvites.push(entry);
      }
    }

    this.combat.recomputeMaxHp(player);
    player.hp = player.maxHp;

    this.state.players.set(client.sessionId, player);
    this.characterIdBySession.set(client.sessionId, character.id);
    this.tokenBySession.set(client.sessionId, options.token);
    registerOnline({ sessionId: client.sessionId, roomId: this.roomId, characterId: character.id, name: character.name, level: player.level, classId });
    // Let already-online friends know I've come online too - a live nicety layered on top of the
    // DB-derived state above (see onlineRegistry's own doc comment on this always being
    // best-effort, never the source of truth).
    for (const row of friendRows) {
      if (!isOnline(row.character_id)) continue;
      notifyCharacter(row.character_id, (room, sid) => room.applyFriendOnlineChange(sid, character.id, true));
    }
    console.log(`[WorldRoom] ${client.sessionId} joined as ${character.name} (${classId}, lv ${player.level})`);
  }

  async onLeave(client: Client) {
    await this.saveCharacter(client.sessionId);

    const leavingPlayer = this.state.players.get(client.sessionId);
    if (leavingPlayer) this.removeFromParty(leavingPlayer);
    this.trade.handleLeave(client.sessionId);

    const characterId = this.characterIdBySession.get(client.sessionId);
    if (characterId !== undefined) {
      unregisterOnline(characterId);
      if (leavingPlayer) {
        for (const friend of leavingPlayer.friends.values()) {
          notifyCharacter(friend.characterId, (room, sid) => room.applyFriendOnlineChange(sid, characterId, false));
        }
      }
    }

    this.combat.clearSessionTracking(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.characterIdBySession.delete(client.sessionId);
    this.tokenBySession.delete(client.sessionId);
    this.persistQueue.clear(client.sessionId); // the final saveCharacter above already settled
    console.log(`[WorldRoom] ${client.sessionId} left`);
  }

  async saveCharacter(sessionId: string) {
    return this.persistQueue.run(sessionId, async () => {
      const player = this.state.players.get(sessionId);
      const characterId = this.characterIdBySession.get(sessionId);
      if (!player || !characterId) return;

      try {
        await saveCharacterProgress(characterId, {
          level: player.level,
          xp: player.xp,
          stats: {
            mainStat: player.mainStat,
            vitality: player.vitality,
            luck: player.luck,
            armor: player.armor,
          },
          gold: player.gold,
          talentPoints: player.talentPoints,
          talentRanks: Object.fromEntries(player.talentRanks),
          questProgress: Object.fromEntries(player.questProgress),
          questCompleted: Object.fromEntries(player.questCompleted),
          professionXp: Object.fromEntries(player.professionXp),
          professionLevel: Object.fromEntries(player.professionLevel),
          materials: Object.fromEntries(player.materials),
          hasMount: player.hasMount,
        });
      } catch (err) {
        console.error(`[WorldRoom] failed to save character ${characterId}:`, err);
      }
    });
  }

  private async autosaveAll() {
    for (const sessionId of this.characterIdBySession.keys()) {
      await this.saveCharacter(sessionId);
    }
  }

  async persistItems(sessionId: string) {
    return this.persistQueue.run(sessionId, async () => {
      const player = this.state.players.get(sessionId);
      const characterId = this.characterIdBySession.get(sessionId);
      if (!player || !characterId) return;

      try {
        const equipped = Object.fromEntries(
          EQUIP_SLOTS.map((slot) => [slot, getEquippedItemId(player, slot)]),
        ) as EquippedItemIds;
        await replaceCharacterItems(characterId, [...player.inventory], equipped);
      } catch (err) {
        console.error(`[WorldRoom] failed to persist items for character ${characterId}:`, err);
      }
    });
  }

  private spawnEnemy(point: EnemySpawnDef) {
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

  // Spawns (or respawns) one population slot of a zone: rolls a random enemy type from its pool
  // and a random clear point within its radius (via CombatEngine's findClearPointNear - the same
  // retry-against-colliders logic wander legs already use), then sets that point as the enemy's
  // own home so the existing wander/leash code in CombatEngine treats it exactly like any other
  // enemy from here on, independent of the zone itself.
  private spawnZoneMember(zone: EnemySpawnZoneDef, slotKey: string) {
    if (zone.enemyTypeIds.length === 0) return; // pool not configured yet - nothing to spawn
    const enemyTypeId = zone.enemyTypeIds[Math.floor(Math.random() * zone.enemyTypeIds.length)];
    const enemyType = ENEMY_TYPES[enemyTypeId];
    if (!enemyType) return; // admin deleted/renamed this enemy type after the zone was authored

    const { x, z } = this.combat.findClearPointNear(zone.x, zone.z, zone.radius);
    const enemy = new Enemy();
    enemy.enemyTypeId = enemyTypeId;
    enemy.behavior = enemyType.behavior;
    enemy.x = x;
    enemy.z = z;
    enemy.homeX = x;
    enemy.homeZ = z;
    enemy.hp = enemyType.stats.maxHp;
    enemy.maxHp = enemyType.stats.maxHp;
    enemy.wanderRadius = zone.wanderRadius ?? 0;
    enemy.leashRange = zone.leashRange ?? 0;
    this.state.enemies.set(slotKey, enemy);
  }

  // CombatEngine hook: called once an enemy's hp hits 0 (already removed from state by then).
  private handleEnemyKilled(enemyId: string, enemyTypeId: string, killerSessionId: string, x: number, z: number) {
    this.grantKillRewards(killerSessionId, enemyTypeId, x, z);
    if (ENEMY_TYPES[enemyTypeId]?.behavior === "boss") {
      for (let i = 0; i < BOSS_GUARANTEED_DROPS; i++) this.loot.maybeDropLoot(x, z, true);
    } else {
      this.loot.maybeDropLoot(x, z, false);
    }

    const point = SPAWN_POINTS.find((p) => p.id === enemyId);
    if (point) {
      this.clock.setTimeout(() => this.spawnEnemy(point), point.respawnMs ?? ENEMY_RESPAWN_MS);
      return;
    }

    const zone = this.zoneBySlotKey.get(enemyId);
    if (zone) this.clock.setTimeout(() => this.spawnZoneMember(zone, enemyId), zone.respawnMs ?? ENEMY_RESPAWN_MS);
  }

  // Every party member within PARTY_XP_SHARE_RADIUS of the kill (and alive) gets the same
  // XP/quest credit the killer would get solo - not a split pool, just shared credit for
  // being nearby. Degrades to exactly the old single-killer behavior when partyId is empty.
  private grantKillRewards(killerSessionId: string, enemyTypeId: string, x: number, z: number) {
    const killer = this.state.players.get(killerSessionId);
    const enemyType = ENEMY_TYPES[enemyTypeId];
    if (!killer || !enemyType) return;

    for (const player of this.partyMembersNear(killer, x, z)) {
      this.combat.grantXp(player, enemyType.xpReward);
      player.gold += enemyType.goldReward;
      this.progressQuestKills(player, enemyTypeId);
    }
  }

  private countPartyMembers(partyId: string): number {
    let count = 0;
    for (const player of this.state.players.values()) {
      if (player.partyId === partyId) count++;
    }
    return count;
  }

  private partyMembersNear(player: Player, x: number, z: number): Player[] {
    const result: Player[] = [player];
    if (!player.partyId) return result;

    for (const other of this.state.players.values()) {
      if (other === player) continue;
      if (other.partyId !== player.partyId) continue;
      if (other.hp <= 0) continue;
      if (Math.hypot(other.x - x, other.z - z) > PARTY_XP_SHARE_RADIUS) continue;
      result.push(other);
    }
    return result;
  }

  // Clears partyId; if at most one member of that party remains afterward, clears theirs
  // too (a "party" of 1 isn't a party) and drops any dungeon listing tied to that partyId,
  // since it no longer refers to a real group. Called from party_leave and from onLeave.
  private removeFromParty(player: Player) {
    const partyId = player.partyId;
    if (!partyId) return;
    player.partyId = "";

    const remaining = [...this.state.players.values()].filter((p) => p.partyId === partyId);
    if (remaining.length <= 1) {
      if (remaining.length === 1) remaining[0].partyId = "";
      this.state.dungeonListings.delete(partyId);
    }
  }

  private handlePartyInvite(client: Client, message: PartyInviteMessage) {
    const inviter = this.state.players.get(client.sessionId);
    const target = this.state.players.get(message.targetSessionId);
    if (!inviter || !target || target === inviter) return;
    if (inviter.partyId && inviter.partyId === target.partyId) return; // already grouped together
    // Refuse to bridge two already-established (different) parties - merging would require
    // re-keying every existing member of one side, which this simple model doesn't support
    // (the dungeon finder's "join a listing" flow does support that, scoped to itself).
    if (inviter.partyId && target.partyId && inviter.partyId !== target.partyId) return;

    const existingPartyId = inviter.partyId || target.partyId;
    if (existingPartyId && this.countPartyMembers(existingPartyId) >= PARTY_MAX_SIZE) return;

    target.pendingPartyInviteFrom = client.sessionId;
  }

  private handlePartyRespond(client: Client, message: PartyRespondMessage) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const inviterSessionId = player.pendingPartyInviteFrom;
    if (!inviterSessionId) return;
    player.pendingPartyInviteFrom = "";
    if (!message.accept) return;

    const inviter = this.state.players.get(inviterSessionId);
    if (!inviter) return; // inviter disconnected between inviting and being accepted
    if (inviter.partyId && player.partyId && inviter.partyId !== player.partyId) return; // see handlePartyInvite

    // Whichever side already has a party anchors the merge - the inviter usually does, but
    // e.g. a solo player inviting someone who's already grouped must join THEIR party, not
    // overwrite it with a fresh one anchored on the inviter.
    const partyId = inviter.partyId || player.partyId || inviterSessionId;
    if (this.countPartyMembers(partyId) >= PARTY_MAX_SIZE) return;

    inviter.partyId = partyId;
    player.partyId = partyId;
  }

  private handlePartyLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    this.removeFromParty(player);
  }

  // --- Friends ---

  // Adds the friendship in the DB and reflects it live on both sides - shared by the explicit-
  // accept path (handleFriendRespond) and the auto-accept path (handleFriendRequest, when the
  // target already sent a reverse request).
  private async finalizeFriendship(selfPlayer: Player, selfCharacterId: number, otherCharacterId: number, otherName: string, otherLevel: number, otherClassId: string) {
    await friendsDb.addFriendship(selfCharacterId, otherCharacterId);
    addFriendEntryToPlayer(selfPlayer, otherCharacterId, otherName, otherLevel, otherClassId, isOnline(otherCharacterId));
    notifyCharacter(otherCharacterId, (room, sid) =>
      room.applyFriendAdded(sid, { characterId: selfCharacterId, name: selfPlayer.name, level: selfPlayer.level, classId: selfPlayer.classId, online: true }),
    );
  }

  private async handleFriendRequest(client: Client, message: FriendRequestMessage) {
    const player = this.state.players.get(client.sessionId);
    const fromCharacterId = this.characterIdBySession.get(client.sessionId);
    if (!player || fromCharacterId === undefined) return;

    const targetName = message.targetName.trim();
    if (!targetName) return;
    const target = await findCharacterByName(targetName);
    if (!target || target.id === fromCharacterId) return rejectAction(client, "not_found");
    if (await friendsDb.areFriends(fromCharacterId, target.id)) return rejectAction(client, "already_friends");

    // If the target already sent *me* a request, accept it instead of creating a redundant
    // reverse row - two people friend-requesting each other should just become friends.
    const reverseRequest = await friendsDb.findRequestBetween(target.id, fromCharacterId);
    if (reverseRequest) {
      await friendsDb.deleteFriendRequest(reverseRequest.id);
      await this.finalizeFriendship(player, fromCharacterId, target.id, target.name, target.level, target.class_id);
      return;
    }

    let created: { id: number };
    try {
      created = await friendsDb.createFriendRequest(fromCharacterId, target.id);
    } catch (err) {
      if (isUniqueViolation(err)) return rejectAction(client, "already_pending");
      throw err;
    }
    notifyCharacter(target.id, (room, sid) =>
      room.applyFriendRequestPush(sid, { requestId: created.id, fromCharacterId, fromName: player.name }),
    );
  }

  private async handleFriendRespond(client: Client, message: FriendRespondMessage) {
    const player = this.state.players.get(client.sessionId);
    const selfCharacterId = this.characterIdBySession.get(client.sessionId);
    if (!player || selfCharacterId === undefined) return;

    const index = player.pendingFriendRequests.findIndex((r) => r.requestId === message.requestId);
    if (index === -1) return; // stale/already-resolved request - silent no-op, mirrors handlePartyRespond
    const request = player.pendingFriendRequests[index];
    player.pendingFriendRequests.splice(index, 1);
    await friendsDb.deleteFriendRequest(message.requestId);
    if (!message.accept) return;

    const fromCharacter = await getCharacterById(request.fromCharacterId);
    if (!fromCharacter) return; // requester's account no longer exists - nothing sane to do
    await this.finalizeFriendship(player, selfCharacterId, fromCharacter.id, fromCharacter.name, fromCharacter.level, fromCharacter.class_id);
  }

  private async handleFriendRemove(client: Client, message: FriendRemoveMessage) {
    const player = this.state.players.get(client.sessionId);
    const selfCharacterId = this.characterIdBySession.get(client.sessionId);
    if (!player || selfCharacterId === undefined) return;
    if (!player.friends.has(String(message.characterId))) return;

    await friendsDb.removeFriendship(selfCharacterId, message.characterId);
    player.friends.delete(String(message.characterId));
    notifyCharacter(message.characterId, (room, sid) => room.applyFriendRemoved(sid, selfCharacterId));
  }

  // --- Guilds ---

  private async handleGuildCreate(client: Client, message: GuildCreateMessage) {
    const player = this.state.players.get(client.sessionId);
    const characterId = this.characterIdBySession.get(client.sessionId);
    if (!player || characterId === undefined) return;
    if (player.guildId !== 0) return rejectAction(client, "already_in_guild");

    const name = message.name.trim().slice(0, GUILD_NAME_MAX_LENGTH);
    if (!name) return;

    let guild: { id: number; name: string };
    try {
      guild = await guildsDb.createGuild(name, characterId);
    } catch (err) {
      if (isUniqueViolation(err)) return rejectAction(client, "name_taken");
      throw err;
    }

    player.guildId = guild.id;
    player.guildName = guild.name;
    player.guildRole = "leader";
  }

  private async handleGuildInvite(client: Client, message: GuildInviteMessage) {
    const player = this.state.players.get(client.sessionId);
    const characterId = this.characterIdBySession.get(client.sessionId);
    if (!player || characterId === undefined) return;
    if (player.guildRole !== "leader") return rejectAction(client, "not_leader");

    const targetName = message.targetName.trim();
    if (!targetName) return;
    const target = await findCharacterByName(targetName);
    if (!target) return rejectAction(client, "not_found");
    if (await guildsDb.getGuildForCharacter(target.id)) return rejectAction(client, "already_in_guild");

    let invite: { id: number };
    try {
      invite = await guildsDb.createGuildInvite(player.guildId, target.id, characterId);
    } catch (err) {
      if (isUniqueViolation(err)) return rejectAction(client, "already_pending");
      throw err;
    }
    notifyCharacter(target.id, (room, sid) =>
      room.applyGuildInvitePush(sid, { inviteId: invite.id, guildId: player.guildId, guildName: player.guildName, invitedByName: player.name }),
    );
  }

  private async handleGuildRespond(client: Client, message: GuildRespondMessage) {
    const player = this.state.players.get(client.sessionId);
    const characterId = this.characterIdBySession.get(client.sessionId);
    if (!player || characterId === undefined) return;

    const index = player.pendingGuildInvites.findIndex((i) => i.inviteId === message.inviteId);
    if (index === -1) return;
    const invite = player.pendingGuildInvites[index];
    player.pendingGuildInvites.splice(index, 1);
    await guildsDb.deleteGuildInvite(message.inviteId);
    if (!message.accept) return;
    if (player.guildId !== 0) return; // already joined a different guild in the meantime - stale accept, silent no-op

    try {
      await guildsDb.addGuildMember(invite.guildId, characterId, "member");
    } catch (err) {
      if (isUniqueViolation(err)) return; // race: joined elsewhere between the check above and this insert
      throw err;
    }
    await guildsDb.deleteOtherInvitesForCharacter(characterId, message.inviteId);
    // Every other pending invite is now stale (a character can only be in one guild) - clear them
    // from this client's own view too, not just the DB.
    player.pendingGuildInvites.splice(0, player.pendingGuildInvites.length);

    player.guildId = invite.guildId;
    player.guildName = invite.guildName;
    player.guildRole = "member";
  }

  private async handleGuildKick(client: Client, message: GuildKickMessage) {
    const player = this.state.players.get(client.sessionId);
    const characterId = this.characterIdBySession.get(client.sessionId);
    if (!player || characterId === undefined) return;
    if (player.guildRole !== "leader") return rejectAction(client, "not_leader");
    if (message.characterId === characterId) return; // use leave, not kick, on yourself

    await guildsDb.removeGuildMember(message.characterId);
    notifyCharacter(message.characterId, (room, sid) => room.applyGuildFieldsChange(sid, 0, "", ""));
  }

  private async handleGuildPromote(client: Client, message: GuildPromoteMessage) {
    const player = this.state.players.get(client.sessionId);
    const characterId = this.characterIdBySession.get(client.sessionId);
    if (!player || characterId === undefined) return;
    if (player.guildRole !== "leader") return rejectAction(client, "not_leader");
    if (message.characterId === characterId) return;

    await guildsDb.transferLeadership(player.guildId, characterId, message.characterId);
    player.guildRole = "member";
    notifyCharacter(message.characterId, (room, sid) => room.applyGuildFieldsChange(sid, player.guildId, player.guildName, "leader"));
  }

  private async handleGuildDisband(client: Client) {
    const player = this.state.players.get(client.sessionId);
    const characterId = this.characterIdBySession.get(client.sessionId);
    if (!player || characterId === undefined) return;
    if (player.guildRole !== "leader") return rejectAction(client, "not_leader");

    const guildId = player.guildId;
    const members = await guildsDb.listGuildMembers(guildId);
    await guildsDb.deleteGuild(guildId);

    for (const member of members) {
      if (member.character_id === characterId) continue; // self, handled below
      notifyCharacter(member.character_id, (room, sid) => room.applyGuildFieldsChange(sid, 0, "", ""));
    }
    player.guildId = 0;
    player.guildName = "";
    player.guildRole = "";
  }

  // --- SocialCapableRoom (see onlineRegistry.ts's own doc comment - lets notifyCharacter reach a
  // specific online character's client regardless of which room instance currently holds them) ---

  applyFriendOnlineChange(sessionId: string, characterId: number, online: boolean) {
    setFriendOnline(this.state.players.get(sessionId), characterId, online);
  }

  applyFriendRequestPush(sessionId: string, entry: { requestId: number; fromCharacterId: number; fromName: string }) {
    const player = this.state.players.get(sessionId);
    if (!player) return;
    const requestEntry = new FriendRequestEntry();
    requestEntry.requestId = entry.requestId;
    requestEntry.fromCharacterId = entry.fromCharacterId;
    requestEntry.fromName = entry.fromName;
    player.pendingFriendRequests.push(requestEntry);
  }

  applyFriendAdded(sessionId: string, entry: { characterId: number; name: string; level: number; classId: string; online: boolean }) {
    const player = this.state.players.get(sessionId);
    if (player) addFriendEntryToPlayer(player, entry.characterId, entry.name, entry.level, entry.classId, entry.online);
  }

  applyFriendRemoved(sessionId: string, characterId: number) {
    removeFriendEntry(this.state.players.get(sessionId), characterId);
  }

  applyGuildInvitePush(sessionId: string, entry: { inviteId: number; guildId: number; guildName: string; invitedByName: string }) {
    const player = this.state.players.get(sessionId);
    if (!player) return;
    const inviteEntry = new GuildInviteEntry();
    inviteEntry.inviteId = entry.inviteId;
    inviteEntry.guildId = entry.guildId;
    inviteEntry.guildName = entry.guildName;
    inviteEntry.invitedByName = entry.invitedByName;
    player.pendingGuildInvites.push(inviteEntry);
  }

  applyGuildFieldsChange(sessionId: string, guildId: number, guildName: string, guildRole: string) {
    setGuildFields(this.state.players.get(sessionId), guildId, guildName, guildRole);
  }

  // --- Dungeon finder ---

  private handleDungeonOpenListing(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    // Solo player opening a listing becomes a party of one, anchored on themself - same
    // self-anchoring convention the party system already uses for a freshly forming group.
    if (!player.partyId) player.partyId = client.sessionId;

    if (this.countPartyMembers(player.partyId) > DUNGEON_PARTY_SIZE) return; // could never fit
    if (this.state.dungeonListings.has(player.partyId)) return; // already listed

    const listing = new DungeonListing();
    listing.partyId = player.partyId;
    listing.leaderSessionId = client.sessionId;
    listing.createdAt = Date.now();
    this.state.dungeonListings.set(player.partyId, listing);
  }

  private handleDungeonCloseListing(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.partyId) return;
    this.state.dungeonListings.delete(player.partyId);
  }

  // The "tag onto a group" merge: every member of the joining party is re-keyed onto the
  // listing's partyId, bounded by a size check validated fully before any mutation happens
  // (so a rejected join never partially moves anyone).
  private handleDungeonJoinListing(client: Client, message: DungeonJoinListingMessage) {
    const player = this.state.players.get(client.sessionId);
    const listing = this.state.dungeonListings.get(message.partyId);
    if (!player || !listing) return;

    const oldPartyId = player.partyId;
    if (oldPartyId && oldPartyId === listing.partyId) return; // already in it

    const joiningMembers = oldPartyId
      ? [...this.state.players.values()].filter((p) => p.partyId === oldPartyId)
      : [player];

    const targetSize = this.countPartyMembers(listing.partyId);
    if (targetSize + joiningMembers.length > DUNGEON_PARTY_SIZE) return; // "except if it's full"

    for (const member of joiningMembers) member.partyId = listing.partyId;
    if (oldPartyId) this.state.dungeonListings.delete(oldPartyId); // stale - every prior member just moved
  }

  // Composition (1 tank / 1 healer / 2 dps) is only enforced here, not at join time - a
  // listing can be "not ready yet" the same way a real LFG lobby can be.
  private async handleDungeonStart(client: Client) {
    const caller = this.state.players.get(client.sessionId);
    if (!caller) return;

    // No composition or full-party requirement on purpose: an appropriately-built group of
    // 4 (tank/healer/2dps) is how the dungeon is *designed* to be played, but someone
    // sufficiently over-leveled/geared should be able to solo or duo-rush it instead of being
    // blocked from entering. A caller with no party (partyId "") just enters alone - "" is the
    // shared "ungrouped" sentinel, not a real party id, so it must never be used to filter.
    const members: [string, Player][] = caller.partyId
      ? [...this.state.players.entries()].filter(([, p]) => p.partyId === caller.partyId)
      : [[client.sessionId, caller]];
    if (members.length < 1 || members.length > DUNGEON_PARTY_SIZE) return;

    let roomCache;
    try {
      roomCache = await matchMaker.createRoom(DUNGEON_ROOM_NAME, {});
    } catch (err) {
      console.error("[WorldRoom] failed to create dungeon room:", err);
      return;
    }

    for (const [sessionId] of members) {
      const memberClient = this.clients.getById(sessionId);
      const token = this.tokenBySession.get(sessionId);
      const characterId = this.characterIdBySession.get(sessionId);
      if (!memberClient || !token || !characterId) continue;

      try {
        const reservation = await matchMaker.reserveSeatFor(roomCache, { token, characterId, partyId: caller.partyId });
        memberClient.send("dungeon_ready", reservation);
      } catch (err) {
        console.error(`[WorldRoom] failed to reserve a dungeon seat for ${sessionId}:`, err);
      }
    }

    this.state.dungeonListings.delete(caller.partyId);
  }

  // The "/time" chat command's GM tool (see main.ts's handleSlashCommand) - looked up fresh from
  // the DB on every call rather than a role cached at onJoin, same "a demotion takes effect
  // immediately" posture as the HTTP admin routes' own requireAdmin (adminMiddleware.ts). Broadcasts
  // to every client in the room (not just the caller) so a GM setting the time is something
  // everyone actually sees, not a private client-only preview.
  private async handleSetTimeOfDay(client: Client, message: SetTimeOfDayMessage) {
    const token = this.tokenBySession.get(client.sessionId);
    let userId: number;
    try {
      userId = token ? verifyToken(token).userId : -1;
    } catch {
      userId = -1;
    }
    const role = userId !== -1 ? await findUserRoleById(userId) : null;
    if (role !== "admin") return rejectAction(client, "not_admin");

    if (!Number.isFinite(message.fraction)) return;
    const fraction = ((message.fraction % 1) + 1) % 1;
    const payload: TimeOfDaySetBroadcast = { fraction };
    this.broadcast("time_of_day_set", payload);
  }

  private handleEquip(client: Client, message: EquipMessage) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const item = ITEMS[decodeItemToken(message.itemId).itemId];
    if (!item || !item.slot) return; // materials have no equip slot - not equippable

    const index = player.inventory.indexOf(message.itemId);
    if (index === -1) return;

    player.inventory.splice(index, 1);

    const previous = getEquippedItemId(player, item.slot);
    if (previous) player.inventory.push(previous);
    setEquippedItemId(player, item.slot, message.itemId);

    this.combat.recomputeMaxHp(player);
    this.persistItems(client.sessionId);
  }

  private handleUnequip(client: Client, message: UnequipMessage) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const itemId = getEquippedItemId(player, message.slot);
    if (!itemId) return;
    if (player.inventory.length >= INVENTORY_SIZE) return;

    setEquippedItemId(player, message.slot, "");
    player.inventory.push(itemId);

    this.combat.recomputeMaxHp(player);
    this.persistItems(client.sessionId);
  }

  private handleSpendTalent(client: Client, message: SpendTalentMessage) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (player.talentPoints <= 0) return;

    const def = TALENTS[message.talentId];
    if (!def || def.classId !== resolveClassId(player.classId)) return;
    if (!isTalentUnlocked(def.id, player.talentRanks)) return;

    const currentRank = player.talentRanks.get(def.id) ?? 0;
    if (currentRank >= def.maxRank) return;

    player.talentRanks.set(def.id, currentRank + 1);
    player.talentPoints -= 1;
    this.combat.recomputeMaxHp(player);
  }

  private handleRefundTalent(client: Client, message: RefundTalentMessage) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const def = TALENTS[message.talentId];
    if (!def || def.classId !== resolveClassId(player.classId)) return;

    const currentRank = player.talentRanks.get(def.id) ?? 0;
    if (currentRank <= 0) return;
    // Dropping to 0 would strand any already-spent talent that requires this one as its
    // prerequisite (unlocked node with a point in it, but the requirement no longer met) -
    // refuse rather than silently invalidating the dependent.
    if (currentRank === 1 && hasRankedDependents(def.id, player.talentRanks)) return;

    player.talentRanks.set(def.id, currentRank - 1);
    player.talentPoints += 1;
    this.combat.recomputeMaxHp(player);
  }

  // Materials share the same 20-slot pool as equipment: one map key = one slot, regardless of
  // stack size, so gaining more of a material type you already carry never needs a new slot -
  // only a brand-new material type does (mirrors how a new equipment item always needs one).
  private hasInventorySpaceFor(player: Player, materialItemId: string): boolean {
    if (player.materials.has(materialItemId)) return true;
    return player.inventory.length + player.materials.size < INVENTORY_SIZE;
  }

  private isNearNpc(player: Player, npcId: string): boolean {
    const npc = NPCS[npcId];
    if (!npc) return false;
    return Math.hypot(player.x - npc.x, player.z - npc.z) <= NPC_INTERACT_RADIUS;
  }

  // Requires standing within range of *some* waypoint (not necessarily the target) - same
  // "have to be at a flight master to use one" rule every waypoint system enforces, just without
  // any per-character discovery/unlock state to check alongside it (see shared's WAYPOINTS).
  private handleWaypointTravel(client: Client, message: WaypointTravelMessage) {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.hp <= 0) return;

    const target = WAYPOINTS.find((w) => w.id === message.targetWaypointId);
    if (!target) return;

    const nearAnyWaypoint = WAYPOINTS.some((w) => Math.hypot(player.x - w.x, player.z - w.z) <= WAYPOINT_INTERACT_RADIUS);
    if (!nearAnyWaypoint) return rejectAction(client, "too_far");

    player.x = target.x;
    player.y = 0;
    player.z = target.z;
  }

  private handleLearnProfession(client: Client, message: LearnProfessionMessage) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (!ALL_PROFESSIONS.includes(message.professionId)) return;

    const npc = NPCS[message.npcId];
    if (!npc || npc.teachesProfessionId !== message.professionId) return rejectAction(client, "not_available");
    if (!this.isNearNpc(player, message.npcId)) return rejectAction(client, "too_far");

    if (player.professionXp.has(message.professionId)) return rejectAction(client, "profession_already_learned");
    if (player.professionXp.size >= MAX_LEARNED_PROFESSIONS) return rejectAction(client, "profession_slots_full");

    player.professionXp.set(message.professionId, 0);
    player.professionLevel.set(message.professionId, 1);
  }

  // Free respec - no cost/confirmation. Materials already gathered/crafted stay in the bag either
  // way (only the xp/level track resets), so there's nothing destructive to gate here.
  private handleForgetProfession(client: Client, message: ForgetProfessionMessage) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    player.professionXp.delete(message.professionId);
    player.professionLevel.delete(message.professionId);
  }

  private handleGatherNode(client: Client, message: GatherNodeMessage) {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.hp <= 0) return;

    const node = this.state.gatheringNodes.get(message.nodeId);
    if (!node) return;

    const nodeType = GATHERING_NODE_TYPES[node.nodeTypeId];
    if (!nodeType) return; // content deleted/renamed after this node was placed

    if (Math.hypot(player.x - node.x, player.z - node.z) > GATHER_INTERACT_RADIUS) return rejectAction(client, "too_far");
    if (!node.available) return rejectAction(client, "not_available");
    if (!player.professionXp.has(nodeType.profession)) return rejectAction(client, "profession_not_learned");
    if ((player.professionLevel.get(nodeType.profession) ?? 0) < nodeType.requiredLevel) return rejectAction(client, "level_too_low");
    if (!this.hasInventorySpaceFor(player, nodeType.outputItemId)) return rejectAction(client, "inventory_full");

    node.available = false;
    player.materials.set(nodeType.outputItemId, (player.materials.get(nodeType.outputItemId) ?? 0) + nodeType.outputQuantity);
    this.combat.grantProfessionXp(player, nodeType.profession, nodeType.xpAward);

    this.clock.setTimeout(() => {
      node.available = true;
    }, nodeType.respawnMs);
  }

  private handleCraftRecipe(client: Client, message: CraftRecipeMessage) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const recipe = RECIPES[message.recipeId];
    if (!recipe) return;
    const outputItem = ITEMS[recipe.outputItemId];
    if (!outputItem) return;

    if (!player.professionXp.has(recipe.profession)) return rejectAction(client, "profession_not_learned");
    if ((player.professionLevel.get(recipe.profession) ?? 0) < recipe.requiredLevel) return rejectAction(client, "level_too_low");

    for (const ingredient of recipe.ingredients) {
      if ((player.materials.get(ingredient.itemId) ?? 0) < ingredient.quantity) return rejectAction(client, "insufficient_materials");
    }
    // Checked before consuming anything, so a full inventory never eats the ingredients on a
    // failed craft.
    if (outputItem.category === "equipment") {
      if (player.inventory.length >= INVENTORY_SIZE) return rejectAction(client, "inventory_full");
    } else if (!this.hasInventorySpaceFor(player, recipe.outputItemId)) {
      return rejectAction(client, "inventory_full");
    }

    for (const ingredient of recipe.ingredients) {
      const remaining = (player.materials.get(ingredient.itemId) ?? 0) - ingredient.quantity;
      if (remaining > 0) player.materials.set(ingredient.itemId, remaining);
      else player.materials.delete(ingredient.itemId);
    }

    if (outputItem.category === "equipment") {
      player.inventory.push(encodeItemToken(recipe.outputItemId, "common"));
      this.persistItems(client.sessionId);
    } else {
      player.materials.set(recipe.outputItemId, (player.materials.get(recipe.outputItemId) ?? 0) + recipe.outputQuantity);
    }

    this.combat.grantProfessionXp(player, recipe.profession, recipe.xpAward);
  }

  private handleUseItem(client: Client, message: UseItemMessage) {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.hp <= 0) return;

    const item = ITEMS[message.itemId];
    if (!item || item.category !== "material" || !item.useEffects?.length) return rejectAction(client, "not_usable");

    const count = player.materials.get(message.itemId) ?? 0;
    if (count < 1) return rejectAction(client, "not_available");

    if (count > 1) player.materials.set(message.itemId, count - 1);
    else player.materials.delete(message.itemId);

    this.combat.consumeItem(player, client.sessionId, item.useEffects);
  }

  // Reorders the bag by swapping two equip-item positions - only equipment has a stable index to
  // swap (the array is packed/no gaps); materials are a stack-count map with no positional
  // concept, so they aren't part of this.
  private handleSwapInventorySlots(client: Client, message: SwapInventorySlotsMessage) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const { fromIndex, toIndex } = message;
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= player.inventory.length || toIndex >= player.inventory.length) return;

    // Rebuilt via clear+push rather than two splice-replace calls - back-to-back splices at
    // overlapping indices didn't produce a real swap (both slots ended up holding the same
    // token), so this computes the final order plainly first and only then replays it into the
    // schema array, avoiding any ambiguity about how ArraySchema's own diffing sees intermediate
    // states.
    const items = [...player.inventory];
    const tmp = items[fromIndex];
    items[fromIndex] = items[toIndex];
    items[toIndex] = tmp;
    player.inventory.clear();
    for (const item of items) player.inventory.push(item);
    this.persistItems(client.sessionId);
  }

  private handleToggleMount(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (!player.hasMount) return rejectAction(client, "no_mount");

    player.mounted = !player.mounted;
  }

  private handleAcceptQuest(client: Client, message: AcceptQuestMessage) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const quest = QUESTS[message.questId];
    if (!quest) return;
    if (player.questProgress.has(quest.id) || player.questCompleted.has(quest.id)) return rejectAction(client, "not_available");
    if (!this.isNearNpc(player, quest.giverNpcId)) return rejectAction(client, "too_far");

    player.questProgress.set(quest.id, 0);
  }

  private handleTurnInQuest(client: Client, message: TurnInQuestMessage) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const quest = QUESTS[message.questId];
    if (!quest) return;

    const progress = player.questProgress.get(quest.id);
    if (progress === undefined || progress < quest.objectiveCount) return rejectAction(client, "not_available");
    if (!this.isNearNpc(player, quest.giverNpcId)) return rejectAction(client, "too_far");
    if (quest.rewardItemId && player.inventory.length >= INVENTORY_SIZE) return rejectAction(client, "inventory_full");

    player.questProgress.delete(quest.id);
    player.questCompleted.set(quest.id, Date.now());
    this.combat.grantXp(player, quest.rewardXp);

    if (quest.rewardItemId) {
      player.inventory.push(encodeItemToken(quest.rewardItemId, "common"));
      this.persistItems(client.sessionId);
    }

    if (quest.rewardGrantsMount) {
      player.hasMount = true;
      this.saveCharacter(client.sessionId);
    }
  }

  // Purchases are always at common rarity - the vendor's catalog is flat-priced, no rarity RNG
  // on the buy side (see VENDOR_SELL_FRACTION for why this can't be exploited on the sell side).
  private handleBuyItem(client: Client, message: BuyItemMessage) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const npc = NPCS[message.npcId];
    if (!npc?.vendorItemIds?.includes(message.itemId)) return;
    if (!this.isNearNpc(player, message.npcId)) return rejectAction(client, "too_far");

    const item = ITEMS[message.itemId];
    if (!item) return;
    if (player.gold < item.basePrice) return rejectAction(client, "not_enough_gold");
    if (player.inventory.length >= INVENTORY_SIZE) return rejectAction(client, "inventory_full");

    player.gold -= item.basePrice;
    player.inventory.push(encodeItemToken(message.itemId, "common"));
    this.persistItems(client.sessionId);
    this.saveCharacter(client.sessionId);
  }

  // Selling doesn't require the specific item to be in that vendor's catalog - any vendor
  // buys anything, matching the standard MMO convention (unlike buying, which is catalog-gated).
  private handleSellItem(client: Client, message: SellItemMessage) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const npc = NPCS[message.npcId];
    if (!npc?.vendorItemIds) return;
    if (!this.isNearNpc(player, message.npcId)) return rejectAction(client, "too_far");

    const index = player.inventory.indexOf(message.token);
    if (index === -1) return;

    const { itemId, rarity } = decodeItemToken(message.token);
    const item = ITEMS[itemId];
    if (!item) return;

    player.inventory.splice(index, 1);
    player.gold += Math.floor(item.basePrice * RARITY_MULTIPLIER[rarity] * VENDOR_SELL_FRACTION);
    this.persistItems(client.sessionId);
    this.saveCharacter(client.sessionId);
  }

  // Called alongside grantXp from handleEnemyKilled - the single hook point that already
  // covers instant, AoE, and projectile-resolved enemy kills (via CombatEngine).
  private progressQuestKills(player: Player, enemyTypeId: string) {
    for (const quest of Object.values(QUESTS)) {
      if (quest.objectiveEnemyTypeId !== enemyTypeId) continue;
      const progress = player.questProgress.get(quest.id);
      if (progress === undefined || progress >= quest.objectiveCount) continue;
      player.questProgress.set(quest.id, progress + 1);
    }
  }
}
