import { Room, Client, matchMaker } from "@colyseus/core";
import {
  AcceptQuestMessage,
  BOSS_ARENA_CENTER,
  DUNGEON_PARTY_SIZE,
  DUNGEON_ROOM_NAME,
  DungeonJoinListingMessage,
  ENEMY_RESPAWN_MS,
  ENEMY_STATS,
  EnemyKind,
  EquipMessage,
  EquipSlot,
  INVENTORY_SIZE,
  ITEM_IDS,
  ITEMS,
  InputMessage,
  LOOT_BAG_AGGREGATE_RADIUS,
  LOOT_BAG_DESPAWN_MS,
  LOOT_DROP_CHANCE,
  LOOT_PICKUP_RADIUS,
  LootTakeMessage,
  MAX_LEVEL,
  NPCS,
  NPC_INTERACT_RADIUS,
  PARTY_MAX_SIZE,
  PARTY_XP_SHARE_RADIUS,
  PartyInviteMessage,
  PartyRespondMessage,
  QUESTS,
  SpendTalentMessage,
  TALENTS,
  TurnInQuestMessage,
  UnequipMessage,
  CastMessage,
  XP_PER_ENEMY_KIND,
  decodeItemToken,
  encodeItemToken,
  resolveClassId,
  rollRarity,
} from "@mmo/shared";
import { verifyToken } from "../auth/jwt.js";
import { getCharacterForUser, saveCharacterProgress } from "../db/characters.js";
import { listCharacterItems, replaceCharacterItems } from "../db/items.js";
import { CombatEngine } from "./combat/CombatEngine.js";
import { DungeonListing, Enemy, LootBag, Player, WorldState } from "./schema/WorldState.js";

const SIMULATION_INTERVAL_MS = 1000 / 30;
const AUTOSAVE_INTERVAL_MS = 30_000;
const BOSS_RESPAWN_MS = 60_000; // a boss should feel rarer than a trash mob's ENEMY_RESPAWN_MS
const BOSS_GUARANTEED_DROPS = 3; // bypasses LOOT_DROP_CHANCE - a group should always walk away with something

interface EnemySpawnPoint {
  id: string;
  kind: EnemyKind;
  x: number;
  z: number;
  respawnMs?: number; // falls back to ENEMY_RESPAWN_MS when unset
}

const SPAWN_POINTS: EnemySpawnPoint[] = [
  { id: "melee-1", kind: "melee", x: 8, z: 8 },
  { id: "melee-2", kind: "melee", x: -8, z: 8 },
  { id: "caster-1", kind: "caster", x: 8, z: -8 },
  { id: "caster-2", kind: "caster", x: -8, z: -8 },
  { id: "boss-1", kind: "boss", x: BOSS_ARENA_CENTER.x, z: BOSS_ARENA_CENTER.z, respawnMs: BOSS_RESPAWN_MS },
];

export class WorldRoom extends Room<WorldState> {
  private combat!: CombatEngine;
  private characterIdBySession = new Map<string, number>();
  private tokenBySession = new Map<string, string>(); // kept for re-use when reserving dungeon seats
  private lootBagSeq = 0;

  onCreate() {
    this.setState(new WorldState());

    this.combat = new CombatEngine({
      state: this.state,
      onEnemyKilled: (enemyId, kind, killerSessionId, x, z) => this.handleEnemyKilled(enemyId, kind, killerSessionId, x, z),
      onPlayerRespawn: (sessionId, player) => this.handlePlayerRespawn(sessionId, player),
    });

    for (const point of SPAWN_POINTS) {
      this.spawnEnemy(point);
    }

    this.onMessage("input", (client, message: InputMessage) => this.combat.handleInput(client.sessionId, message));
    this.onMessage("cast", (client, message: CastMessage) => this.combat.handleCast(client, message));
    this.onMessage("loot_take", (client, message: LootTakeMessage) => this.handleLootTake(client, message));
    this.onMessage("equip", (client, message: EquipMessage) => this.handleEquip(client, message));
    this.onMessage("unequip", (client, message: UnequipMessage) => this.handleUnequip(client, message));
    this.onMessage("spend_talent", (client, message: SpendTalentMessage) => this.handleSpendTalent(client, message));
    this.onMessage("accept_quest", (client, message: AcceptQuestMessage) => this.handleAcceptQuest(client, message));
    this.onMessage("turn_in_quest", (client, message: TurnInQuestMessage) => this.handleTurnInQuest(client, message));
    this.onMessage("party_invite", (client, message: PartyInviteMessage) => this.handlePartyInvite(client, message));
    this.onMessage("party_respond", (client, message: PartyRespondMessage) => this.handlePartyRespond(client, message));
    this.onMessage("party_leave", (client) => this.handlePartyLeave(client));
    this.onMessage("dungeon_open_listing", (client) => this.handleDungeonOpenListing(client));
    this.onMessage("dungeon_close_listing", (client) => this.handleDungeonCloseListing(client));
    this.onMessage("dungeon_join_listing", (client, message: DungeonJoinListingMessage) =>
      this.handleDungeonJoinListing(client, message),
    );
    this.onMessage("dungeon_start", (client) => this.handleDungeonStart(client));

    this.setSimulationInterval(() => this.combat.tick(SIMULATION_INTERVAL_MS / 1000), SIMULATION_INTERVAL_MS);
    this.clock.setInterval(() => this.autosaveAll(), AUTOSAVE_INTERVAL_MS);
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

    const items = await listCharacterItems(character.id);
    for (const row of items) {
      if (row.slot === "weapon") player.equippedWeapon = row.item_id;
      else if (row.slot === "armor") player.equippedArmor = row.item_id;
      else if (row.slot === "trinket") player.equippedTrinket = row.item_id;
      else player.inventory.push(row.item_id);
    }

    this.combat.recomputeMaxHp(player);
    player.hp = player.maxHp;

    this.state.players.set(client.sessionId, player);
    this.characterIdBySession.set(client.sessionId, character.id);
    this.tokenBySession.set(client.sessionId, options.token);
    console.log(`[WorldRoom] ${client.sessionId} joined as ${character.name} (${classId}, lv ${player.level})`);
  }

  async onLeave(client: Client) {
    await this.saveCharacter(client.sessionId);

    const leavingPlayer = this.state.players.get(client.sessionId);
    if (leavingPlayer) this.removeFromParty(leavingPlayer);

    this.combat.clearSessionTracking(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.characterIdBySession.delete(client.sessionId);
    this.tokenBySession.delete(client.sessionId);
    console.log(`[WorldRoom] ${client.sessionId} left`);
  }

  private async saveCharacter(sessionId: string) {
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
        talentPoints: player.talentPoints,
        talentRanks: Object.fromEntries(player.talentRanks),
        questProgress: Object.fromEntries(player.questProgress),
        questCompleted: Object.fromEntries(player.questCompleted),
      });
    } catch (err) {
      console.error(`[WorldRoom] failed to save character ${characterId}:`, err);
    }
  }

  private async autosaveAll() {
    for (const sessionId of this.characterIdBySession.keys()) {
      await this.saveCharacter(sessionId);
    }
  }

  private async persistItems(sessionId: string) {
    const player = this.state.players.get(sessionId);
    const characterId = this.characterIdBySession.get(sessionId);
    if (!player || !characterId) return;

    try {
      await replaceCharacterItems(characterId, [...player.inventory], {
        weapon: player.equippedWeapon,
        armor: player.equippedArmor,
        trinket: player.equippedTrinket,
      });
    } catch (err) {
      console.error(`[WorldRoom] failed to persist items for character ${characterId}:`, err);
    }
  }

  private spawnEnemy(point: EnemySpawnPoint) {
    const stats = ENEMY_STATS[point.kind];
    const enemy = new Enemy();
    enemy.kind = point.kind;
    enemy.x = point.x;
    enemy.z = point.z;
    enemy.hp = stats.maxHp;
    enemy.maxHp = stats.maxHp;
    this.state.enemies.set(point.id, enemy);
  }

  // CombatEngine hook: called once an enemy's hp hits 0 (already removed from state by then).
  private handleEnemyKilled(enemyId: string, kind: EnemyKind, killerSessionId: string, x: number, z: number) {
    this.grantKillRewards(killerSessionId, kind, x, z);
    if (kind === "boss") {
      for (let i = 0; i < BOSS_GUARANTEED_DROPS; i++) this.maybeDropLoot(x, z, true);
    } else {
      this.maybeDropLoot(x, z, false);
    }

    const point = SPAWN_POINTS.find((p) => p.id === enemyId);
    if (point) this.clock.setTimeout(() => this.spawnEnemy(point), point.respawnMs ?? ENEMY_RESPAWN_MS);
  }

  // CombatEngine hook: called after a dead player's hp/ailments/cast have already been reset.
  private handlePlayerRespawn(_sessionId: string, player: Player) {
    player.x = 0;
    player.y = 0;
    player.z = 0;
  }

  // Every party member within PARTY_XP_SHARE_RADIUS of the kill (and alive) gets the same
  // XP/quest credit the killer would get solo - not a split pool, just shared credit for
  // being nearby. Degrades to exactly the old single-killer behavior when partyId is empty.
  private grantKillRewards(killerSessionId: string, kind: EnemyKind, x: number, z: number) {
    const killer = this.state.players.get(killerSessionId);
    if (!killer) return;

    for (const player of this.partyMembersNear(killer, x, z)) {
      this.combat.grantXp(player, XP_PER_ENEMY_KIND[kind]);
      this.progressQuestKills(player, kind);
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

  private handleLootTake(client: Client, message: LootTakeMessage) {
    const player = this.state.players.get(client.sessionId);
    const bag = this.state.lootBags.get(message.bagId);
    if (!player || !bag) return;

    const dist = Math.hypot(player.x - bag.x, player.z - bag.z);
    if (dist > LOOT_PICKUP_RADIUS) return;

    const index = bag.items.indexOf(message.itemId);
    if (index === -1) return;
    if (player.inventory.length >= INVENTORY_SIZE) return;

    bag.items.splice(index, 1);
    player.inventory.push(message.itemId);

    if (bag.items.length === 0) {
      this.state.lootBags.delete(message.bagId);
    }

    this.persistItems(client.sessionId);
  }

  private getEquippedItemId(player: Player, slot: EquipSlot): string {
    switch (slot) {
      case "weapon":
        return player.equippedWeapon;
      case "armor":
        return player.equippedArmor;
      case "trinket":
        return player.equippedTrinket;
    }
  }

  private setEquippedItemId(player: Player, slot: EquipSlot, itemId: string) {
    switch (slot) {
      case "weapon":
        player.equippedWeapon = itemId;
        break;
      case "armor":
        player.equippedArmor = itemId;
        break;
      case "trinket":
        player.equippedTrinket = itemId;
        break;
    }
  }

  private handleEquip(client: Client, message: EquipMessage) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const item = ITEMS[decodeItemToken(message.itemId).itemId];
    if (!item) return;

    const index = player.inventory.indexOf(message.itemId);
    if (index === -1) return;

    player.inventory.splice(index, 1);

    const previous = this.getEquippedItemId(player, item.slot);
    if (previous) player.inventory.push(previous);
    this.setEquippedItemId(player, item.slot, message.itemId);

    this.combat.recomputeMaxHp(player);
    this.persistItems(client.sessionId);
  }

  private handleUnequip(client: Client, message: UnequipMessage) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const itemId = this.getEquippedItemId(player, message.slot);
    if (!itemId) return;
    if (player.inventory.length >= INVENTORY_SIZE) return;

    this.setEquippedItemId(player, message.slot, "");
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

    const currentRank = player.talentRanks.get(def.id) ?? 0;
    if (currentRank >= def.maxRank) return;

    player.talentRanks.set(def.id, currentRank + 1);
    player.talentPoints -= 1;
    this.combat.recomputeMaxHp(player);
  }

  private isNearNpc(player: Player, npcId: string): boolean {
    const npc = NPCS[npcId];
    if (!npc) return false;
    return Math.hypot(player.x - npc.x, player.z - npc.z) <= NPC_INTERACT_RADIUS;
  }

  private handleAcceptQuest(client: Client, message: AcceptQuestMessage) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const quest = QUESTS[message.questId];
    if (!quest) return;
    if (player.questProgress.has(quest.id) || player.questCompleted.has(quest.id)) return;
    if (!this.isNearNpc(player, quest.giverNpcId)) return;

    player.questProgress.set(quest.id, 0);
  }

  private handleTurnInQuest(client: Client, message: TurnInQuestMessage) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const quest = QUESTS[message.questId];
    if (!quest) return;

    const progress = player.questProgress.get(quest.id);
    if (progress === undefined || progress < quest.objectiveCount) return;
    if (!this.isNearNpc(player, quest.giverNpcId)) return;
    if (quest.rewardItemId && player.inventory.length >= INVENTORY_SIZE) return;

    player.questProgress.delete(quest.id);
    player.questCompleted.set(quest.id, Date.now());
    this.combat.grantXp(player, quest.rewardXp);

    if (quest.rewardItemId) {
      player.inventory.push(encodeItemToken(quest.rewardItemId, "common"));
      this.persistItems(client.sessionId);
    }
  }

  // Called alongside grantXp from handleEnemyKilled - the single hook point that already
  // covers instant, AoE, and projectile-resolved enemy kills (via CombatEngine).
  private progressQuestKills(player: Player, enemyKind: EnemyKind) {
    for (const quest of Object.values(QUESTS)) {
      if (quest.objectiveEnemyKind !== enemyKind) continue;
      const progress = player.questProgress.get(quest.id);
      if (progress === undefined || progress >= quest.objectiveCount) continue;
      player.questProgress.set(quest.id, progress + 1);
    }
  }
}
