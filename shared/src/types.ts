export const WORLD_ROOM_NAME = "world_room";

export const PLAYER_SPEED = 4; // meters per second, server-authoritative

export const MAP_HALF_EXTENT = 20; // flat test ground spans [-20, 20] on x and z

export interface InputMessage {
  moveX: number; // normalized direction, -1..1
  moveZ: number; // normalized direction, -1..1
  seq: number; // client-assigned sequence number, echoed back for reconciliation
}

export type EnemyKind = "melee" | "caster";

export const PLAYER_MAX_HP = 100;

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
