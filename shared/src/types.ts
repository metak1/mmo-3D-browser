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
  // Optional reinforcement-wave mechanic - a boss with none of these set never summons adds.
  addEnemyTypeId?: EnemyTypeId;
  addIntervalMs?: number;
  addCount?: number;
  maxConcurrentAdds?: number;
  // Optional special-spell rotation - a boss with neither of these set never casts one.
  specialAbilities?: BossAbilityDef[];
  specialCooldownMs?: number;
}

// A boss's special-spell rotation: cycled through in array order on BossStats.specialCooldownMs.
// Modeled on TalentEffect's discriminated-union pattern - easy to extend with more kinds later.
export type BossAbilityDef =
  | { id: string; name: string; kind: "raidNova"; damage: number; radius: number; castTimeMs: number }
  | { id: string; name: string; kind: "singleTargetBurst"; damage: number; castTimeMs: number };

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

// Player-beneficial timed effects - the mirror image of AilmentKind/AILMENTS above (which are
// always enemy-inflicted debuffs). Granted by "onCastBuff" talents (see TalentEffect below), and
// tracked the same way ailments are: Player.buffs is a MapSchema<number> of kind -> expiresAt.
export type BuffKind = "battleFury" | "shadowStep" | "huntersFocus" | "divineFavor" | "arcaneSurge";

export interface BuffDef {
  name: string;
  durationMs: number;
  damagePercent?: number;
  critChanceBonus?: number;
  cooldownPercent?: number;
  armorBonus?: number;
}

export const BUFFS: Record<BuffKind, BuffDef> = {
  battleFury: { name: "Battle Fury", durationMs: 5000, damagePercent: 20 },
  shadowStep: { name: "Shadow Step", durationMs: 4000, cooldownPercent: 25 },
  huntersFocus: { name: "Hunter's Focus", durationMs: 5000, critChanceBonus: 15 },
  divineFavor: { name: "Divine Favor", durationMs: 6000, armorBonus: 5 },
  arcaneSurge: { name: "Arcane Surge", durationMs: 5000, damagePercent: 25 },
};

// Lazily evaluated the same way getAilmentDamageMultiplier is (expiresAt <= now skips it) -
// nothing actively sweeps/removes expired buffs, the map entry just stops contributing until
// something (a fresh applyBuff) overwrites it.
export function getActiveBuffBonus(buffs: Iterable<[string, number]>, now: number): Partial<TalentBonus> {
  const bonus: Partial<TalentBonus> = {};
  for (const [kind, expiresAt] of buffs) {
    if (expiresAt <= now) continue;
    const def = BUFFS[kind as BuffKind];
    if (!def) continue;
    if (def.damagePercent) bonus.damagePercent = (bonus.damagePercent ?? 0) + def.damagePercent;
    if (def.critChanceBonus) bonus.critChanceBonus = (bonus.critChanceBonus ?? 0) + def.critChanceBonus;
    if (def.cooldownPercent) bonus.cooldownPercent = (bonus.cooldownPercent ?? 0) + def.cooldownPercent;
    if (def.armorBonus) bonus.armorBonus = (bonus.armorBonus ?? 0) + def.armorBonus;
  }
  return bonus;
}

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

export type TalentStatKey = "damagePercent" | "critChanceBonus" | "cooldownPercent" | "armorBonus" | "maxHpPercent";

// A talent's effect is one of four kinds instead of always being a flat class-wide stat bonus:
//  - statBonus: today's original behavior, applies regardless of which spell (if any) is in play.
//  - spellStatBonus: same stat bonus shape, but only counts while resolving a cast of `spellId`.
//  - extraCharges: `spellId` can be cast `perRank * rank` extra times before fully going on
//    cooldown (see getSpellCharges/CombatEngine's charge-array cooldown gate).
//  - onCastBuff: successfully casting `spellId` grants the caster the `buffId` buff (see
//    BuffKind/BUFFS above) for that buff's own durationMs. Purely on/off (any rank > 0 triggers
//    it) - the buff's own definition carries the magnitude, not the talent rank.
export type TalentEffect =
  | { kind: "statBonus"; stat: TalentStatKey; perRank: number }
  | { kind: "spellStatBonus"; spellId: SpellId; stat: TalentStatKey; perRank: number }
  | { kind: "extraCharges"; spellId: SpellId; perRank: number }
  | { kind: "onCastBuff"; spellId: SpellId; buffId: BuffKind };

export interface TalentDef {
  id: string;
  classId: ClassId;
  name: string;
  description: string;
  maxRank: number;
  effect: TalentEffect;
  tier: number; // 1-based row in the class's talent tree
  column: number; // 0-based column within that row, for grid layout
  prerequisiteTalentId?: string; // must have >=1 rank invested before this node can be spent
}

export const TALENT_POINTS_PER_LEVEL = 1;

export let TALENTS: Record<string, TalentDef> = {};

// A node is spendable once its prerequisite (if any) has at least 1 point invested - mirrors
// modern WoW's talent tree gating (a single prerequisite connection per node, not cumulative
// points-per-row). Used both server-side (to reject spend_talent) and client-side (to render
// locked nodes and grey out their connector).
export function isTalentUnlocked(talentId: string, talentRanks: Iterable<[string, number]>): boolean {
  const def = TALENTS[talentId];
  if (!def?.prerequisiteTalentId) return true;
  const ranks = new Map(talentRanks);
  return (ranks.get(def.prerequisiteTalentId) ?? 0) > 0;
}

// True if some other spent talent (rank > 0) has `talentId` as its prerequisite - refunding
// talentId's last point would strand that dependent in an invalid state (unlocked node with a
// point in it, but its prerequisite no longer met), so callers should block the refund instead.
export function hasRankedDependents(talentId: string, talentRanks: Iterable<[string, number]>): boolean {
  const ranks = new Map(talentRanks);
  return Object.values(TALENTS).some(
    (def) => def.prerequisiteTalentId === talentId && (ranks.get(def.id) ?? 0) > 0,
  );
}

export interface TalentBonus {
  damagePercent: number;
  critChanceBonus: number;
  cooldownPercent: number;
  armorBonus: number;
  maxHpPercent: number;
}

// `spellId` scopes in any spellStatBonus talents targeting that spell alongside the always-on
// statBonus ones - omit it (e.g. recomputeMaxHp, armor mitigation) to get class-wide-only bonuses,
// the same behavior this function had before spell-scoped talents existed.
export function getTalentBonus(
  classId: ClassId,
  talentRanks: Iterable<[string, number]>,
  spellId?: SpellId,
): TalentBonus {
  const ranks = new Map(talentRanks);
  const bonus: TalentBonus = { damagePercent: 0, critChanceBonus: 0, cooldownPercent: 0, armorBonus: 0, maxHpPercent: 0 };
  for (const def of Object.values(TALENTS)) {
    if (def.classId !== classId) continue;
    const rank = ranks.get(def.id) ?? 0;
    if (rank <= 0) continue;
    const effect = def.effect;
    if (effect.kind === "statBonus") {
      bonus[effect.stat] += effect.perRank * rank;
    } else if (effect.kind === "spellStatBonus" && effect.spellId === spellId) {
      bonus[effect.stat] += effect.perRank * rank;
    }
  }
  return bonus;
}

// Bonus stored-casts of `spellId` from any spent extraCharges talents - the spell's own base
// charge count is always 1, callers add this on top (see CombatEngine's charge-array gate and
// main.ts's identical client-side prediction of it).
export function getSpellCharges(classId: ClassId, spellId: SpellId, talentRanks: Iterable<[string, number]>): number {
  const ranks = new Map(talentRanks);
  let bonus = 0;
  for (const def of Object.values(TALENTS)) {
    if (def.classId !== classId || def.effect.kind !== "extraCharges" || def.effect.spellId !== spellId) continue;
    const rank = ranks.get(def.id) ?? 0;
    if (rank > 0) bonus += def.effect.perRank * rank;
  }
  return bonus;
}

// Every buff a spent onCastBuff talent grants for casting `spellId` - almost always zero or one,
// but a class could plausibly spend two different talents both keyed to the same spell.
export function getOnCastBuffs(classId: ClassId, spellId: SpellId, talentRanks: Iterable<[string, number]>): BuffKind[] {
  const ranks = new Map(talentRanks);
  const buffs: BuffKind[] = [];
  for (const def of Object.values(TALENTS)) {
    if (def.classId !== classId || def.effect.kind !== "onCastBuff" || def.effect.spellId !== spellId) continue;
    if ((ranks.get(def.id) ?? 0) > 0) buffs.push(def.effect.buffId);
  }
  return buffs;
}

export interface SpendTalentMessage {
  talentId: string;
}

export interface RefundTalentMessage {
  talentId: string;
}

// A broadcast-only combat feedback event (client/src/game/FloatingCombatText.ts) - not part of
// synced schema state, since it's a transient "this happened" notice rather than a value that
// needs to stay consistent for a late-joining client. targetId is a sessionId when targetKind is
// "player", an enemyId when "enemy" - the client already tracks avatars for both by id.
export interface CombatTextEvent {
  targetId: string;
  targetKind: "player" | "enemy";
  amount: number;
  kind: "damage" | "heal";
  isCrit: boolean;
}

export const NPC_INTERACT_RADIUS = 3; // mirrors LOOT_PICKUP_RADIUS

export interface NpcDef {
  id: NpcId;
  name: string;
  x: number;
  z: number;
  yOffset: number; // added on top of the auto-computed terrain height - see getTerrainHeight
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

// Fast-travel points (client/src/game/Waypoint.ts) - a player standing within
// WAYPOINT_INTERACT_RADIUS of any waypoint on the map can teleport to any other one, server-
// authoritative (see WorldRoom.handleWaypointTravel). No per-character "discovered" state -
// every waypoint on the active map is usable by anyone close enough to one, from the start.
export const WAYPOINT_INTERACT_RADIUS = 4; // mirrors NPC_INTERACT_RADIUS/LOOT_PICKUP_RADIUS

export interface WaypointDef {
  id: string;
  name: string;
  mapId: MapId;
  x: number;
  z: number;
}

export let WAYPOINTS: WaypointDef[] = [];

export interface WaypointTravelMessage {
  targetWaypointId: string;
}

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
// server-side; a door stays open on both the visual and the collision side.
//
// There's no "house"/"shop" prefab kind anymore - a building is just however many "wall"
// segments an admin freely places (any position/length/rotation) plus one "door" segment where
// they want the entrance. findStructureLoops below detects when a set of wall/door segments
// forms a closed loop and auto-generates a floor + roof over it, so authoring a room is placing
// walls around its perimeter and one door, not picking a single rigid rectangular prefab.
export type StructureKind = "wall" | "door" | "tower" | "gate";

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
  yOffset: number; // added on top of the auto-computed terrain height - see getTerrainHeight
}

export let STRUCTURES: StructureDef[] = [];

// Purely decorative dressing for a room's interior (client/src/game/Furniture.ts) - unlike a
// structure, furniture never collides and has no admin-set size, just a position/rotation/color
// per fixed-shape kind (mirrors how an NPC has no size either). No server-side meaning at all;
// it exists purely so an enclosed room (see StructureLoop) doesn't read as an empty box.
export type FurnitureKind = "table" | "chair" | "barrel" | "crate" | "bookshelf";

export interface FurnitureDef {
  id: string;
  name: string;
  mapId: MapId;
  kind: FurnitureKind;
  x: number;
  z: number;
  rotationY: number;
  color: string; // hex, e.g. "#8a6d4b"
  yOffset: number; // added on top of the auto-computed terrain height - see getTerrainHeight
}

export let FURNITURE: FurnitureDef[] = [];

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
// segment, mirroring exactly what buildWall/buildDoor/buildTower/buildGate render as solid.
// The `default` isn't reachable through the type system (the switch is already exhaustive over
// StructureKind) - it's a runtime safety net for a stale/unrecognized kind value living in the
// database mid-rollout of a StructureKind change, so a bad row makes that one structure
// decoration-only instead of crashing every collision/line-of-sight check on the server.
export function getStructureColliders(def: StructureDef): StructureCollider[] {
  switch (def.kind) {
    case "door":
      return []; // fully open - a door never blocks movement or line of sight
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
    default:
      return [];
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

// Standard slab method: clips the segment's parametric range [0,1] against each axis of the
// AABB, in the same local (pre-rotation) space getStructureColliders already works in.
function segmentIntersectsAabb(
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): boolean {
  let tMin = 0;
  let tMax = 1;
  const dx = x2 - x1;
  const dz = z2 - z1;

  if (dx === 0) {
    if (x1 < minX || x1 > maxX) return false;
  } else {
    let t1 = (minX - x1) / dx;
    let t2 = (maxX - x1) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }

  if (dz === 0) {
    if (z1 < minZ || z1 > maxZ) return false;
  } else {
    let t1 = (minZ - z1) / dz;
    let t2 = (maxZ - z1) / dz;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }

  return true;
}

// Whether a spell can travel from (x1,z1) to (x2,z2) unobstructed by any structure's solid
// geometry - the exact same colliders that block player movement, so a spell can always reach
// anywhere you could physically walk to (through a doorway/gate gap) and never through a wall.
export function hasLineOfSight(x1: number, z1: number, x2: number, z2: number, structures: StructureDef[]): boolean {
  for (const def of structures) {
    const cosT = Math.cos(def.rotationY);
    const sinT = Math.sin(def.rotationY);
    const dx1 = x1 - def.x;
    const dz1 = z1 - def.z;
    const dx2 = x2 - def.x;
    const dz2 = z2 - def.z;
    const localX1 = dx1 * cosT - dz1 * sinT;
    const localZ1 = dx1 * sinT + dz1 * cosT;
    const localX2 = dx2 * cosT - dz2 * sinT;
    const localZ2 = dx2 * sinT + dz2 * cosT;

    for (const collider of getStructureColliders(def)) {
      const minX = collider.localX - collider.halfWidth;
      const maxX = collider.localX + collider.halfWidth;
      const minZ = collider.localZ - collider.halfDepth;
      const maxZ = collider.localZ + collider.halfDepth;
      if (segmentIntersectsAabb(localX1, localZ1, localX2, localZ2, minX, maxX, minZ, maxZ)) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Room detection - a "wall"/"door" segment is just a line in the x/z plane (its two endpoints,
// derived from x/z/width/rotationY below); findStructureLoops looks for places where several of
// them connect end-to-end into a single closed loop, which is what makes a room a room instead of
// just some walls standing near each other. See client/src/game/Structure.ts's buildEnclosure
// (and the admin map editor's mirror of it) for what actually gets built from a StructureLoop.
// ---------------------------------------------------------------------------------------------

// Endpoints are computed within LOOP_ENDPOINT_TOLERANCE of "exact", not exactly - free placement
// (dragging a wall's translate/rotate gizmo by hand) will never land two adjacent walls' corners
// on the exact same float coordinate, so endpoints this close are treated as the same joint.
const LOOP_ENDPOINT_TOLERANCE = 0.6;
const LOOP_FLOOR_INSET = 0.9; // floor sits slightly inside the walls' centerline, not clipping through them
const LOOP_ROOF_OVERHANG = 1.15; // roof overhangs the walls' centerline - mirrors the old pyramid roof's ROOF_OVERHANG
// Without this, roofY lands exactly at the shortest wall's own top face - a flat roof plane and a
// flat wall-top face at the exact same Y z-fight (the renderer can't consistently decide which
// wins the depth test, producing a jagged/flickering seam right where they meet). The old pyramid
// roof never had this problem since a cone's sloped faces are never coplanar with a wall's flat
// top; a flat roof needs an explicit clearance instead.
const LOOP_ROOF_Y_CLEARANCE = 0.05;

export interface StructureLoop {
  // Ordered polygon vertices (world x/z), one per wall/door joint - floorPoints inset slightly
  // inside the walls' centerline, roofPoints overhung slightly beyond it (LOOP_FLOOR_INSET/
  // LOOP_ROOF_OVERHANG), mirroring the old pyramid roof/floor's own inset vs. overhang.
  floorPoints: { x: number; z: number }[];
  roofPoints: { x: number; z: number }[];
  floorY: number;
  roofY: number;
}

// A wall/door's two endpoints in world space - width is the segment's own length along its local
// (pre-rotation) x-axis, matching exactly how buildWall/buildDoor's BoxGeometry(width, height,
// depth) is authored and rotated by rotationY.
function structureEndpoints(def: StructureDef): [{ x: number; z: number }, { x: number; z: number }] {
  const dx = Math.cos(def.rotationY) * (def.width / 2);
  const dz = -Math.sin(def.rotationY) * (def.width / 2);
  return [
    { x: def.x - dx, z: def.z - dz },
    { x: def.x + dx, z: def.z + dz },
  ];
}

function scaleAroundCentroid(
  points: { x: number; z: number }[],
  centroidX: number,
  centroidZ: number,
  factor: number,
): { x: number; z: number }[] {
  return points.map((p) => ({
    x: centroidX + (p.x - centroidX) * factor,
    z: centroidZ + (p.z - centroidZ) * factor,
  }));
}

// Detects every closed room formed by the map's "wall"/"door" segments and returns one
// StructureLoop per room (floor/roof polygon points already inset/overhung - see
// LOOP_FLOOR_INSET/LOOP_ROOF_OVERHANG - so callers can build geometry straight from `points`).
// A "room" is a connected component of wall/door segments where every joint has exactly degree 2
// (a connected graph with every node at degree 2 is necessarily one simple cycle - nothing fancier
// than that theorem is needed here) and at least one segment in the loop is a door; anything
// else - a dangling wall, a T/X junction, an open row of walls with no door - just isn't a room
// and gets no floor/roof, same as today's freestanding "wall" structures.
export function findStructureLoops(
  structures: StructureDef[] = STRUCTURES,
  regionHalfExtent: number = MAP_HALF_EXTENT,
): StructureLoop[] {
  const segments = structures.filter((def) => def.kind === "wall" || def.kind === "door");

  // Cluster endpoints within tolerance into shared joints, keyed by array index ("node id").
  // O(segments * joints so far) - structure counts are small (dozens, not thousands) so a linear
  // scan per endpoint is simpler than a spatial index and plenty fast for a design-time tool.
  const nodes: { x: number; z: number; count: number }[] = [];
  function nodeFor(point: { x: number; z: number }): number {
    for (let i = 0; i < nodes.length; i++) {
      if (Math.hypot(nodes[i].x - point.x, nodes[i].z - point.z) <= LOOP_ENDPOINT_TOLERANCE) {
        const node = nodes[i];
        node.x = (node.x * node.count + point.x) / (node.count + 1);
        node.z = (node.z * node.count + point.z) / (node.count + 1);
        node.count += 1;
        return i;
      }
    }
    nodes.push({ x: point.x, z: point.z, count: 1 });
    return nodes.length - 1;
  }

  interface Edge {
    def: StructureDef;
    a: number;
    b: number;
  }
  const edges: Edge[] = segments.map((def) => {
    const [p1, p2] = structureEndpoints(def);
    return { def, a: nodeFor(p1), b: nodeFor(p2) };
  });

  const adjacency = new Map<number, Edge[]>();
  for (const edge of edges) {
    for (const nodeId of [edge.a, edge.b]) {
      if (!adjacency.has(nodeId)) adjacency.set(nodeId, []);
      adjacency.get(nodeId)!.push(edge);
    }
  }

  const visited = new Set<number>();
  const loops: StructureLoop[] = [];

  for (const startNode of adjacency.keys()) {
    if (visited.has(startNode)) continue;

    const componentNodes = new Set<number>([startNode]);
    const componentEdges = new Set<Edge>();
    const queue = [startNode];
    while (queue.length > 0) {
      const current = queue.pop()!;
      for (const edge of adjacency.get(current) ?? []) {
        componentEdges.add(edge);
        const other = edge.a === current ? edge.b : edge.a;
        if (!componentNodes.has(other)) {
          componentNodes.add(other);
          queue.push(other);
        }
      }
    }
    for (const nodeId of componentNodes) visited.add(nodeId);

    const isSimpleCycle =
      componentNodes.size >= 3 &&
      componentEdges.size === componentNodes.size &&
      [...componentNodes].every((nodeId) => (adjacency.get(nodeId)?.length ?? 0) === 2);
    if (!isSimpleCycle || ![...componentEdges].some((edge) => edge.def.kind === "door")) continue;

    // Walk the cycle in edge order, always stepping to whichever endpoint of the next unused
    // edge isn't where we already are - produces the polygon's vertices in traversal order
    // (some winding direction; which one is arbitrary and irrelevant, see buildEnclosure).
    const orderedNodes: number[] = [startNode];
    const usedEdges = new Set<Edge>();
    let current = startNode;
    while (usedEdges.size < componentEdges.size) {
      const next = (adjacency.get(current) ?? []).find((edge) => !usedEdges.has(edge));
      if (!next) break;
      usedEdges.add(next);
      current = next.a === current ? next.b : next.a;
      orderedNodes.push(current);
    }
    orderedNodes.pop(); // walking a closed loop revisits the start node last - don't duplicate it

    const rawPoints = orderedNodes.map((nodeId) => ({ x: nodes[nodeId].x, z: nodes[nodeId].z }));
    const centroidX = rawPoints.reduce((sum, p) => sum + p.x, 0) / rawPoints.length;
    const centroidZ = rawPoints.reduce((sum, p) => sum + p.z, 0) / rawPoints.length;

    const groundY = getTerrainHeight(centroidX, centroidZ, structures, regionHalfExtent);
    const floorY = groundY + Math.max(...[...componentEdges].map((edge) => edge.def.yOffset));
    const roofY = floorY + Math.min(...[...componentEdges].map((edge) => edge.def.height)) + LOOP_ROOF_Y_CLEARANCE;

    loops.push({
      floorPoints: scaleAroundCentroid(rawPoints, centroidX, centroidZ, LOOP_FLOOR_INSET),
      roofPoints: scaleAroundCentroid(rawPoints, centroidX, centroidZ, LOOP_ROOF_OVERHANG),
      floorY,
      roofY,
    });
  }

  return loops;
}

// ---------------------------------------------------------------------------------------------
// Terrain elevation - purely a rendering concern (see client/src/game/Scene.ts and the admin
// map editor). Every distance/collision/line-of-sight calculation in this file works in the x/z
// plane only and stays that way; nothing here is authoritative game state. A deterministic
// height function (not authored data) keeps the client's game view and the admin editor's view
// in perfect agreement with zero content to maintain.
// ---------------------------------------------------------------------------------------------

const TERRAIN_BASE_WAVELENGTH = 60;
const TERRAIN_BASE_AMPLITUDE = 3.5;
const TERRAIN_DETAIL_WAVELENGTH = 18;
const TERRAIN_DETAIL_AMPLITUDE = 1;
const TERRAIN_FLATTEN_RADIUS = 6; // world units of smooth falloff beyond a structure's own footprint
const TERRAIN_MAX_SEGMENTS = 150; // perf cap on the render mesh - see terrainSegments
const TERRAIN_TARGET_STEP = 4; // world units between mesh vertices, below the cap

// Deterministic pseudo-random value in [0,1) for an integer grid coordinate - no seed/RNG state,
// so the exact same terrain is produced every time this is called, in every process.
function terrainHash(ix: number, iz: number): number {
  const s = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

// Bilinear-interpolated value noise at one frequency, in [0,1).
function valueNoise2D(x: number, z: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const sx = smoothstep(x - x0);
  const sz = smoothstep(z - z0);
  const n00 = terrainHash(x0, z0);
  const n10 = terrainHash(x0 + 1, z0);
  const n01 = terrainHash(x0, z0 + 1);
  const n11 = terrainHash(x0 + 1, z0 + 1);
  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sz;
}

// Number of segments the render mesh (client/src/game/Scene.ts) and the admin map editor's
// preview both build for a map of this half-extent - exported so getTerrainHeight's own sampling
// grid below can stay pixel-exact with whatever actually gets rendered, for any map size.
export function terrainSegments(regionHalfExtent: number): number {
  return Math.min(TERRAIN_MAX_SEGMENTS, Math.round((regionHalfExtent * 2) / TERRAIN_TARGET_STEP));
}

// Smoothly flattens `height` to 0 within `footprint` of some point, falling back off to the
// unmodified height by `footprint + flattenRadius`. Shared by every "footprint" that gets pulled
// level regardless of the noise underneath it - a structure's own footprint, and the boss arena's.
function flattenTowards(height: number, dist: number, footprint: number, flattenRadius: number): number {
  const flattenEnd = footprint + flattenRadius;
  if (dist >= flattenEnd) return height;
  const t = dist <= footprint ? 0 : (dist - footprint) / (flattenEnd - footprint);
  return height * smoothstep(t);
}

// Just the noise formula, evaluated at one exact point. getTerrainHeight below never calls this
// directly with an entity's raw position - see why there.
function rawTerrainHeight(x: number, z: number, structures: StructureDef[]): number {
  const base = (valueNoise2D(x / TERRAIN_BASE_WAVELENGTH, z / TERRAIN_BASE_WAVELENGTH) - 0.5) * 2 * TERRAIN_BASE_AMPLITUDE;
  const detail =
    (valueNoise2D(x / TERRAIN_DETAIL_WAVELENGTH + 91.3, z / TERRAIN_DETAIL_WAVELENGTH + 91.3) - 0.5) * 2 * TERRAIN_DETAIL_AMPLITUDE;
  let height = base + detail;

  for (const s of structures) {
    const footprint = Math.max(s.width, s.depth) / 2;
    height = flattenTowards(height, Math.hypot(x - s.x, z - s.z), footprint, TERRAIN_FLATTEN_RADIUS);
  }

  // The boss arena (BOSS_ARENA_CENTER/RADIUS) is drawn client-side as a flat decorative disc
  // regardless of what the noise underneath it looks like (see client/src/game/Scene.ts) - flatten
  // the actual terrain to match it, the same way a structure's footprint does, so the boss, its
  // adds, and any nearby structure all stand on ground that matches what's drawn instead of
  // floating above or sinking into hills that were never actually leveled.
  height = flattenTowards(
    height,
    Math.hypot(x - BOSS_ARENA_CENTER.x, z - BOSS_ARENA_CENTER.z),
    BOSS_ARENA_RADIUS,
    TERRAIN_FLATTEN_RADIUS,
  );

  return height;
}

// Set once per client session (client/src/game/Scene.ts, alongside the same isDungeon that
// already keeps a dungeon's render mesh a flat, undisplaced quad) - dungeons have no elevation
// at all, so entities there need to sit at a flat 0 instead of riding the overworld's noise, which
// doesn't know or care that it's being evaluated at "dungeon (3, -2)" instead of "overworld (3,
// -2)" (the two coordinate spaces overlap numerically, so the function can't tell them apart from
// x/z alone).
export let TERRAIN_FLAT = false;
export function setTerrainFlat(flat: boolean) {
  TERRAIN_FLAT = flat;
}

// Two octaves of rolling hills, pulled flat under and just beyond every structure's footprint
// so buildings (rigid boxes) always sit on a level pad instead of a slope. `structures` defaults
// to the live STRUCTURES binding (populated by loadGameContent) - every client call site can
// omit it and get correct flattening automatically. The admin map editor never calls
// loadGameContent (it reads content straight from the REST API, not the live-game snapshot
// pipeline), so it passes its own fetched structures list explicitly instead of silently getting
// unflattened terrain under every building.
//
// Samples rawTerrainHeight at the render mesh's own grid corners (see terrainSegments) and
// bilinearly interpolates between them, rather than evaluating the raw noise at the exact x/z
// given - the mesh only has a vertex every `step` world units, so a moving entity positioned at
// the "true" analytic height could float above or sink into the coarser triangles between
// vertices, especially on steeper slopes. This keeps every entity exactly on the surface that's
// actually drawn, regardless of mesh resolution. `regionHalfExtent` only needs overriding by the
// admin map editor, which can be previewing a map other than the currently active one.
export function getTerrainHeight(
  x: number,
  z: number,
  structures: StructureDef[] = STRUCTURES,
  regionHalfExtent: number = MAP_HALF_EXTENT,
): number {
  if (TERRAIN_FLAT) return 0;

  const step = (regionHalfExtent * 2) / terrainSegments(regionHalfExtent);
  const gx0 = Math.floor(x / step) * step;
  const gz0 = Math.floor(z / step) * step;
  const sx = (x - gx0) / step;
  const sz = (z - gz0) / step;

  const h00 = rawTerrainHeight(gx0, gz0, structures);
  const h10 = rawTerrainHeight(gx0 + step, gz0, structures);
  const h01 = rawTerrainHeight(gx0, gz0 + step, structures);
  const h11 = rawTerrainHeight(gx0 + step, gz0 + step, structures);

  const hx0 = h00 + (h10 - h00) * sx;
  const hx1 = h01 + (h11 - h01) * sx;
  return hx0 + (hx1 - hx0) * sz;
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
  waypoints: WaypointDef[];
  furniture: FurnitureDef[];
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
  WAYPOINTS = snapshot.waypoints.filter((w) => w.mapId === ACTIVE_MAP?.id);
  FURNITURE = snapshot.furniture.filter((f) => f.mapId === ACTIVE_MAP?.id);

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
