export const WORLD_ROOM_NAME = "world_room";

export const PLAYER_SPEED = 4; // meters per second, server-authoritative

export const MAP_HALF_EXTENT = 20; // flat test ground spans [-20, 20] on x and z

export interface InputMessage {
  moveX: number; // normalized direction, -1..1
  moveZ: number; // normalized direction, -1..1
  seq: number; // client-assigned sequence number, echoed back for reconciliation
}

export type EnemyKind = "melee" | "caster";

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
export type ClassId = "warrior" | "rogue" | "ranger" | "oracle" | "mage";

export interface ClassDef {
  name: string;
  mainStat: MainStat;
}

export const CLASSES: Record<ClassId, ClassDef> = {
  warrior: { name: "Warrior", mainStat: "strength" },
  rogue: { name: "Rogue", mainStat: "dexterity" },
  ranger: { name: "Ranger", mainStat: "dexterity" },
  oracle: { name: "Oracle", mainStat: "intellect" },
  mage: { name: "Mage", mainStat: "intellect" },
};

export const DEFAULT_CLASS_ID: ClassId = "warrior";
export const MAIN_STAT_START_BONUS = 5; // extra points in your class's main stat at level 1

export const DAMAGE_STAT_FACTOR = 0.3; // flat damage/heal bonus = floor(mainStat * factor)
export const CRIT_PER_LUCK = 1.5; // % crit chance per luck point
export const MAX_CRIT_CHANCE = 75; // %
export const CRIT_MULTIPLIER = 1.5;

export const XP_PER_ENEMY_KIND: Record<EnemyKind, number> = {
  melee: 20,
  caster: 30,
};

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

function spell(def: Omit<SpellDef, "id"> & { slug: string }): SpellDef {
  const { slug, ...rest } = def;
  return { id: `${def.classId}_${slug}`, ...rest };
}

export const SPELLS: Record<SpellId, SpellDef> = Object.fromEntries(
  [
    // Warrior
    spell({
      classId: "warrior",
      slug: "slash",
      name: "Slash",
      description: "A quick, brutal cut.",
      effectType: "damage",
      targetType: "enemy",
      amount: 14,
      cooldownMs: 1200,
      range: 2.5,
      castTimeMs: 0,
    }),
    spell({
      classId: "warrior",
      slug: "shield_bash",
      name: "Shield Bash",
      description: "Slams a foe with your shield, breaking their concentration.",
      effectType: "damage",
      targetType: "enemy",
      amount: 6,
      interruptsCast: true,
      cooldownMs: 6000,
      range: 2.5,
      castTimeMs: 0,
    }),
    spell({
      classId: "warrior",
      slug: "whirlwind",
      name: "Whirlwind",
      description: "Spin and strike every enemy in reach.",
      effectType: "damage",
      targetType: "self",
      amount: 10,
      aoeRadius: 4,
      cooldownMs: 4000,
      range: 4,
      castTimeMs: 0,
    }),

    // Rogue
    spell({
      classId: "rogue",
      slug: "backstab",
      name: "Backstab",
      description: "A blade in exactly the wrong place.",
      effectType: "damage",
      targetType: "enemy",
      amount: 16,
      cooldownMs: 1200,
      range: 2.5,
      castTimeMs: 0,
    }),
    spell({
      classId: "rogue",
      slug: "garrote",
      name: "Garrote",
      description: "Chokes off a foe's breath, and their spell.",
      effectType: "damage",
      targetType: "enemy",
      amount: 6,
      interruptsCast: true,
      cooldownMs: 6000,
      range: 2.5,
      castTimeMs: 0,
    }),
    spell({
      classId: "rogue",
      slug: "fan_of_knives",
      name: "Fan of Knives",
      description: "A spray of blades around your target.",
      effectType: "damage",
      targetType: "enemy",
      amount: 10,
      aoeRadius: 4,
      cooldownMs: 4000,
      range: 2.5,
      castTimeMs: 0,
    }),

    // Ranger
    spell({
      classId: "ranger",
      slug: "aimed_shot",
      name: "Aimed Shot",
      description: "A carefully placed arrow.",
      effectType: "damage",
      targetType: "enemy",
      amount: 18,
      cooldownMs: 1500,
      range: 9,
      castTimeMs: 400,
      projectileSpeed: 12,
    }),
    spell({
      classId: "ranger",
      slug: "disabling_shot",
      name: "Disabling Shot",
      description: "Pins a caster's hands before they finish the gesture.",
      effectType: "interrupt",
      targetType: "enemy",
      cooldownMs: 6000,
      range: 9,
      castTimeMs: 0,
    }),
    spell({
      classId: "ranger",
      slug: "explosive_trap",
      name: "Explosive Trap",
      description: "Rigs a patch of ground to blow.",
      effectType: "damage",
      targetType: "ground",
      amount: 16,
      aoeRadius: 3,
      cooldownMs: 5000,
      range: 8,
      castTimeMs: 500,
    }),

    // Oracle
    spell({
      classId: "oracle",
      slug: "smite",
      name: "Smite",
      description: "A bolt of judgment.",
      effectType: "damage",
      targetType: "enemy",
      amount: 14,
      cooldownMs: 1500,
      range: 9,
      castTimeMs: 300,
      projectileSpeed: 10,
    }),
    spell({
      classId: "oracle",
      slug: "renew",
      name: "Renew",
      description: "Knits flesh and spirit back together. Heals yourself if no ally is targeted.",
      effectType: "heal",
      targetType: "ally",
      amount: 20,
      cooldownMs: 3000,
      range: 8,
      castTimeMs: 800,
    }),
    spell({
      classId: "oracle",
      slug: "cleanse",
      name: "Cleanse",
      description: "Washes away ailments afflicting an ally (or yourself).",
      effectType: "dispel",
      targetType: "ally",
      cooldownMs: 8000,
      range: 8,
      castTimeMs: 0,
    }),

    // Mage
    spell({
      classId: "mage",
      slug: "frostbolt",
      name: "Frostbolt",
      description: "A shard of ice, slow to arrive and hard to forgive.",
      effectType: "damage",
      targetType: "enemy",
      amount: 22,
      cooldownMs: 2000,
      range: 9,
      castTimeMs: 1000,
      projectileSpeed: 9,
    }),
    spell({
      classId: "mage",
      slug: "blizzard",
      name: "Blizzard",
      description: "Calls down a storm over a patch of ground.",
      effectType: "damage",
      targetType: "ground",
      amount: 18,
      aoeRadius: 3.5,
      cooldownMs: 6000,
      range: 9,
      castTimeMs: 1200,
    }),
    spell({
      classId: "mage",
      slug: "counterspell",
      name: "Counterspell",
      description: "Unravels a spell before it finishes forming.",
      effectType: "interrupt",
      targetType: "enemy",
      cooldownMs: 8000,
      range: 9,
      castTimeMs: 0,
    }),
  ].map((def) => [def.id, def]),
);

export const ENEMY_STATS = {
  melee: { maxHp: 40, damage: 8, range: 1.8, intervalMs: 1500 },
  caster: { maxHp: 25, damage: 6, range: 10, cooldownMs: 2200, projectileSpeed: 6, castTimeMs: 1000 },
} as const;

export const PROJECTILE_HIT_RADIUS = 0.6;

export const ENEMY_RESPAWN_MS = 6000;

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
  name: string;
  slot: EquipSlot;
  bonuses: Partial<PlayerStats>;
  icon: string;
  description: string;
}

export const ITEMS: Record<string, ItemDef> = {
  rusty_sword: {
    name: "Rusty Sword",
    slot: "weapon",
    bonuses: { mainStat: 3 },
    icon: "🗡️",
    description: "Pitted and dull, but it still holds an edge.",
  },
  hunting_bow: {
    name: "Hunting Bow",
    slot: "weapon",
    bonuses: { mainStat: 3 },
    icon: "🏹",
    description: "Favored by scouts for its light draw weight.",
  },
  apprentice_wand: {
    name: "Apprentice Wand",
    slot: "weapon",
    bonuses: { mainStat: 3 },
    icon: "🪄",
    description: "A first wand, worn smooth by nervous hands.",
  },
  leather_vest: {
    name: "Leather Vest",
    slot: "armor",
    bonuses: { vitality: 2, armor: 2 },
    icon: "🦺",
    description: "Boiled leather, stiff enough to turn a blade.",
  },
  chainmail_hauberk: {
    name: "Chainmail Hauberk",
    slot: "armor",
    bonuses: { armor: 5 },
    icon: "🥋",
    description: "Interlocked rings, heavy but dependable.",
  },
  padded_robe: {
    name: "Padded Robe",
    slot: "armor",
    bonuses: { vitality: 3, mainStat: 1 },
    icon: "👘",
    description: "Woven with faint warding sigils along the hem.",
  },
  lucky_charm: {
    name: "Lucky Charm",
    slot: "trinket",
    bonuses: { luck: 4 },
    icon: "🍀",
    description: "Rumored to have never left its owner's pocket.",
  },
  signet_ring: {
    name: "Signet Ring",
    slot: "trinket",
    bonuses: { mainStat: 4 },
    icon: "💍",
    description: "A minor house crest, edges worn smooth.",
  },
  amulet_of_vigor: {
    name: "Amulet of Vigor",
    slot: "trinket",
    bonuses: { vitality: 3 },
    icon: "📿",
    description: "Warm to the touch, even in the cold.",
  },
};

export const ITEM_IDS = Object.keys(ITEMS);

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
const TALENT_MAX_RANK = 12;

function talent(
  classId: ClassId,
  slug: string,
  name: string,
  description: string,
  effectKey: TalentEffectKey,
  perRank: number,
): TalentDef {
  return { id: `${classId}_${slug}`, classId, name, description, maxRank: TALENT_MAX_RANK, effectKey, perRank };
}

export const TALENTS: Record<string, TalentDef> = Object.fromEntries(
  [
    talent("warrior", "iron_skin", "Iron Skin", "Years of taking hits taught your body to shrug them off.", "armorBonus", 1),
    talent("warrior", "crushing_blows", "Crushing Blows", "Every swing carries a little more weight.", "damagePercent", 1.5),
    talent(
      "warrior",
      "stalwart_heart",
      "Stalwart Heart",
      "Your resolve keeps you standing after lesser warriors would fall.",
      "maxHpPercent",
      1.25,
    ),
    talent("warrior", "battle_fury", "Battle Fury", "Momentum builds with every clash.", "cooldownPercent", 0.8),
    talent(
      "warrior",
      "killer_instinct",
      "Killer Instinct",
      "You've learned exactly where the armor gives.",
      "critChanceBonus",
      0.6,
    ),

    talent("rogue", "cutthroat", "Cutthroat", "You don't need much of an opening.", "critChanceBonus", 0.6),
    talent(
      "rogue",
      "fleet_footed",
      "Fleet Footed",
      "Never in one place long enough to be predictable.",
      "cooldownPercent",
      0.8,
    ),
    talent("rogue", "vicious_strikes", "Vicious Strikes", "Precision over brute force.", "damagePercent", 1.5),
    talent(
      "rogue",
      "hardened_reflexes",
      "Hardened Reflexes",
      "If you can't dodge it, you'd better be able to take it.",
      "armorBonus",
      1,
    ),
    talent("rogue", "grim_endurance", "Grim Endurance", "A life of close calls builds a thick skin.", "maxHpPercent", 1.25),

    talent(
      "ranger",
      "marksmans_eye",
      "Marksman's Eye",
      "You aim for the gaps others don't even see.",
      "critChanceBonus",
      0.6,
    ),
    talent(
      "ranger",
      "quickdraw",
      "Quickdraw",
      "Nocked, drawn, loosed — before they've registered the threat.",
      "cooldownPercent",
      0.8,
    ),
    talent("ranger", "hunters_focus", "Hunter's Focus", "Every shot is a lesson from the last.", "damagePercent", 1.5),
    talent("ranger", "camouflage", "Camouflage", "Half-seen is half-hit.", "armorBonus", 1),
    talent(
      "ranger",
      "wilderness_vigor",
      "Wilderness Vigor",
      "Years in the field harden more than just your aim.",
      "maxHpPercent",
      1.25,
    ),

    talent("oracle", "focused_mind", "Focused Mind", "Clarity finds the weak point in anything.", "critChanceBonus", 0.6),
    talent("oracle", "swift_rites", "Swift Rites", "The words come easier with practice.", "cooldownPercent", 0.8),
    talent("oracle", "arcane_insight", "Arcane Insight", "Understanding is its own weapon.", "damagePercent", 1.5),
    talent("oracle", "warding_sigil", "Warding Sigil", "A shimmer of protection, always half-drawn.", "armorBonus", 1),
    talent(
      "oracle",
      "vital_current",
      "Vital Current",
      "Life force ebbs and flows — you've learned to hold onto more of it.",
      "maxHpPercent",
      1.25,
    ),

    talent("mage", "piercing_cold", "Piercing Cold", "Ice finds every crack.", "critChanceBonus", 0.6),
    talent("mage", "overchannel", "Overchannel", "You've stopped waiting for the mana to settle.", "cooldownPercent", 0.8),
    talent("mage", "arcane_power", "Arcane Power", "Raw force, barely contained.", "damagePercent", 1.5),
    talent("mage", "mana_shield", "Mana Shield", "A thin barrier is still a barrier.", "armorBonus", 1),
    talent("mage", "deep_reserves", "Deep Reserves", "More to draw on means more to survive.", "maxHpPercent", 1.25),
  ].map((def) => [def.id, def]),
);

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
  id: string;
  name: string;
  x: number;
  z: number;
  questIds: string[];
}

export const NPCS: Record<string, NpcDef> = {
  quest_giver: { id: "quest_giver", name: "Weary Quartermaster", x: 0, z: -3, questIds: ["kill_melee_3", "kill_caster_3"] },
};

export type QuestId = string;

export interface QuestDef {
  id: QuestId;
  name: string;
  description: string;
  giverNpcId: string;
  objectiveEnemyKind: EnemyKind;
  objectiveCount: number;
  rewardXp: number;
  rewardItemId?: string;
}

export const QUESTS: Record<QuestId, QuestDef> = {
  kill_melee_3: {
    id: "kill_melee_3",
    name: "Thin the Ranks",
    description: "Melee attackers keep probing the perimeter. Kill 3 of them.",
    giverNpcId: "quest_giver",
    objectiveEnemyKind: "melee",
    objectiveCount: 3,
    rewardXp: 150,
    rewardItemId: "lucky_charm",
  },
  kill_caster_3: {
    id: "kill_caster_3",
    name: "Silence the Casters",
    description: "Enemy casters are the bigger threat. Kill 3 of them.",
    giverNpcId: "quest_giver",
    objectiveEnemyKind: "caster",
    objectiveCount: 3,
    rewardXp: 200,
    rewardItemId: "signet_ring",
  },
};

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
