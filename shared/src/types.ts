export const WORLD_ROOM_NAME = "world_room";

export const PLAYER_SPEED = 4; // meters per second, server-authoritative

// World/map constants below are `let`, not `const` - they're populated from the active
// GameMap/Dungeon by loadGameContent() (see bottom of this file) rather than being fixed at
// build time. Every existing reference to these exact names keeps compiling unchanged; only
// their value now comes from the database instead of a source-code literal.
export let MAP_HALF_EXTENT = 34; // flat test ground spans [-34, 34] on x and z by default

export interface InputMessage {
  moveX: number; // normalized direction, -1..1
  moveZ: number; // normalized direction, -1..1
  seq: number; // client-assigned sequence number, echoed back for reconciliation
}

// The fixed set of combat AI archetypes CombatEngine knows how to run - this stays a closed
// union (it selects a hardcoded code path), unlike an enemy's *identity* (EnemyTypeId below),
// which is admin-created content. Two different admin-authored enemy types can share a
// behavior (e.g. two different "melee" monsters with different names/stats/rewards).
export type EnemyBehavior = "melee" | "caster" | "boss";
export type EnemyTypeId = string;

// A character only ever has one relevant combat stat - whichever CLASSES[classId].mainStat
// names (strength/dexterity/intellect). That identity is metadata for display labeling only;
// the actual value lives in this one field, not three parallel ones.
export interface PlayerStats {
  mainStat: number;
  vitality: number;
  luck: number;
  armor: number;
}

export const BASE_STATS: PlayerStats = {
  mainStat: 5,
  vitality: 10,
  luck: 5,
  armor: 0,
};

export const VITALITY_TO_HP = 10; // maxHp = vitality * VITALITY_TO_HP (level 1 => 100 hp)
export const VITALITY_PER_LEVEL = 2;
export const MAIN_STAT_PER_LEVEL = 3; // your class's main stat gains this per level
export const BASE_XP_PER_LEVEL = 100;
export const MAX_LEVEL = 60;

export type MainStat = "strength" | "dexterity" | "intellect";
// ClassId/NpcId/MapId/DungeonId are admin-created identity strings, not closed unions - any
// value that exists as a row in the corresponding content table is valid. Only the *shape* of
// each entity (ClassDef, NpcDef, ...) and the small fixed behavior/role/slot unions stay closed.
export type ClassId = string;
export type NpcId = string;
export type MapId = string;
export type DungeonId = string;
export type ClassRole = "tank" | "healer" | "dps";

export interface ClassDef {
  id: ClassId;
  name: string;
  mainStat: MainStat;
  role: ClassRole;
}

export let CLASSES: Record<ClassId, ClassDef> = {};

// Recomputed in loadGameContent as "first key of CLASSES" - not a hardcoded literal, since an
// admin could delete whichever class was originally seeded as the default.
export let DEFAULT_CLASS_ID: ClassId = "warrior";

// Universal (no room-specific state), so both WorldRoom and DungeonRoom's combat engines
// share this one implementation instead of each carrying their own copy.
export function resolveClassId(raw: unknown): ClassId {
  if (typeof raw === "string" && Object.prototype.hasOwnProperty.call(CLASSES, raw)) {
    return raw;
  }
  return DEFAULT_CLASS_ID;
}
export const MAIN_STAT_START_BONUS = 5; // extra points in your class's main stat at level 1

export const DAMAGE_STAT_FACTOR = 0.3; // flat damage/heal bonus = floor(mainStat * factor)
export const CRIT_PER_LUCK = 1.5; // % crit chance per luck point
export const MAX_CRIT_CHANCE = 75; // %
export const CRIT_MULTIPLIER = 1.5;

export function xpForNextLevel(level: number): number {
  return BASE_XP_PER_LEVEL * level;
}

export function critChanceFromLuck(luck: number): number {
  return Math.min(MAX_CRIT_CHANCE, luck * CRIT_PER_LUCK) / 100;
}

export type SpellId = string;

export type SpellTargetType = "enemy" | "ally" | "self" | "ground";
export type SpellEffectType = "damage" | "heal" | "dispel" | "interrupt";

export interface SpellDef {
  id: SpellId;
  classId: ClassId;
  name: string;
  description: string;
  effectType: SpellEffectType;
  targetType: SpellTargetType;
  amount?: number; // damage or heal magnitude (base, before stat/talent/ailment scaling); unused by dispel/interrupt
  aoeRadius?: number; // when set, the effect applies to every valid unit within this radius of the impact point
  interruptsCast?: boolean; // secondary modifier - cancels the target's pending cast, independent of effectType
  cooldownMs: number;
  castTimeMs: number;
  range: number;
  projectileSpeed?: number; // only used when castTimeMs > 0 (cast-time spells may travel as a projectile)
}

export let SPELLS: Record<SpellId, SpellDef> = {};

export interface MeleeStats {
  maxHp: number;
  damage: number;
  range: number;
  intervalMs: number;
}

export interface CasterStats {
  maxHp: number;
  damage: number;
  range: number;
  cooldownMs: number;
  projectileSpeed: number;
  castTimeMs: number;
}

// A boss runs the melee pattern always, and gains the aoe (caster-shaped) pattern once it
// enters phase 2 - see BOSS_PHASE_2_HP_FRACTION. Deliberately not the same shape as
// melee/caster since it combines both.
export interface BossStats {
  maxHp: number;
  meleeDamage: number;
  meleeRange: number;
  meleeIntervalMs: number;
  aoeDamage: number;
  aoeRadius: number;
  aoeRange: number;
  aoeCooldownMs: number;
  aoeCastTimeMs: number;
  aoeProjectileSpeed: number;
}

export type EnemyStats = MeleeStats | CasterStats | BossStats;

// An admin-authored enemy identity - unifies what used to be three inconsistent boss-stat
// sources (the overworld's ENEMY_STATS.boss, the dungeon's separately-hardcoded mini-boss HP,
// and a per-behavior XP/gold table) into one row per enemy type.
export interface EnemyTypeDef {
  id: EnemyTypeId;
  name: string;
  behavior: EnemyBehavior;
  xpReward: number;
  goldReward: number;
  stats: EnemyStats;
}

export let ENEMY_TYPES: Record<EnemyTypeId, EnemyTypeDef> = {};

export const PROJECTILE_HIT_RADIUS = 0.6;

export const ENEMY_RESPAWN_MS = 6000;

// A boss's phase/enrage identity is derived from already-synced fields (hp/maxHp,
// enragesAt) rather than a separate synced flag, so client and server can never disagree
// on what "phase 2" or "enraged" means - both just compute the same threshold locally.
export const BOSS_PHASE_2_HP_FRACTION = 0.5;
export const BOSS_ENRAGE_DAMAGE_MULTIPLIER = 2;
export let BOSS_ARENA_CENTER = { x: 0, z: 28 };
export let BOSS_ARENA_RADIUS = 10;

export const PROJECTILE_MAX_LIFETIME_MS = 4000;

export type AilmentKind = "weaken";

export const AILMENTS: Record<AilmentKind, { damagePercent: number; durationMs: number }> = {
  weaken: { damagePercent: 20, durationMs: 8000 },
};

export const INTERRUPT_LOCKOUT_MS = 3000;

export interface CastMessage {
  spellId: SpellId;
  targetId?: string;
  targetX?: number;
  targetZ?: number;
}

export type EquipSlot = "weapon" | "armor" | "trinket";

export interface ItemDef {
  id: string;
  name: string;
  slot: EquipSlot;
  bonuses: Partial<PlayerStats>;
  icon: string;
  description: string;
  basePrice: number; // vendor buy price at common rarity - see VENDOR_SELL_FRACTION for sell price
}

export let ITEMS: Record<string, ItemDef> = {};
export let ITEM_IDS: string[] = [];

export type Rarity = "common" | "rare" | "epic";

export const RARITY_MULTIPLIER: Record<Rarity, number> = { common: 1, rare: 1.5, epic: 2 };
export const RARITY_LABEL: Record<Rarity, string> = { common: "Common", rare: "Rare", epic: "Epic" };
export const RARITY_COLOR: Record<Rarity, string> = { common: "#e6e6e6", rare: "#4ac0e8", epic: "#c95ce8" };
export const RARITY_WEIGHTS: Record<Rarity, number> = { common: 70, rare: 25, epic: 5 };

export function rollRarity(): Rarity {
  const total = RARITY_WEIGHTS.common + RARITY_WEIGHTS.rare + RARITY_WEIGHTS.epic;
  let roll = Math.random() * total;
  for (const rarity of Object.keys(RARITY_WEIGHTS) as Rarity[]) {
    roll -= RARITY_WEIGHTS[rarity];
    if (roll <= 0) return rarity;
  }
  return "common";
}

// Item instances are threaded through Colyseus ArraySchema<string>/plain string fields and a
// VARCHAR(32) DB column as a composite "itemId@rarity" token, rather than restructuring those
// to carry a structured object - every existing string-typed field/column/message keeps its type.
export function encodeItemToken(itemId: string, rarity: Rarity): string {
  return `${itemId}@${rarity}`;
}

export function decodeItemToken(token: string): { itemId: string; rarity: Rarity } {
  const at = token.indexOf("@");
  if (at === -1) return { itemId: token, rarity: "common" }; // legacy bare id predating rarity
  const rarity = token.slice(at + 1);
  return { itemId: token.slice(0, at), rarity: rarity in RARITY_MULTIPLIER ? (rarity as Rarity) : "common" };
}

export const LOOT_DROP_CHANCE = 0.5;
export const LOOT_BAG_AGGREGATE_RADIUS = 3;
export const LOOT_BAG_DESPAWN_MS = 180_000;
export const LOOT_PICKUP_RADIUS = 3;
export const INVENTORY_SIZE = 20;

export interface EquippedItems {
  weapon: string;
  armor: string;
  trinket: string;
}

export function getEffectiveStats(base: PlayerStats, equipped: EquippedItems): PlayerStats {
  const total: PlayerStats = { ...base };
  for (const token of Object.values(equipped)) {
    if (!token) continue;
    const { itemId, rarity } = decodeItemToken(token);
    const item = ITEMS[itemId];
    if (!item) continue;
    const multiplier = RARITY_MULTIPLIER[rarity];
    for (const [stat, value] of Object.entries(item.bonuses)) {
      total[stat as keyof PlayerStats] += Math.round((value ?? 0) * multiplier);
    }
  }
  return total;
}

export interface LootTakeMessage {
  bagId: string;
  itemId: string;
}

export interface EquipMessage {
  itemId: string;
}

export interface UnequipMessage {
  slot: EquipSlot;
}

export type TalentEffectKey = "damagePercent" | "critChanceBonus" | "cooldownPercent" | "armorBonus" | "maxHpPercent";

export interface TalentDef {
  id: string;
  classId: ClassId;
  name: string;
  description: string;
  maxRank: number;
  effectKey: TalentEffectKey;
  perRank: number;
}

export const TALENT_POINTS_PER_LEVEL = 1;

export let TALENTS: Record<string, TalentDef> = {};

export interface TalentBonus {
  damagePercent: number;
  critChanceBonus: number;
  cooldownPercent: number;
  armorBonus: number;
  maxHpPercent: number;
}

export function getTalentBonus(classId: ClassId, talentRanks: Iterable<[string, number]>): TalentBonus {
  const ranks = new Map(talentRanks);
  const bonus: TalentBonus = { damagePercent: 0, critChanceBonus: 0, cooldownPercent: 0, armorBonus: 0, maxHpPercent: 0 };
  for (const def of Object.values(TALENTS)) {
    if (def.classId !== classId) continue;
    const rank = ranks.get(def.id) ?? 0;
    if (rank > 0) bonus[def.effectKey] += def.perRank * rank;
  }
  return bonus;
}

export interface SpendTalentMessage {
  talentId: string;
}

export const NPC_INTERACT_RADIUS = 3; // mirrors LOOT_PICKUP_RADIUS

export interface NpcDef {
  id: NpcId;
  name: string;
  x: number;
  z: number;
  mapId: MapId;
  vendorItemIds?: string[]; // presence marks this NPC as a vendor - see VENDOR_SELL_FRACTION
}

export let NPCS: Record<NpcId, NpcDef> = {};

// An NPC's quest list is derived from Quest.giverNpcId, not separately authored - recomputed
// in loadGameContent alongside ITEM_IDS. Replaces what used to be a redundant parallel
// `questIds` list on NpcDef itself.
export let NPC_QUEST_IDS: Record<NpcId, string[]> = {};

// Selling always nets less than buying back would cost, even at the lowest (common) rarity a
// purchase produces - buyPrice * VENDOR_SELL_FRACTION < buyPrice, so there's no arbitrage loop.
export const VENDOR_SELL_FRACTION = 0.4;

export interface BuyItemMessage {
  npcId: string;
  itemId: string; // base item id, must be in that NPC's vendorItemIds
}

export interface SellItemMessage {
  npcId: string;
  token: string; // the exact encoded inventory entry, e.g. "rusty_sword@rare"
}

export type QuestId = string;

export interface QuestDef {
  id: QuestId;
  name: string;
  description: string;
  giverNpcId: NpcId;
  objectiveEnemyTypeId: EnemyTypeId;
  objectiveCount: number;
  rewardXp: number;
  rewardItemId?: string;
}

export let QUESTS: Record<QuestId, QuestDef> = {};

export interface AcceptQuestMessage {
  questId: QuestId;
}

export interface TurnInQuestMessage {
  questId: QuestId;
}

export const PARTY_MAX_SIZE = 5;
export const PARTY_XP_SHARE_RADIUS = 15; // must be roughly in the same area of the map, not just "logged in"

export interface PartyInviteMessage {
  targetSessionId: string;
}

export interface PartyRespondMessage {
  accept: boolean;
}

export let PORTAL_POSITION = { x: -24, z: -24 }; // clear of every existing spawn/quest/arena position

export let DUNGEON_HALF_EXTENT = 16; // the active dungeon's own ground, purely decorative sizing for the client

export const DUNGEON_ROOM_NAME = "dungeon_room";
export let DUNGEON_PARTY_SIZE = 4;
export let DUNGEON_COMPOSITION: Record<ClassRole, number> = { tank: 1, healer: 1, dps: 2 };

// A "listing" is just a party advertising itself - composition is only enforced at
// dungeon_start, not at dungeon_join_listing (only a size check, "except if it's full").
// The member list/roles are derived on demand from state.players filtered by partyId,
// never duplicated onto the listing itself.
export interface DungeonJoinListingMessage {
  partyId: string;
}

export const CHAT_MAX_LENGTH = 200;

export type ChatChannel = "say" | "party";

// Chat is deliberately not part of synced schema state (see server/src/rooms/chat.ts) -
// these are plain onMessage/broadcast payloads, not @type fields.
export interface ChatMessage {
  channel: ChatChannel;
  text: string;
}

export interface ChatBroadcast {
  channel: ChatChannel;
  senderName: string;
  senderSessionId: string;
  text: string;
  sentAt: number;
}

export const TRADE_RANGE = 5; // slightly larger than LOOT_PICKUP_RADIUS/NPC_INTERACT_RADIUS since it targets a moving player
export const TRADE_RANGE_CHECK_INTERVAL_MS = 1000;

export interface TradeRequestMessage {
  targetSessionId: string;
}

export interface TradeRespondMessage {
  accept: boolean;
}

// Full-replace, not incremental: the client always resends its complete intended offer, and
// items are token values (not inventory indices) since indices shift under concurrent
// equip/unequip splices - see server/src/rooms/trade.ts.
export interface TradeOfferMessage {
  items: string[];
  gold: number;
}

// Server -> client, pushed after every mutating trade action (open, either side's offer
// change, either side's accept). One call per participant, with self/partner swapped -
// never synced schema state, since that would leak both offers to every room bystander.
export interface TradeSnapshot {
  partnerSessionId: string;
  partnerName: string;
  selfOffer: string[];
  selfGold: number;
  partnerOffer: string[];
  partnerGold: number;
  selfAccepted: boolean;
  partnerAccepted: boolean;
}

export type TradeCancelReason = "declined" | "left_range" | "disconnected" | "cancelled" | "trade_failed";

export interface TradeCancelledMessage {
  reason: TradeCancelReason;
}

// ---------------------------------------------------------------------------------------------
// Admin-editable content: maps, dungeons, enemy spawns, and the loader that ties everything
// above together. See the "Admin Content Backend" plan for the full design.
// ---------------------------------------------------------------------------------------------

export interface EnemySpawnDef {
  id: string;
  enemyTypeId: EnemyTypeId;
  mapId: MapId;
  x: number;
  z: number;
  respawnMs?: number;
}

export let SPAWN_POINTS: EnemySpawnDef[] = [];

// kind is a closed union selecting a hardcoded procedural shape builder client-side
// (client/src/game/Structure.ts); everything else is open admin content. Walls/pillars are
// solid (see getStructureColliders below) - only players collide with them, blocking movement
// server-side; doorway/gate gaps stay open on both the visual and the collision side.
export type StructureKind = "house" | "shop" | "wall" | "tower" | "gate";

export interface StructureDef {
  id: string;
  name: string;
  mapId: MapId;
  kind: StructureKind;
  x: number;
  z: number;
  rotationY: number;
  width: number;
  depth: number;
  height: number;
  color: string; // hex, e.g. "#8a6d4b"
}

export let STRUCTURES: StructureDef[] = [];

// These shape a structure's solid geometry - shared between the client's wall/door/pillar
// meshes (client/src/game/Structure.ts) and the server's collision resolution below, so what
// you see solid and what actually blocks you can never drift apart.
export const STRUCTURE_WALL_THICKNESS = 0.15;
export const STRUCTURE_DOOR_WIDTH_FRACTION = 0.35;
export const STRUCTURE_MAX_DOOR_WIDTH = 1.6; // wide enough for a player even on a tiny house
export const STRUCTURE_GATE_PILLAR_FRACTION = 0.25;

export const PLAYER_COLLISION_RADIUS = 0.4; // matches PlayerAvatar's capsule radius

export interface StructureCollider {
  // Local space (pre-rotation), relative to the structure's own x/z origin.
  localX: number;
  localZ: number;
  halfWidth: number;
  halfDepth: number;
}

// Solid rectangles for a structure, in local (unrotated) space - one entry per wall/pillar
// segment, mirroring exactly what buildHouse/buildWall/buildTower/buildGate render as solid.
export function getStructureColliders(def: StructureDef): StructureCollider[] {
  switch (def.kind) {
    case "house":
    case "shop": {
      const doorWidth = Math.min(def.width * STRUCTURE_DOOR_WIDTH_FRACTION, STRUCTURE_MAX_DOOR_WIDTH);
      const frontSegmentWidth = (def.width - doorWidth) / 2;
      const colliders: StructureCollider[] = [];
      if (frontSegmentWidth > 0.05) {
        for (const sign of [-1, 1]) {
          colliders.push({
            localX: sign * (doorWidth / 2 + frontSegmentWidth / 2),
            localZ: -def.depth / 2,
            halfWidth: frontSegmentWidth / 2,
            halfDepth: STRUCTURE_WALL_THICKNESS / 2,
          });
        }
      }
      colliders.push({ localX: 0, localZ: def.depth / 2, halfWidth: def.width / 2, halfDepth: STRUCTURE_WALL_THICKNESS / 2 });
      for (const sign of [-1, 1]) {
        colliders.push({
          localX: (sign * def.width) / 2,
          localZ: 0,
          halfWidth: STRUCTURE_WALL_THICKNESS / 2,
          halfDepth: def.depth / 2,
        });
      }
      return colliders;
    }
    case "wall":
    case "tower":
      return [{ localX: 0, localZ: 0, halfWidth: def.width / 2, halfDepth: def.depth / 2 }];
    case "gate": {
      const pillarWidth = def.width * STRUCTURE_GATE_PILLAR_FRACTION;
      const pillarOffset = def.width / 2 - pillarWidth / 2;
      return [-1, 1].map((sign) => ({
        localX: sign * pillarOffset,
        localZ: 0,
        halfWidth: pillarWidth / 2,
        halfDepth: def.depth / 2,
      }));
    }
  }
}

// Pushes (x, z) out of any structure it currently overlaps, treating the mover as a circle of
// PLAYER_COLLISION_RADIUS. Server-authoritative (see CombatEngine.tickPlayerMovement) - purely
// decorative structure kinds never reach here since getStructureColliders always returns at
// least one solid rectangle per kind.
export function resolveStructureCollisions(x: number, z: number, structures: StructureDef[]): { x: number; z: number } {
  for (const def of structures) {
    const cosT = Math.cos(def.rotationY);
    const sinT = Math.sin(def.rotationY);
    const dx = x - def.x;
    const dz = z - def.z;
    let localX = dx * cosT - dz * sinT;
    let localZ = dx * sinT + dz * cosT;

    for (const collider of getStructureColliders(def)) {
      const closestX = Math.max(collider.localX - collider.halfWidth, Math.min(localX, collider.localX + collider.halfWidth));
      const closestZ = Math.max(collider.localZ - collider.halfDepth, Math.min(localZ, collider.localZ + collider.halfDepth));
      const diffX = localX - closestX;
      const diffZ = localZ - closestZ;
      const distSq = diffX * diffX + diffZ * diffZ;
      if (distSq === 0 || distSq >= PLAYER_COLLISION_RADIUS * PLAYER_COLLISION_RADIUS) continue;

      const dist = Math.sqrt(distSq);
      const push = PLAYER_COLLISION_RADIUS - dist;
      localX += (diffX / dist) * push;
      localZ += (diffZ / dist) * push;
    }

    x = def.x + localX * cosT + localZ * sinT;
    z = def.z - localX * sinT + localZ * cosT;
  }
  return { x, z };
}

export type MapKind = "overworld" | "dungeon";

export interface GameMapDef {
  id: MapId;
  name: string;
  kind: MapKind;
  halfExtent: number;
  // isActive is only meaningful (and exclusively enforced - exactly one true) among
  // kind:"overworld" rows. A kind:"dungeon" map's liveness is entirely determined by whether
  // the Dungeon row pointing at it (via Dungeon.mapId) has isActive=true.
  isActive: boolean;
  portalX?: number;
  portalZ?: number;
  bossArenaX?: number;
  bossArenaZ?: number;
  bossArenaRadius?: number;
}

export let ACTIVE_MAP: GameMapDef | null = null;

export interface DungeonEncounterSpec {
  enemyTypeId: EnemyTypeId;
  x: number;
  z: number;
}

export interface DungeonDef {
  id: DungeonId;
  name: string;
  mapId: MapId;
  isActive: boolean;
  partySize: number;
  composition: Record<ClassRole, number>;
  encounters: DungeonEncounterSpec[][]; // ordered waves
}

export let ACTIVE_DUNGEON: DungeonDef | null = null;

export interface ContentSnapshot {
  classes: ClassDef[];
  spells: SpellDef[];
  items: ItemDef[];
  talents: TalentDef[];
  enemyTypes: EnemyTypeDef[];
  npcs: NpcDef[];
  quests: QuestDef[];
  maps: GameMapDef[];
  dungeons: DungeonDef[];
  spawns: EnemySpawnDef[];
  structures: StructureDef[];
}

// The single entry point that turns a fetched content snapshot into every live table/constant
// above. Two rules matter for correctness (see the admin backend plan for why):
//   1. Callers must build the WHOLE snapshot before calling this - one fetch/one set of
//      parallel queries, never several sequential awaits each assigning as they resolve. This
//      function itself is synchronous precisely so nothing else can run on the event loop
//      between assignments and observe a torn mix of old/new tables.
//   2. Every derived value (ITEM_IDS, NPC_QUEST_IDS, ACTIVE_MAP/DUNGEON, the world-position
//      constants) is recomputed here, in the same pass - never persisted separately.
export function loadGameContent(snapshot: ContentSnapshot): void {
  CLASSES = Object.fromEntries(snapshot.classes.map((c) => [c.id, c]));
  SPELLS = Object.fromEntries(snapshot.spells.map((s) => [s.id, s]));
  ITEMS = Object.fromEntries(snapshot.items.map((i) => [i.id, i]));
  TALENTS = Object.fromEntries(snapshot.talents.map((t) => [t.id, t]));
  ENEMY_TYPES = Object.fromEntries(snapshot.enemyTypes.map((e) => [e.id, e]));
  QUESTS = Object.fromEntries(snapshot.quests.map((q) => [q.id, q]));

  ITEM_IDS = Object.keys(ITEMS);
  DEFAULT_CLASS_ID = snapshot.classes[0]?.id ?? DEFAULT_CLASS_ID;

  NPC_QUEST_IDS = {};
  for (const quest of snapshot.quests) {
    (NPC_QUEST_IDS[quest.giverNpcId] ??= []).push(quest.id);
  }

  ACTIVE_MAP = snapshot.maps.find((m) => m.kind === "overworld" && m.isActive) ?? ACTIVE_MAP;
  ACTIVE_DUNGEON = snapshot.dungeons.find((d) => d.isActive) ?? ACTIVE_DUNGEON;
  const dungeonMap = snapshot.maps.find((m) => m.id === ACTIVE_DUNGEON?.mapId) ?? null;

  // NPCs/spawns/structures are scoped to whichever map is currently ACTIVE_MAP, computed just
  // above - so a draft/inactive "overworld"-kind map can carry its own content in the DB without
  // it leaking into the live game (only one overworld map is ever active at a time).
  NPCS = Object.fromEntries(snapshot.npcs.filter((n) => n.mapId === ACTIVE_MAP?.id).map((n) => [n.id, n]));
  SPAWN_POINTS = snapshot.spawns.filter((s) => s.mapId === ACTIVE_MAP?.id);
  STRUCTURES = snapshot.structures.filter((s) => s.mapId === ACTIVE_MAP?.id);

  if (ACTIVE_MAP) {
    MAP_HALF_EXTENT = ACTIVE_MAP.halfExtent;
    if (ACTIVE_MAP.portalX != null && ACTIVE_MAP.portalZ != null) {
      PORTAL_POSITION = { x: ACTIVE_MAP.portalX, z: ACTIVE_MAP.portalZ };
    }
    if (ACTIVE_MAP.bossArenaX != null && ACTIVE_MAP.bossArenaZ != null) {
      BOSS_ARENA_CENTER = { x: ACTIVE_MAP.bossArenaX, z: ACTIVE_MAP.bossArenaZ };
    }
    if (ACTIVE_MAP.bossArenaRadius != null) BOSS_ARENA_RADIUS = ACTIVE_MAP.bossArenaRadius;
  }
  if (dungeonMap) DUNGEON_HALF_EXTENT = dungeonMap.halfExtent;
  if (ACTIVE_DUNGEON) {
    DUNGEON_PARTY_SIZE = ACTIVE_DUNGEON.partySize;
    DUNGEON_COMPOSITION = ACTIVE_DUNGEON.composition;
  }
}
