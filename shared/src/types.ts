export const WORLD_ROOM_NAME = "world_room";

export const PLAYER_SPEED = 4; // meters per second, server-authoritative

export const MAP_HALF_EXTENT = 20; // flat test ground spans [-20, 20] on x and z

export interface InputMessage {
  moveX: number; // normalized direction, -1..1
  moveZ: number; // normalized direction, -1..1
  seq: number; // client-assigned sequence number, echoed back for reconciliation
}

export type EnemyKind = "melee" | "caster";

export interface PlayerStats {
  strength: number;
  dexterity: number;
  intellect: number;
  vitality: number;
  luck: number;
  armor: number;
}

export const BASE_STATS: PlayerStats = {
  strength: 5,
  dexterity: 5,
  intellect: 5,
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

export const DAMAGE_STAT_FACTOR = 0.3; // flat damage bonus = floor((str+dex+int) * factor)
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

export type SpellId = 1 | 2 | 3;

export interface SpellDef {
  name: string;
  damage: number;
  cooldownMs: number;
  range: number;
  castTimeMs: number;
  projectileSpeed?: number;
}

export const SPELLS: Record<SpellId, SpellDef> = {
  1: { name: "Bolt", damage: 8, cooldownMs: 800, range: 8, castTimeMs: 0 },
  2: { name: "Strike", damage: 20, cooldownMs: 2500, range: 6, castTimeMs: 0 },
  3: { name: "Fireball", damage: 30, cooldownMs: 4000, range: 10, castTimeMs: 1500, projectileSpeed: 8 },
};

export const ENEMY_STATS = {
  melee: { maxHp: 40, damage: 8, range: 1.8, intervalMs: 1500 },
  caster: { maxHp: 25, damage: 6, range: 10, cooldownMs: 2200, projectileSpeed: 6, castTimeMs: 1000 },
} as const;

export const PROJECTILE_HIT_RADIUS = 0.6;

export const ENEMY_RESPAWN_MS = 6000;

export const PROJECTILE_MAX_LIFETIME_MS = 4000;

export interface CastMessage {
  spellId: SpellId;
  targetId: string;
}
