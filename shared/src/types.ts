// hex.ts reads STRUCTURES/NPCS/WAYPOINTS/SPAWN_POINTS/BOSS_ARENA_*/PORTAL_POSITION below, and this
// file calls resetHexTerrainCache() from loadGameContent - a real module cycle, safe because every
// actual cross-reference happens inside function bodies invoked after both modules finish loading,
// never at module top-level. Re-exported (in addition to imported - `export *` alone doesn't create
// a local binding this file can call) so @mmo/shared consumers (shared/package.json's "main" only
// resolves this file) see hex.ts's public API too.
import { resetHexTerrainCache, getHexElevation, HEX_ELEVATION_STEP_WORLD, HexTerrainKind, HexTerrainContent } from "./hex.js";
export * from "./hex.js";

export const WORLD_ROOM_NAME = "world_room";

export const PLAYER_SPEED = 4; // meters per second, server-authoritative
export const MOUNT_SPEED_MULTIPLIER = 2; // applied to PLAYER_SPEED while Player.mounted is true

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

// The composable effect system - a "technique" (boss ability or spell) is a `shape` (where it
// lands, relative to whoever cast it and the resolved impact point) crossed with one or more
// `actions` (what happens to every unit the shape hits). Both are combinable independently of
// each other - a single EffectDef can be "cone in front of the caster: damage + a lingering DOT +
// knockback" - see CombatEngine's resolveEffect/collectUnitsInShape, the one interpreter every
// spell/boss-ability call site now funnels through instead of each growing its own bespoke branch.
export type EffectShape =
  | { kind: "singleTarget" }
  | { kind: "circle"; radius: number; centeredOn: "caster" | "impact" }
  | { kind: "cone"; radius: number; angleDeg: number } // centered on the caster, aimed at the impact point
  | { kind: "line"; length: number; width: number } // a rectangle from the caster toward the impact point
  | { kind: "randomPoints"; count: number; spreadRadius: number; pointRadius: number }; // e.g. a "meteor shower" around the impact point

// "ailment"/"buff" apply an EXISTING AilmentKind/BuffKind (see AILMENTS/BUFFS below) rather than
// carrying their own magnitude/duration - one shared tuning table either way, same as before this
// system existed. "dot"/"knockback" are the two genuinely new primitives this system adds - see
// DotStack (server/src/rooms/schema/WorldState.ts) for how a dot action becomes ticked state.
export type EffectAction =
  | { kind: "damage"; amount: number }
  | { kind: "heal"; amount: number }
  | { kind: "dot"; amount: number; tickIntervalMs: number; durationMs: number }
  | { kind: "ailment"; ailment: AilmentKind }
  | { kind: "buff"; buff: BuffKind }
  | { kind: "knockback"; distance: number }
  | { kind: "dispel" }
  | { kind: "interrupt" }
  | { kind: "summon"; enemyTypeId: EnemyTypeId; count: number };

export interface EffectDef {
  shape: EffectShape;
  actions: EffectAction[];
}

export interface SpellDef {
  id: SpellId;
  classId: ClassId;
  name: string;
  description: string;
  targetType: SpellTargetType;
  cooldownMs: number;
  castTimeMs: number;
  range: number;
  projectileSpeed?: number; // only used when castTimeMs > 0 (cast-time spells may travel as a projectile)
  // The same composable {shape, actions[]} system BossAbilityDef.effect uses (see EffectDef above)
  // - one EffectDef per independent shape this cast should apply (most spells only ever need one
  // entry - the array exists so a spell CAN layer more than one shape, e.g. "hit the target AND
  // drop a circle at their feet"). Player spells used to have a separate, more limited flat-field
  // resolution path (effectType/amount/aoeRadius/interruptsCast) - removed once every spell was
  // migrated onto this system, so a spell is authored identically to a boss's special ability now.
  effects: EffectDef[];
}

export let SPELLS: Record<SpellId, SpellDef> = {};

export interface MeleeStats {
  maxHp: number;
  damage: number;
  range: number;
  intervalMs: number;
  // Passive (undefined/0, the default - shown yellow) never engages until a player attacks it
  // first; aggressive (>0, shown red) auto-engages the nearest player within this many meters -
  // see CombatEngine.tickEnemyMovement.
  aggroRange?: number;
}

export interface CasterStats {
  maxHp: number;
  damage: number;
  range: number;
  cooldownMs: number;
  projectileSpeed: number;
  castTimeMs: number;
  aggroRange?: number; // same passive/aggressive contract as MeleeStats.aggroRange
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

// A boss's special-spell rotation: cycled through in array order on BossStats.specialCooldownMs
// (see CombatEngine.tickBossSpecialAbilities, unchanged by this) - `effect` is the composable
// EffectDef above (shape + actions[]), resolved by the same resolveEffect every spell now runs
// through. Previously a closed 2-member kind union (raidNova/singleTargetBurst) requiring a new
// TypeScript variant + CombatEngine branch + client telegraph case for every new boss technique -
// any admin-authored shape/action combination now "just works" on both server and client with no
// code changes. Live enemy_types.stats JSON authored under the old shape needs a one-time hand
// reshape in the admin editor (there were only ever a handful of boss rows).
export interface BossAbilityDef {
  id: string;
  name: string;
  castTimeMs: number;
  effect: EffectDef;
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
  // Picks a specific character model (see client/src/game/Enemy.ts's MODEL_CONFIG) instead of the
  // single shared goblin every enemy type used before this existed - mirrors StructureDef.modelId.
  // Unset (or unrecognized) falls back to the original per-behavior goblin, so every enemy type
  // that predates this field keeps rendering exactly as it did before.
  modelId?: string;
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

// Overworld-only (see CombatEngineConfig.enemiesWander) - melee/caster enemies idle-wander a
// short loop around their spawn point, and chase whoever they're engaged with (via threat, same
// as before - only *acquiring* that engagement can now also happen proactively, for aggressive
// types, via aggroRange above) until either the target dies/leaves or the chase pulls the enemy
// this far from its spawn, at which point it gives up and returns to idle-wandering.
export const ENEMY_WANDER_RADIUS = 6; // meters from spawn
export const ENEMY_WANDER_SPEED = 1.2; // meters/second
export const ENEMY_WANDER_PAUSE_MS = 1500; // minimum pause between wander legs
export const ENEMY_WANDER_PAUSE_JITTER_MS = 2000; // extra random pause on top of the minimum
export const ENEMY_CHASE_SPEED = 3.4; // meters/second - a bit under PLAYER_SPEED, so kiting works
export const ENEMY_LEASH_RANGE = 18; // meters from spawn before a chase is abandoned

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

// Sent back to just the casting client (never broadcast - nobody else needs to know why someone
// else's cast fizzled) whenever CombatEngine.handleCast rejects an attempt for a reason the
// client couldn't already predict/block on its own (see client/src/main.ts's castSpell, which
// pre-checks range/target/cast-state itself so the common cases never even round-trip to the
// server - this message is what surfaces the ones that can't be predicted client-side, like line
// of sight, plus a safety net for the predictable ones in case client/server state ever drifts).
export type CastFailReason = "out_of_range" | "no_line_of_sight" | "no_target" | "already_casting" | "on_cooldown" | "interrupted";

export interface CastFailedMessage {
  reason: CastFailReason;
}

// Generalizes CastFailedMessage's own pattern (see its doc comment) to every other player-
// initiated action that can be silently rejected server-side - loot/quest/vendor/waypoint
// interactions all funnel through this instead of each growing its own bespoke message type.
// reason is intentionally coarse (one value covers many handlers) since the client already
// blocks the common "too far" case itself before these ever round-trip to the server (see main.ts's
// own isNearNpcForClient-style proximity checks gating whether a panel opens at all) - this is
// mostly a safety net for state drift (e.g. the player walked away while a panel stayed open), not
// the primary way a player learns why something didn't work.
export type ActionFailReason =
  | "too_far"
  | "inventory_full"
  | "not_enough_gold"
  | "not_available"
  | "not_found"
  | "already_friends"
  | "already_pending"
  | "already_in_guild"
  | "name_taken"
  | "not_leader"
  | "not_admin"
  | "profession_not_learned"
  | "profession_slots_full"
  | "profession_already_learned"
  | "level_too_low"
  | "insufficient_materials"
  | "not_usable"
  | "no_mount";

export interface ActionFailedMessage {
  reason: ActionFailReason;
}

// "weapon"/"armor"/"trinket" predate the rest of this list and keep their original ids for
// backward compatibility with already-equipped items in the live `character_items` table (a
// rename would orphan any row whose `slot` column still says the old value) - "weapon" is the
// main-hand slot, "armor" is the chest slot, both relabeled accordingly in EQUIP_SLOT_LABEL below
// without touching the id itself.
export type EquipSlot =
  | "weapon"
  | "offHand"
  | "head"
  | "neck"
  | "shoulders"
  | "armor"
  | "hands"
  | "waist"
  | "legs"
  | "feet"
  | "ring"
  | "trinket";

export const EQUIP_SLOTS: EquipSlot[] = [
  "head",
  "neck",
  "shoulders",
  "armor",
  "hands",
  "waist",
  "legs",
  "feet",
  "weapon",
  "offHand",
  "ring",
  "trinket",
];

export const EQUIP_SLOT_LABEL: Record<EquipSlot, string> = {
  weapon: "Main Hand",
  offHand: "Off Hand",
  head: "Head",
  neck: "Neck",
  shoulders: "Shoulders",
  armor: "Chest",
  hands: "Hands",
  waist: "Waist",
  legs: "Legs",
  feet: "Feet",
  ring: "Ring",
  trinket: "Trinket",
};

// "equipment" is every item that predates this field (all backfilled to it) - occupies an
// EquipSlot, lives in a character's equip inventory array, carries rarity. "material" is
// everything professions produce/consume: raw gathered resources AND crafted alchemist/cook
// goods alike - it isn't specifically "a crafting input", just "not an equip-slot item". Stored
// in its own stackable Player.materials map instead (see WorldState.ts), no rarity.
export type ItemCategory = "equipment" | "material";

export interface ItemDef {
  id: string;
  name: string;
  category: ItemCategory;
  slot?: EquipSlot; // only meaningful (and required by the admin schema) for category "equipment"
  bonuses: Partial<PlayerStats>;
  icon: string;
  description: string;
  basePrice: number; // vendor buy price at common rarity - see VENDOR_SELL_FRACTION for sell price
  // Only meaningful for category "material" - consuming one (see "use_item") resolves these
  // effects against the consuming player, self-targeted, through the exact same resolveEffect()
  // interpreter spells/boss abilities already use (CombatEngine.ts). Unset = not consumable, just
  // a tradeable good sitting in the materials bag (e.g. raw ore, or a crafted item nobody's wired
  // an effect for yet).
  useEffects?: EffectDef[];
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

export type EquippedItems = Record<EquipSlot, string>;

// Professions: lumberjack/miner gather raw materials from world nodes; alchemist/cook/blacksmith/
// tailor/jeweler craft materials into items via recipes. A character may know at most
// MAX_LEARNED_PROFESSIONS at once (one shared pool - any mix of gathering/crafting, classic-MMO-
// style), tracked as presence of a key in Player.professionXp/professionLevel (see WorldState.ts -
// same "map key presence is the source of truth" convention already used by talentRanks/
// questProgress, no separate "known professions" list needed).
export type ProfessionId = "lumberjack" | "miner" | "alchemist" | "cook" | "blacksmith" | "tailor" | "jeweler";

export const GATHERING_PROFESSIONS: ProfessionId[] = ["lumberjack", "miner"];
export const CRAFTING_PROFESSIONS: ProfessionId[] = ["alchemist", "cook", "blacksmith", "tailor", "jeweler"];
export const ALL_PROFESSIONS: ProfessionId[] = [...GATHERING_PROFESSIONS, ...CRAFTING_PROFESSIONS];

export const PROFESSION_LABELS: Record<ProfessionId, string> = {
  lumberjack: "Lumberjack",
  miner: "Miner",
  alchemist: "Alchemist",
  cook: "Cook",
  blacksmith: "Blacksmith",
  tailor: "Tailor",
  jeweler: "Jeweler",
};

export const PROFESSION_ICONS: Record<ProfessionId, string> = {
  lumberjack: "🪓",
  miner: "⛏️",
  alchemist: "🧪",
  cook: "🍳",
  blacksmith: "🔨",
  tailor: "🧵",
  jeweler: "💍",
};

export const MAX_LEARNED_PROFESSIONS = 2;

// Separate, simpler curve from character leveling (xpForNextLevel/MAX_LEVEL below) - professions
// are a side-progression system, not meant to take as long as the main character level track.
export const BASE_PROFESSION_XP_PER_LEVEL = 40;
export const MAX_PROFESSION_LEVEL = 30;

export function professionXpForNextLevel(level: number): number {
  return BASE_PROFESSION_XP_PER_LEVEL * level;
}

export const GATHER_INTERACT_RADIUS = 3; // mirrors WAYPOINT_INTERACT_RADIUS/LOOT_PICKUP_RADIUS

// A recipe always draws its ingredients from the materials bag (never equip-inventory items) -
// keeps craft-consumption to one code path (decrement a MapSchema<number>), no hunting through
// rarity-tagged equip tokens. Output goes to the equip inventory array if outputItemId's item is
// category "equipment", otherwise to the materials map - see WorldRoom.handleCraftRecipe.
export interface RecipeDef {
  id: string;
  profession: ProfessionId; // must be one of CRAFTING_PROFESSIONS
  name: string;
  requiredLevel: number;
  ingredients: { itemId: string; quantity: number }[];
  outputItemId: string;
  outputQuantity: number;
  xpAward: number;
}

export let RECIPES: Record<string, RecipeDef> = {};

// The "species" of a gathering node - what it produces, its model, its respawn timing. Mirrors
// EnemyTypeDef vs EnemySpawnDef's type/placement split: many map placements typically share one
// node type (e.g. many oak trees), so yield/respawn tuning lives in one place affecting all of them.
export interface GatheringNodeTypeDef {
  id: string;
  profession: ProfessionId; // must be one of GATHERING_PROFESSIONS
  name: string;
  modelId: string;
  outputItemId: string;
  outputQuantity: number;
  xpAward: number;
  respawnMs: number;
  requiredLevel: number;
}

export let GATHERING_NODE_TYPES: Record<string, GatheringNodeTypeDef> = {};

// One map placement referencing a node type - mirrors EnemySpawnDef/WaypointDef exactly.
export interface GatheringNodeDef {
  id: string;
  mapId: MapId;
  nodeTypeId: string;
  x: number;
  z: number;
}

export let GATHERING_NODES: GatheringNodeDef[] = [];

export interface LearnProfessionMessage {
  professionId: ProfessionId;
  npcId: string; // must be a trainer NPC that teaches this profession - see WorldRoom.handleLearnProfession
}

export interface ForgetProfessionMessage {
  professionId: ProfessionId;
}

export interface GatherNodeMessage {
  nodeId: string;
}

export interface CraftRecipeMessage {
  recipeId: string;
}

export interface UseItemMessage {
  itemId: string;
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

export interface SwapInventorySlotsMessage {
  fromIndex: number;
  toIndex: number;
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
  // Presence marks this NPC as a profession trainer - one trainer teaches one profession (a real
  // class of NPC per profession, not a generic do-everything trainer), same "presence marks this
  // NPC as X" convention as vendorItemIds above. See WorldRoom.handleLearnProfession.
  teachesProfessionId?: ProfessionId;
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

// A "graveyard" placement - see roomUtil.ts's respawnPlayerAtClosestPoint, which picks whichever
// of these is nearest the spot a player just died, mirroring the classic MMO graveyard-run
// mechanic. Falls back to SPAWN_POSITION if none exist yet (a fresh install before an admin has
// placed any), so death always has somewhere sane to send a player.
export interface RespawnPointDef {
  id: string;
  name: string;
  mapId: MapId;
  x: number;
  z: number;
}

export let RESPAWN_POINTS: RespawnPointDef[] = [];

// A single hand-painted hex cell (admin/src/mapEditor's tile palette) that overrides whatever
// shared/src/hex.ts's procedural classifier would otherwise compute for that cell - see
// classify()'s "overrides win first" ordering. Most cells have no row here at all; this only
// exists for the ones an admin has actually painted.
export interface HexTileOverrideDef {
  id: string;
  mapId: MapId;
  q: number;
  r: number;
  kind: HexTerrainKind;
  // Only meaningful for the coastCornerLight/coastNarrowEdge/coastHalf/coastMostly kinds - every
  // other kind ignores it (grass/water are rotationally uniform, road/river compute their own
  // piece rotation from neighbor connectivity). Defaults to 0 when absent.
  rotation?: number;
  // Applies to any kind (grass, water, road, river, coast) - lets an admin hand-sculpt a specific
  // cell's height (0..HEX_MAX_ELEVATION) independent of the procedural noise that would otherwise
  // decide it. Only a "grass" cell ever gets a sloped ramp toward a lower neighbor though (see
  // hex.ts's classifyElevationRamps) - the asset pack's only ramp shape is grass-specific, so any
  // other kind (or a grass cell too far from its neighbor) just sits at its own flat height with
  // an unramped edge. Defaults to 0 (flat, ground level) when absent, same as every painted tile
  // already behaved before this field existed.
  elevation?: number;
  // Only meaningful on a "grass" cell with elevation > 0 - see hex.ts's OverrideLike.rampRotation
  // (the shared source of truth for this field's exact semantics). Picks which direction the
  // ramp slopes toward directly, replacing classifyElevationRamps' own automatic neighbor-facing
  // computation for this cell. Unset (the default) keeps the automatic behavior.
  rampRotation?: number;
}

export let HEX_TILE_OVERRIDES: HexTileOverrideDef[] = [];

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
  rewardGrantsMount?: boolean;
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

// Unlike party (ephemeral Colyseus room state, wiped on disconnect - see partyId's own doc
// comment), friends and guild membership are real DB-persisted player data: they must survive a
// relog, and must reach someone who's offline or in a different room entirely (overworld vs. a
// dungeon instance). Targeting is by character name (a text input) rather than only "right-click
// someone visible nearby" for the same reason - party invites can get away with sessionId
// targeting since both sides are already in the same room; these can't assume that.
export interface FriendRequestMessage {
  targetName: string;
}

export interface FriendRespondMessage {
  requestId: number;
  accept: boolean;
}

export interface FriendRemoveMessage {
  characterId: number;
}

// friend_request auto-accepts instead of creating a second row if the target already sent *you*
// one - see WorldRoom.handleFriendRequest.
export const GUILD_NAME_MAX_LENGTH = 32; // mirrors characters.name's own VARCHAR(32)

export interface GuildCreateMessage {
  name: string;
}

export interface GuildInviteMessage {
  targetName: string;
}

export interface GuildRespondMessage {
  inviteId: number;
  accept: boolean;
}

export interface GuildKickMessage {
  characterId: number;
}

export interface GuildPromoteMessage {
  characterId: number;
}

// guild_leave/guild_disband/guild_roster_request carry no payload - mirrors party_leave.

// Server -> client, pushed after a guild_roster_request (and proactively after this client's own
// mutating guild action) - not synced schema state, same reasoning as TradeSnapshot below: a full
// roster (including offline members) is too large/situational to duplicate onto every guild
// member's own Player schema. Player.guildId/guildName/guildRole (small, always-relevant fields)
// stay on the synced schema; the roster itself is pulled on demand.
export interface GuildRosterEntry {
  characterId: number;
  name: string;
  level: number;
  classId: string;
  role: "leader" | "member";
  online: boolean;
}

export interface GuildRosterSnapshot {
  guildId: number;
  guildName: string;
  members: GuildRosterEntry[];
}

// Where the dungeon-entrance portal object sits (see client/src/game/Portal.ts/main.ts's
// PortalAvatar - a real clickable world object that opens the dungeon finder, not a spawn point).
// Overworld-only, mirrored by GameMapDef.portalX/portalZ, admin-editable via the map editor's
// portal marker.
export let PORTAL_POSITION = { x: -24, z: -24 }; // clear of every existing spawn/quest/arena position

// Where a character actually appears on join - a distinct concept from PORTAL_POSITION above
// (easy to conflate since both are admin-editable single points on a map row, but one is a
// clickable dungeon-entrance prop and this one is plain spawn coordinates with no world object of
// its own). See WorldRoom.onJoin. Defaults to the origin, matching this game's original
// hardcoded behavior before it became admin-editable.
export let SPAWN_POSITION = { x: 0, z: 0 };

export let DUNGEON_HALF_EXTENT = 16; // the active dungeon's own ground, purely decorative sizing for the client

// Mirrors SPAWN_POSITION - see DungeonRoom.onJoin. Dungeons have no portal-of-their-own concept
// (PortalAvatar only ever renders in the overworld - see its own doc comment), so this is the
// only admin-editable point a dungeon's own map row needs.
export let DUNGEON_SPAWN_POSITION = { x: 0, z: 0 };

// The active dungeon's own hex-terrain content, mirroring STRUCTURES/NPCS/WAYPOINTS/SPAWN_POINTS/
// HEX_TILE_OVERRIDES but scoped to ACTIVE_DUNGEON.mapId instead of ACTIVE_MAP.id (see
// loadGameContent) - structures/npcs/waypoints/spawns are already placeable on a dungeon map via
// the admin editor today, so including them here means a dungeon's own walls/props/NPCs get the
// same "never drop a lake under this" land protection the overworld already gets for free.
export let DUNGEON_STRUCTURES: StructureDef[] = [];
export let DUNGEON_NPCS: Record<string, NpcDef> = {};
export let DUNGEON_WAYPOINTS: WaypointDef[] = [];
export let DUNGEON_SPAWN_POINTS: EnemySpawnDef[] = [];
export let DUNGEON_HEX_TILE_OVERRIDES: HexTileOverrideDef[] = [];

// Assembled fresh on every call from the globals above rather than cached, since it's only ever
// used for ground-mesh construction (once per dungeon load) and client-visual elevation lookups -
// see getTerrainHeight's "dungeon" branch. No boss-arena/portal land-forcing for dungeons yet
// (both left at a harmless {0,0}/0 - a dungeon-kind map's own bossArena/portal columns aren't used
// today), unlike the overworld's equivalent live content.
export function dungeonHexContent(): HexTerrainContent {
  return {
    structures: DUNGEON_STRUCTURES,
    npcs: Object.values(DUNGEON_NPCS),
    waypoints: DUNGEON_WAYPOINTS,
    spawns: DUNGEON_SPAWN_POINTS,
    bossArenaCenter: { x: 0, z: 0 },
    bossArenaRadius: 0,
    portalPosition: { x: 0, z: 0 },
    overrides: DUNGEON_HEX_TILE_OVERRIDES,
  };
}

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

export type ChatChannel = "say" | "party" | "guild";

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

// Sent by the client's "/time" chat command (see main.ts's handleSlashCommand) - server-side
// admin-role check happens fresh per-request (WorldRoom.handleSetTimeOfDay), same "not embedded in
// a client-trusted flag" posture as the HTTP admin routes' own requireAdmin. Overworld-only, same
// as DayNightCycle itself - a dungeon has no sky to set the time of.
export interface SetTimeOfDayMessage {
  fraction: number; // 0..1, wraps like DayNightCycle's own timeOfDay() - 0/1 = midnight, 0.5 = noon
}

// Broadcast to every client in the room once an admin's SetTimeOfDayMessage passes the role check -
// see GameScene.setTimeOfDay/DayNightCycle.setTimeOverride for how a client applies it (a one-time
// jump, then the cycle keeps flowing forward from there at its normal speed).
export interface TimeOfDaySetBroadcast {
  fraction: number;
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

// An alternative to EnemySpawnDef's one-row-one-fixed-point model: a circular area that the
// server keeps populated with up to maxPopulation enemies at once, each randomly drawn from
// enemyTypeIds and randomly positioned within the circle (see WorldRoom's spawnZoneMember) -
// for "populate this forest with wolves" instead of hand-placing every wolf. Overworld only;
// dungeons keep their own hand-curated, non-wandering DungeonSpawnDef encounters.
export interface EnemySpawnZoneDef {
  id: string;
  mapId: MapId;
  x: number;
  z: number;
  radius: number;
  enemyTypeIds: EnemyTypeId[];
  maxPopulation: number;
  respawnMs?: number;
  wanderRadius?: number; // per-zone override of ENEMY_WANDER_RADIUS; unset = the global default
  leashRange?: number; // per-zone override of ENEMY_LEASH_RANGE; unset = the global default
}

export let SPAWN_ZONES: EnemySpawnZoneDef[] = [];

// kind is a closed union selecting a hardcoded procedural shape builder client-side
// (client/src/game/Structure.ts); everything else is open admin content. Walls/pillars are
// solid (see getStructureColliders below) - only players collide with them, blocking movement
// server-side; a door stays open on both the visual and the collision side.
//
// There's no "house"/"shop" prefab kind for wall/door/tower/gate - a building built from those is
// just however many "wall" segments an admin freely places (any position/length/rotation) plus
// one "door" segment where they want the entrance. findStructureLoops below detects when a set of
// wall/door segments forms a closed loop and auto-generates a floor + roof over it, so authoring a
// room is placing walls around its perimeter and one door, not picking a single rigid rectangular
// prefab.
//
// "building" is the one exception - a single pre-made exterior model (see modelId below and
// client/src/game/Structure.ts's BUILDING_MODELS) placed and rotated like any other structure, but
// with no interior to enter and no wall/door pieces of its own, so it never participates in
// findStructureLoops. It still blocks movement like every other structure kind - see
// getStructureColliders' "building" case and BUILDING_FOOTPRINT below - just via a single
// computed-footprint box per model instead of a hand-placed wall/pillar shape.
// "lamp" has no dedicated getStructureColliders case below - it falls through to the same
// non-blocking default a door/gateless building already gets, which is exactly right for a thin
// decorative post nobody should ever collide with.
export type StructureKind = "wall" | "door" | "tower" | "gate" | "building" | "lamp";

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
  modelId?: string; // "building"/"lamp" kind only - key into client/src/game/Structure.ts's BUILDING_MODELS/buildLamp
  lightIntensity?: number; // "lamp" kind only - scales the light/glow strength; unset = client's own built-in default
}

export let STRUCTURES: StructureDef[] = [];

// Mostly decorative dressing for a room's interior (client/src/game/Furniture.ts) - unlike a
// structure, furniture has no admin-set size, just a position/rotation/color per fixed-shape kind
// (mirrors how an NPC has no size either), and almost every kind has no server-side meaning at
// all beyond making an enclosed room (see StructureLoop) not read as an empty box.
// hill/rock*/tree*/mountain*/hills*/clouds/waterlily/waterplant are outdoor nature decoration
// (KayKit's Medieval Hexagon Pack, not the Dungeon Pack the indoor kinds use) - structurally
// identical to the indoor kinds (same table/route/placement pipeline), just a different admin
// palette section and asset source. The hex* and other lowercase-prefixed kinds below (hexBarrel,
// flagBlue, tent, etc.) are the same pack's own standalone prop set - named distinctly from the
// Dungeon Pack's "barrel"/"crate" so the two packs' visually different versions of the same object
// never collide as FurnitureKind values.
// Every outdoor decoration kind above (rock*/tree*/hill*/mountain* and the KayKit standalone prop
// set) blocks movement - see FURNITURE_FOOTPRINT/getFurnitureColliders below. The indoor kinds
// (table/chair/barrel/crate/bookshelf) and the floating sky decoration (cloudBig/cloudSmall) are
// the exceptions and stay walk-through - see FURNITURE_FOOTPRINT's own doc comment for why.
export type FurnitureKind =
  | "table"
  | "chair"
  | "barrel"
  | "crate"
  | "bookshelf"
  | "hill"
  | "hillB"
  | "hillC"
  | "hillsA"
  | "hillsATrees"
  | "hillsB"
  | "hillsBTrees"
  | "hillsC"
  | "hillsCTrees"
  | "rock"
  | "rockB"
  | "rockC"
  | "rockD"
  | "rockE"
  | "tree"
  | "treeB"
  | "treeACut"
  | "treeBCut"
  | "treesACut"
  | "treesALarge"
  | "treesAMedium"
  | "treesASmall"
  | "treesBCut"
  | "treesBLarge"
  | "treesBMedium"
  | "treesBSmall"
  | "mountainA"
  | "mountainB"
  | "mountainC"
  | "mountainAGrass"
  | "mountainAGrassTrees"
  | "mountainBGrass"
  | "mountainBGrassTrees"
  | "mountainCGrass"
  | "mountainCGrassTrees"
  | "cloudBig"
  | "cloudSmall"
  | "waterlilyA"
  | "waterlilyB"
  | "waterplantA"
  | "waterplantB"
  | "waterplantC"
  | "hexBarrel"
  | "bucketArrows"
  | "bucketEmpty"
  | "bucketWater"
  | "hexCrateBigA"
  | "hexCrateSmallA"
  | "hexCrateBigB"
  | "hexCrateSmallB"
  | "hexCrateLongA"
  | "hexCrateLongB"
  | "hexCrateLongC"
  | "hexCrateLongEmpty"
  | "hexCrateOpen"
  | "flagBlue"
  | "flagGreen"
  | "flagRed"
  | "flagYellow"
  | "ladder"
  | "pallet"
  | "resourceLumber"
  | "resourceStone"
  | "sack"
  | "archeryTarget"
  | "tent"
  | "weaponrack"
  | "wheelbarrow";

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

// A single AABB per building model, in local (unrotated, pre-scale) space, approximating its real
// footprint - computed once offline from each GLTF's own native bounding box (same technique as
// client/src/game/Structure.ts's BUILDING_MODELS targetHeight), scaled by that same
// targetHeight/nativeHeight ratio fitHeight applies visually, then shrunk 15% (same "kept slightly
// inside the visual model" fudge shared's FURNITURE_FOOTPRINT below also uses) so the collision
// edge never reads as bigger than what's drawn. Deliberately missing 8 of the 92 models, which
// stay walk-through (no entry -> getStructureColliders' building case returns []):
// building_bridge_A/B (spans a river - meant to be walked over, not around), building_dirt/grain
// (flat ground decals with no real height, not obstacles), and the 4 "*_gate" pieces
// (fence_stone_straight_gate, fence_wood_straight_gate, wall_corner_A_gate, wall_straight_gate -
// each has a real passable opening built into its geometry that a single box can't represent, so
// this follows the same "a gate/door never blocks" rule the door/gate StructureKinds already use
// rather than wall off the very opening the piece exists to provide).
export const BUILDING_FOOTPRINT: Record<string, { halfWidth: number; halfDepth: number }> = {
  building_archeryrange_blue: { halfWidth: 2.485, halfDepth: 2.306 },
  building_barracks_blue: { halfWidth: 2.142, halfDepth: 2.329 },
  building_blacksmith_blue: { halfWidth: 1.916, halfDepth: 1.853 },
  building_castle_blue: { halfWidth: 2.519, halfDepth: 2.877 },
  building_church_blue: { halfWidth: 1.531, halfDepth: 1.719 },
  building_home_A_blue: { halfWidth: 1.18, halfDepth: 1.272 },
  building_home_B_blue: { halfWidth: 1.301, halfDepth: 1.634 },
  building_lumbermill_blue: { halfWidth: 0.582, halfDepth: 0.506 },
  building_market_blue: { halfWidth: 2.68, halfDepth: 1.959 },
  building_mine_blue: { halfWidth: 2.389, halfDepth: 2.857 },
  building_tavern_blue: { halfWidth: 1.744, halfDepth: 1.983 },
  building_tower_A_blue: { halfWidth: 1.233, halfDepth: 1.431 },
  building_tower_base_blue: { halfWidth: 2.766, halfDepth: 3.306 },
  building_tower_B_blue: { halfWidth: 1.73, halfDepth: 1.998 },
  building_tower_catapult_blue: { halfWidth: 0.326, halfDepth: 0.457 },
  building_watermill_blue: { halfWidth: 1.047, halfDepth: 1.233 },
  building_well_blue: { halfWidth: 0.694, halfDepth: 0.8 },
  building_windmill_blue: { halfWidth: 1.152, halfDepth: 0.835 },
  building_archeryrange_green: { halfWidth: 2.485, halfDepth: 2.306 },
  building_barracks_green: { halfWidth: 2.142, halfDepth: 2.329 },
  building_blacksmith_green: { halfWidth: 1.916, halfDepth: 1.853 },
  building_castle_green: { halfWidth: 2.519, halfDepth: 2.877 },
  building_church_green: { halfWidth: 1.531, halfDepth: 1.719 },
  building_home_A_green: { halfWidth: 1.18, halfDepth: 1.272 },
  building_home_B_green: { halfWidth: 1.301, halfDepth: 1.634 },
  building_lumbermill_green: { halfWidth: 0.582, halfDepth: 0.506 },
  building_market_green: { halfWidth: 2.68, halfDepth: 1.959 },
  building_mine_green: { halfWidth: 2.389, halfDepth: 2.857 },
  building_tavern_green: { halfWidth: 1.744, halfDepth: 1.983 },
  building_tower_A_green: { halfWidth: 1.233, halfDepth: 1.431 },
  building_tower_base_green: { halfWidth: 2.766, halfDepth: 3.306 },
  building_tower_B_green: { halfWidth: 1.73, halfDepth: 1.998 },
  building_tower_catapult_green: { halfWidth: 0.326, halfDepth: 0.457 },
  building_watermill_green: { halfWidth: 1.047, halfDepth: 1.233 },
  building_well_green: { halfWidth: 0.694, halfDepth: 0.8 },
  building_windmill_green: { halfWidth: 1.152, halfDepth: 0.835 },
  building_archeryrange_red: { halfWidth: 2.485, halfDepth: 2.306 },
  building_barracks_red: { halfWidth: 2.142, halfDepth: 2.329 },
  building_blacksmith_red: { halfWidth: 1.916, halfDepth: 1.853 },
  building_castle_red: { halfWidth: 2.519, halfDepth: 2.877 },
  building_church_red: { halfWidth: 1.531, halfDepth: 1.719 },
  building_home_A_red: { halfWidth: 1.18, halfDepth: 1.272 },
  building_home_B_red: { halfWidth: 1.301, halfDepth: 1.634 },
  building_lumbermill_red: { halfWidth: 0.582, halfDepth: 0.506 },
  building_market_red: { halfWidth: 2.68, halfDepth: 1.959 },
  building_mine_red: { halfWidth: 2.389, halfDepth: 2.857 },
  building_tavern_red: { halfWidth: 1.744, halfDepth: 1.983 },
  building_tower_A_red: { halfWidth: 1.233, halfDepth: 1.431 },
  building_tower_base_red: { halfWidth: 2.766, halfDepth: 3.306 },
  building_tower_B_red: { halfWidth: 1.73, halfDepth: 1.998 },
  building_tower_catapult_red: { halfWidth: 0.326, halfDepth: 0.457 },
  building_watermill_red: { halfWidth: 1.047, halfDepth: 1.233 },
  building_well_red: { halfWidth: 0.694, halfDepth: 0.8 },
  building_windmill_red: { halfWidth: 1.152, halfDepth: 0.835 },
  building_archeryrange_yellow: { halfWidth: 2.485, halfDepth: 2.306 },
  building_barracks_yellow: { halfWidth: 2.142, halfDepth: 2.329 },
  building_blacksmith_yellow: { halfWidth: 1.916, halfDepth: 1.853 },
  building_castle_yellow: { halfWidth: 2.519, halfDepth: 2.877 },
  building_church_yellow: { halfWidth: 1.531, halfDepth: 1.719 },
  building_home_A_yellow: { halfWidth: 1.18, halfDepth: 1.272 },
  building_home_B_yellow: { halfWidth: 1.301, halfDepth: 1.634 },
  building_lumbermill_yellow: { halfWidth: 0.582, halfDepth: 0.506 },
  building_market_yellow: { halfWidth: 2.68, halfDepth: 1.959 },
  building_mine_yellow: { halfWidth: 2.389, halfDepth: 2.857 },
  building_tavern_yellow: { halfWidth: 1.744, halfDepth: 1.983 },
  building_tower_A_yellow: { halfWidth: 1.233, halfDepth: 1.431 },
  building_tower_base_yellow: { halfWidth: 2.766, halfDepth: 3.306 },
  building_tower_B_yellow: { halfWidth: 1.73, halfDepth: 1.998 },
  building_tower_catapult_yellow: { halfWidth: 0.326, halfDepth: 0.457 },
  building_watermill_yellow: { halfWidth: 1.047, halfDepth: 1.233 },
  building_well_yellow: { halfWidth: 0.694, halfDepth: 0.8 },
  building_windmill_yellow: { halfWidth: 1.152, halfDepth: 0.835 },
  building_destroyed: { halfWidth: 1.632, halfDepth: 1.385 },
  building_scaffolding: { halfWidth: 2.021, halfDepth: 2.243 },
  building_stage_A: { halfWidth: 1.105, halfDepth: 0.924 },
  building_stage_B: { halfWidth: 1.084, halfDepth: 1.201 },
  building_stage_C: { halfWidth: 1.23, halfDepth: 1.195 },
  fence_stone_straight: { halfWidth: 0.171, halfDepth: 0.985 },
  fence_wood_straight: { halfWidth: 0.085, halfDepth: 0.981 },
  wall_corner_A_inside: { halfWidth: 1.569, halfDepth: 1.204 },
  wall_corner_A_outside: { halfWidth: 1.496, halfDepth: 1.217 },
  wall_corner_B_inside: { halfWidth: 0.818, halfDepth: 1.246 },
  wall_corner_B_outside: { halfWidth: 0.819, halfDepth: 1.147 },
  wall_straight: { halfWidth: 1.7, halfDepth: 0.68 },
};

// Solid rectangles for a structure, in local (unrotated) space - one entry per wall/pillar
// segment, mirroring exactly what buildWall/buildDoor/buildTower/buildGate render as solid.
// "building" looks up its footprint by modelId in BUILDING_FOOTPRINT above (a whole-building asset
// isn't a simple wall/pillar shape) - an unrecognized/missing modelId falls through to `default`,
// which also covers the original reason that branch existed: a runtime safety net for a stale/
// unrecognized kind value living in the database mid-rollout of a StructureKind change, so a bad
// row makes that one structure decoration-only instead of crashing every collision/line-of-sight
// check on the server.
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
    case "building": {
      const footprint = def.modelId ? BUILDING_FOOTPRINT[def.modelId] : undefined;
      return footprint ? [{ localX: 0, localZ: 0, halfWidth: footprint.halfWidth, halfDepth: footprint.halfDepth }] : [];
    }
    default:
      return [];
  }
}

// Pushes (x, z) out of any structure it currently overlaps, treating the mover as a circle of
// PLAYER_COLLISION_RADIUS. Server-authoritative (see CombatEngine.tickPlayerMovement) - a
// structure with no colliders (a door, or a building with no BUILDING_FOOTPRINT entry) just never
// matches anything in the inner loop below, same as any other structure the player isn't near.
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

// A single AABB per outdoor decoration kind, in local (unrotated, pre-scale) space - same
// offline-computed-from-the-real-GLTF-bounding-box technique as BUILDING_FOOTPRINT above (see its
// own doc comment for the exact method/fudge factor), so the collision box always matches what's
// actually drawn regardless of how tall/wide/thin a given model is.
// Deliberately covers only the outdoor Decoration/Nature/Props palette kinds (rock/tree/hill/
// mountain variants and the KayKit standalone prop set) - table/chair/barrel/crate/bookshelf stay
// walk-through (they're indoor dungeon-room dressing, where blocking every small prop would hurt
// combat positioning in tight spaces) and so do cloudBig/cloudSmall (floating sky decoration - a
// ground-plane collider under something that isn't touching the ground would feel broken). No
// entry -> getFurnitureColliders' default case returns [], same non-blocking behavior as before.
export const FURNITURE_FOOTPRINT: Record<string, { halfWidth: number; halfDepth: number }> = {
  hill: { halfWidth: 1.842, halfDepth: 1.343 },
  hillB: { halfWidth: 1.212, halfDepth: 1.657 },
  hillC: { halfWidth: 0.888, halfDepth: 1.148 },
  hillsA: { halfWidth: 2.442, halfDepth: 2.417 },
  hillsATrees: { halfWidth: 1.68, halfDepth: 1.663 },
  hillsB: { halfWidth: 4.107, halfDepth: 4.525 },
  hillsBTrees: { halfWidth: 1.281, halfDepth: 1.411 },
  hillsC: { halfWidth: 2.926, halfDepth: 2.823 },
  hillsCTrees: { halfWidth: 1.614, halfDepth: 1.807 },
  rock: { halfWidth: 0.914, halfDepth: 0.87 },
  rockB: { halfWidth: 0.453, halfDepth: 0.394 },
  rockC: { halfWidth: 0.375, halfDepth: 0.376 },
  rockD: { halfWidth: 0.374, halfDepth: 0.326 },
  rockE: { halfWidth: 0.533, halfDepth: 0.379 },
  tree: { halfWidth: 0.449, halfDepth: 0.427 },
  treeB: { halfWidth: 0.528, halfDepth: 0.555 },
  treeACut: { halfWidth: 0.087, halfDepth: 0.083 },
  treeBCut: { halfWidth: 0.13, halfDepth: 0.137 },
  treesACut: { halfWidth: 1.349, halfDepth: 1.366 },
  treesALarge: { halfWidth: 2.856, halfDepth: 2.887 },
  treesAMedium: { halfWidth: 1.609, halfDepth: 1.667 },
  treesASmall: { halfWidth: 1.203, halfDepth: 1.21 },
  treesBCut: { halfWidth: 1.204, halfDepth: 1.255 },
  treesBLarge: { halfWidth: 2.007, halfDepth: 2.098 },
  treesBMedium: { halfWidth: 1.754, halfDepth: 1.725 },
  treesBSmall: { halfWidth: 1.225, halfDepth: 1.05 },
  mountainA: { halfWidth: 1.289, halfDepth: 1.343 },
  mountainB: { halfWidth: 1.038, halfDepth: 1.081 },
  mountainC: { halfWidth: 1.19, halfDepth: 1.368 },
  mountainAGrass: { halfWidth: 1.224, halfDepth: 1.275 },
  mountainAGrassTrees: { halfWidth: 0.942, halfDepth: 0.953 },
  mountainBGrass: { halfWidth: 1, halfDepth: 1.042 },
  mountainBGrassTrees: { halfWidth: 0.795, halfDepth: 0.828 },
  mountainCGrass: { halfWidth: 1.154, halfDepth: 1.328 },
  mountainCGrassTrees: { halfWidth: 0.92, halfDepth: 1.058 },
  waterlilyA: { halfWidth: 0.54, halfDepth: 0.538 },
  waterlilyB: { halfWidth: 0.943, halfDepth: 0.94 },
  waterplantA: { halfWidth: 0.255, halfDepth: 0.277 },
  waterplantB: { halfWidth: 0.132, halfDepth: 0.086 },
  waterplantC: { halfWidth: 0.153, halfDepth: 0.167 },
  hexBarrel: { halfWidth: 0.283, halfDepth: 0.283 },
  bucketArrows: { halfWidth: 0.196, halfDepth: 0.199 },
  bucketEmpty: { halfWidth: 0.195, halfDepth: 0.195 },
  bucketWater: { halfWidth: 0.198, halfDepth: 0.198 },
  hexCrateBigA: { halfWidth: 0.293, halfDepth: 0.293 },
  hexCrateSmallA: { halfWidth: 0.195, halfDepth: 0.195 },
  hexCrateBigB: { halfWidth: 0.293, halfDepth: 0.293 },
  hexCrateSmallB: { halfWidth: 0.195, halfDepth: 0.195 },
  hexCrateLongA: { halfWidth: 0.567, halfDepth: 0.283 },
  hexCrateLongB: { halfWidth: 0.567, halfDepth: 0.283 },
  hexCrateLongC: { halfWidth: 0.565, halfDepth: 0.283 },
  hexCrateLongEmpty: { halfWidth: 0.567, halfDepth: 0.283 },
  hexCrateOpen: { halfWidth: 0.466, halfDepth: 0.281 },
  flagBlue: { halfWidth: 0.117, halfDepth: 0.562 },
  flagGreen: { halfWidth: 0.117, halfDepth: 0.562 },
  flagRed: { halfWidth: 0.117, halfDepth: 0.562 },
  flagYellow: { halfWidth: 0.117, halfDepth: 0.562 },
  ladder: { halfWidth: 0.355, halfDepth: 0.071 },
  pallet: { halfWidth: 0.414, halfDepth: 0.414 },
  resourceLumber: { halfWidth: 0.958, halfDepth: 0.462 },
  resourceStone: { halfWidth: 0.588, halfDepth: 0.5 },
  sack: { halfWidth: 0.147, halfDepth: 0.22 },
  archeryTarget: { halfWidth: 0.337, halfDepth: 0.2 },
  tent: { halfWidth: 0.722, halfDepth: 0.722 },
  weaponrack: { halfWidth: 0.28, halfDepth: 0.182 },
  wheelbarrow: { halfWidth: 0.333, halfDepth: 0.707 },
};

// Mirrors getStructureColliders' shape/purpose, but for furniture: looks up a per-kind footprint
// in FURNITURE_FOOTPRINT above - a kind with no entry there (indoor dungeon furniture, clouds)
// stays walk-through, same as before this table existed.
export function getFurnitureColliders(kind: FurnitureKind): StructureCollider[] {
  const footprint = FURNITURE_FOOTPRINT[kind];
  return footprint ? [{ localX: 0, localZ: 0, halfWidth: footprint.halfWidth, halfDepth: footprint.halfDepth }] : [];
}

// Mirrors resolveStructureCollisions exactly, just against FURNITURE instead of STRUCTURES - see
// that function's own doc comment. Non-blocking furniture kinds never reach the inner loop since
// getFurnitureColliders returns no colliders for them.
export function resolveFurnitureCollisions(x: number, z: number, furniture: FurnitureDef[]): { x: number; z: number } {
  for (const def of furniture) {
    const cosT = Math.cos(def.rotationY);
    const sinT = Math.sin(def.rotationY);
    const dx = x - def.x;
    const dz = z - def.z;
    let localX = dx * cosT - dz * sinT;
    let localZ = dx * sinT + dz * cosT;

    for (const collider of getFurnitureColliders(def.kind)) {
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
// plane only and stays that way; nothing here is authoritative game state. Height comes from the
// discrete, ramp-covered hex elevation system (hex.ts's getHexElevation) rather than continuous
// noise - a rigid mosaic of tile instances can't be smoothly displaced the way a single deformable
// mesh could, so elevation has to be a small integer level per cell with real ramp geometry
// bridging the one boundary case, not an arbitrary analytic height sampled independently per tile.
// ---------------------------------------------------------------------------------------------

// Set once per client session (client/src/game/Scene.ts) - "overworld (3, -2)" and "dungeon
// (3, -2)" are numerically indistinguishable from x/z alone, so getTerrainHeight below needs to
// know which content to reclassify against (or that there's no elevation at all, e.g. the
// character-select/login scenes). "dungeon" always reclassifies fresh against dungeonHexContent()
// rather than ever touching the overworld's live-cached hex state - see that function's own
// comment for why the two dungeon-scoped globals it reads from exist.
export type TerrainMode = "flat" | "overworld" | "dungeon";
export let TERRAIN_MODE: TerrainMode = "flat";
export function setTerrainMode(mode: TerrainMode) {
  TERRAIN_MODE = mode;
}

// `structures`/`regionHalfExtent` are accepted for source compatibility with existing call sites
// but no longer used - elevation now comes from hex.ts's live-cached getHexElevation (overworld)
// or dungeonHexContent() (dungeon), which read their own full live content (not just structures)
// on their own. The admin map editor, which previews maps that may not be the currently-active
// one, calls getHexElevation directly with its own fetched-and-filtered content instead of through
// this function - see MapEditor.tsx.
export function getTerrainHeight(
  x: number,
  z: number,
  _structures: StructureDef[] = STRUCTURES,
  _regionHalfExtent: number = MAP_HALF_EXTENT,
): number {
  if (TERRAIN_MODE === "flat") return 0;
  if (TERRAIN_MODE === "dungeon") return getHexElevation(x, z, dungeonHexContent()) * HEX_ELEVATION_STEP_WORLD;
  return getHexElevation(x, z) * HEX_ELEVATION_STEP_WORLD;
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
  spawnX?: number;
  spawnZ?: number;
  bossArenaX?: number;
  bossArenaZ?: number;
  bossArenaRadius?: number;
}

export let ACTIVE_MAP: GameMapDef | null = null;

// A fixed point in the dungeon a mob stands at from the moment the instance is created - same
// shape/contract as the overworld's EnemySpawnDef (id doubles as the live Enemy's key in state,
// respawnMs governs how long after death it reappears there). The one entry whose enemyTypeId
// resolves to a "boss"-behavior EnemyTypeDef is what the run is building toward - see
// DungeonRoom.handleEnemyKilled, which sets `cleared` and skips respawn once it dies.
export interface DungeonSpawnDef {
  id: string;
  enemyTypeId: EnemyTypeId;
  x: number;
  z: number;
  respawnMs?: number;
}

export interface DungeonDef {
  id: DungeonId;
  name: string;
  mapId: MapId;
  isActive: boolean;
  partySize: number;
  composition: Record<ClassRole, number>;
  spawns: DungeonSpawnDef[];
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
  spawnZones: EnemySpawnZoneDef[];
  structures: StructureDef[];
  waypoints: WaypointDef[];
  respawnPoints: RespawnPointDef[];
  furniture: FurnitureDef[];
  hexTiles: HexTileOverrideDef[];
  recipes: RecipeDef[];
  gatheringNodeTypes: GatheringNodeTypeDef[];
  gatheringNodes: GatheringNodeDef[];
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
  RECIPES = Object.fromEntries(snapshot.recipes.map((r) => [r.id, r]));
  GATHERING_NODE_TYPES = Object.fromEntries(snapshot.gatheringNodeTypes.map((t) => [t.id, t]));

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
  SPAWN_ZONES = snapshot.spawnZones.filter((z) => z.mapId === ACTIVE_MAP?.id);
  STRUCTURES = snapshot.structures.filter((s) => s.mapId === ACTIVE_MAP?.id);
  WAYPOINTS = snapshot.waypoints.filter((w) => w.mapId === ACTIVE_MAP?.id);
  // Overworld-only (mirrors WAYPOINTS, not DUNGEON_WAYPOINTS) - a dungeon run is a single fixed-
  // spawn attempt (see roomUtil.ts's plain respawnPlayerPosition, still used by DungeonRoom
  // unchanged), it has no graveyard concept of its own.
  RESPAWN_POINTS = snapshot.respawnPoints.filter((r) => r.mapId === ACTIVE_MAP?.id);
  FURNITURE = snapshot.furniture.filter((f) => f.mapId === ACTIVE_MAP?.id);
  HEX_TILE_OVERRIDES = snapshot.hexTiles.filter((h) => h.mapId === ACTIVE_MAP?.id);
  GATHERING_NODES = snapshot.gatheringNodes.filter((n) => n.mapId === ACTIVE_MAP?.id);

  // Same shape as the ACTIVE_MAP-scoped bindings just above, but scoped to the active dungeon's
  // own map row instead - see DUNGEON_STRUCTURES's own doc comment.
  DUNGEON_STRUCTURES = snapshot.structures.filter((s) => s.mapId === ACTIVE_DUNGEON?.mapId);
  DUNGEON_NPCS = Object.fromEntries(snapshot.npcs.filter((n) => n.mapId === ACTIVE_DUNGEON?.mapId).map((n) => [n.id, n]));
  DUNGEON_WAYPOINTS = snapshot.waypoints.filter((w) => w.mapId === ACTIVE_DUNGEON?.mapId);
  DUNGEON_SPAWN_POINTS = snapshot.spawns.filter((s) => s.mapId === ACTIVE_DUNGEON?.mapId);
  DUNGEON_HEX_TILE_OVERRIDES = snapshot.hexTiles.filter((h) => h.mapId === ACTIVE_DUNGEON?.mapId);

  if (ACTIVE_MAP) {
    MAP_HALF_EXTENT = ACTIVE_MAP.halfExtent;
    if (ACTIVE_MAP.portalX != null && ACTIVE_MAP.portalZ != null) {
      PORTAL_POSITION = { x: ACTIVE_MAP.portalX, z: ACTIVE_MAP.portalZ };
    }
    if (ACTIVE_MAP.spawnX != null && ACTIVE_MAP.spawnZ != null) {
      SPAWN_POSITION = { x: ACTIVE_MAP.spawnX, z: ACTIVE_MAP.spawnZ };
    }
    if (ACTIVE_MAP.bossArenaX != null && ACTIVE_MAP.bossArenaZ != null) {
      BOSS_ARENA_CENTER = { x: ACTIVE_MAP.bossArenaX, z: ACTIVE_MAP.bossArenaZ };
    }
    if (ACTIVE_MAP.bossArenaRadius != null) BOSS_ARENA_RADIUS = ACTIVE_MAP.bossArenaRadius;
  }
  if (dungeonMap) {
    DUNGEON_HALF_EXTENT = dungeonMap.halfExtent;
    if (dungeonMap.spawnX != null && dungeonMap.spawnZ != null) {
      DUNGEON_SPAWN_POSITION = { x: dungeonMap.spawnX, z: dungeonMap.spawnZ };
    }
  }
  if (ACTIVE_DUNGEON) {
    DUNGEON_PARTY_SIZE = ACTIVE_DUNGEON.partySize;
    DUNGEON_COMPOSITION = ACTIVE_DUNGEON.composition;
  }

  // The hex terrain classifier (hex.ts) derives everything from the bindings just reassigned
  // above (STRUCTURES/NPCS/WAYPOINTS/SPAWN_POINTS/BOSS_ARENA_*/PORTAL_POSITION) - its cached road
  // network and passability answers go stale the moment any of those change, which happens live
  // on every admin CRUD mutation (reloadGameContent), not just once at boot.
  resetHexTerrainCache();
}
