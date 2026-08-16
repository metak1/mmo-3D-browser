import { Client } from "@colyseus/core";
import { MapSchema } from "@colyseus/schema";
import {
  AILMENTS,
  AilmentKind,
  BOSS_ENRAGE_DAMAGE_MULTIPLIER,
  BOSS_PHASE_2_HP_FRACTION,
  BossStats,
  CRIT_MULTIPLIER,
  CasterStats,
  CastMessage,
  ClassId,
  DAMAGE_STAT_FACTOR,
  ENEMY_TYPES,
  INTERRUPT_LOCKOUT_MS,
  InputMessage,
  MAIN_STAT_PER_LEVEL,
  MAP_HALF_EXTENT,
  MAX_LEVEL,
  MeleeStats,
  PLAYER_SPEED,
  PROJECTILE_HIT_RADIUS,
  PROJECTILE_MAX_LIFETIME_MS,
  hasLineOfSight,
  PlayerStats,
  resolveStructureCollisions,
  SPELLS,
  SpellDef,
  SpellId,
  STRUCTURES,
  TALENT_POINTS_PER_LEVEL,
  TalentBonus,
  VITALITY_PER_LEVEL,
  VITALITY_TO_HP,
  BUFFS,
  BuffKind,
  critChanceFromLuck,
  getActiveBuffBonus,
  getEffectiveStats,
  getOnCastBuffs,
  getSpellCharges,
  getTalentBonus,
  resolveClassId,
  xpForNextLevel,
} from "@mmo/shared";
import { Enemy, Player, Projectile } from "../schema/WorldState.js";

const RANGE_BUFFER = 1; // small allowance for latency between client input and server check
const BOSS_ENRAGE_MS = 90_000; // time since first damage taken before the boss enrages

interface PlayerInput {
  moveX: number;
  moveZ: number;
  seq: number;
}

// A cast's target, resolved once at cast-start time from the raw CastMessage. Cast-time
// (windup) spells stash this and re-resolve live units from it at fire time, so a target
// that died/moved mid-windup is re-validated uniformly regardless of target type.
type ResolvedTarget =
  | { kind: "enemy"; id: string }
  | { kind: "ally"; id: string }
  | { kind: "self" }
  | { kind: "ground"; x: number; z: number };

interface PendingPlayerCast {
  spellId: SpellId;
  target: ResolvedTarget;
  fireAt: number;
}

interface PendingEnemyCast {
  targetSessionId: string;
  fireAt: number;
}

export interface CombatState {
  players: MapSchema<Player>;
  enemies: MapSchema<Enemy>;
  projectiles: MapSchema<Projectile>;
}

export interface CombatEngineConfig {
  state: CombatState;
  // Called once an enemy's hp hits 0, after it has already been removed from state and its
  // internal attack-tracking cleared - the room decides what happens next (reward the killer
  // and schedule a respawn in the overworld; grant XP to everyone and advance the encounter
  // in a dungeon).
  onEnemyKilled: (enemyId: string, enemyTypeId: string, killerSessionId: string, x: number, z: number) => void;
  // Called after a dead player's hp/ailments/cast have already been reset - the room decides
  // where they land (the overworld's fixed (0,0,0), or a dungeon's own entry point).
  onPlayerRespawn: (sessionId: string, player: Player) => void;
  // Gates both movement collision and line-of-sight checks (player casts and enemy casts) against
  // STRUCTURES. Only the overworld has any (dungeon coordinates are unrelated small numbers that
  // could otherwise collide with/be blocked by unrelated overworld buildings) - WorldRoom passes
  // true, DungeonRoom leaves this unset.
  collidableStructures?: boolean;
}

// One generic radius-scan reused by every AoE spell (enemies-near-point for damage,
// players-near-point for heal). MapSchema<T> iterates as [id, value] pairs, same as a
// native Map, so this needs no import from @colyseus/schema.
function forEachAlive<T extends { hp: number; x: number; z: number }>(
  units: Iterable<[string, T]>,
  cx: number,
  cz: number,
  radius: number,
  fn: (unit: T, id: string) => void,
) {
  for (const [id, unit] of units) {
    if (unit.hp <= 0) continue;
    if (Math.hypot(unit.x - cx, unit.z - cz) <= radius) fn(unit, id);
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

// Owns every mechanic that's generic over a {players, enemies, projectiles} state shape:
// movement, spell casting/targeting/AoE resolution, enemy AI (including the boss's
// phase/enrage branching), projectile physics, and the damage/heal/ailment formulas.
// WorldRoom and DungeonRoom each construct their own instance over their own state and
// plug in onEnemyKilled/onPlayerRespawn for the parts that actually differ between them.
export class CombatEngine {
  private lastInput = new Map<string, PlayerInput>();
  // key: `${sessionId}:${spellId}`, value: cast timestamps still within their cooldown window,
  // oldest-first, capped at the spell's current max charge count (1 + any extraCharges talents).
  // A spell with no extraCharges talent behaves exactly like the old single-timestamp gate: the
  // array never holds more than one entry.
  private lastCastAt = new Map<string, number[]>();
  private lastMeleeAttackAt = new Map<string, number>(); // key: enemyId
  private lastCasterAttackAt = new Map<string, number>(); // key: enemyId
  private pendingPlayerCast = new Map<string, PendingPlayerCast>(); // key: sessionId
  private pendingEnemyCast = new Map<string, PendingEnemyCast>(); // key: enemyId
  private interruptLockoutUntil = new Map<string, number>(); // key: sessionId or enemyId
  private projectileAge = new Map<string, number>(); // key: projectileId, value: ms alive
  private projectileSeq = 0;

  constructor(private config: CombatEngineConfig) {}

  private get state() {
    return this.config.state;
  }

  // --- Message-driven entry points ---

  handleInput(sessionId: string, message: InputMessage) {
    if (message.moveX !== 0 || message.moveZ !== 0) {
      this.cancelPlayerCast(sessionId);
    }
    this.lastInput.set(sessionId, {
      moveX: clamp(message.moveX, -1, 1),
      moveZ: clamp(message.moveZ, -1, 1),
      seq: message.seq,
    });
  }

  handleCast(client: Client, message: CastMessage) {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.hp <= 0) return;
    if (player.castSpellId !== "") return; // already casting
    if ((this.interruptLockoutUntil.get(client.sessionId) ?? 0) > Date.now()) return;

    const spell = SPELLS[message.spellId];
    if (!spell || spell.classId !== resolveClassId(player.classId)) return;

    const cooldownKey = `${client.sessionId}:${message.spellId}`;
    const now = Date.now();
    const cooldownPercent = this.getCombinedBonusFor(player, message.spellId).cooldownPercent;
    const effectiveCooldownMs = Math.max(100, spell.cooldownMs * (1 - cooldownPercent / 100));
    const maxCharges = 1 + getSpellCharges(resolveClassId(player.classId), message.spellId, player.talentRanks);
    const activeCasts = (this.lastCastAt.get(cooldownKey) ?? []).filter((t) => now - t < effectiveCooldownMs);
    if (activeCasts.length >= maxCharges) return;

    const target = this.resolveCastTarget(player, client.sessionId, spell, message);
    if (!target) return;

    const impact = this.resolveImpactPoint(player, target);
    if (!impact) return;

    const dist = Math.hypot(player.x - impact.x, player.z - impact.z);
    if (dist > spell.range + RANGE_BUFFER) return;

    if (this.config.collidableStructures && !hasLineOfSight(player.x, player.z, impact.x, impact.z, STRUCTURES)) return;

    activeCasts.push(now);
    this.lastCastAt.set(cooldownKey, activeCasts);

    if (spell.castTimeMs > 0) {
      player.castSpellId = message.spellId;
      this.pendingPlayerCast.set(client.sessionId, {
        spellId: message.spellId,
        target,
        fireAt: now + spell.castTimeMs,
      });
    } else {
      this.resolveSpellEffect(player, client.sessionId, spell, target);
    }
  }

  // Called once by the owning room's onLeave, so a disconnected session doesn't leave
  // stale pending-cast/lockout/input entries behind (matches the original WorldRoom
  // cleanup exactly - lastCastAt is intentionally left alone, same as before, since it's
  // keyed by a composite string and was never cleaned up per-session either).
  clearSessionTracking(sessionId: string) {
    this.cancelPlayerCast(sessionId);
    this.lastInput.delete(sessionId);
    this.interruptLockoutUntil.delete(sessionId);
  }

  // --- Stat/formula helpers ---

  getEffectiveStatsFor(player: Player): PlayerStats {
    return getEffectiveStats(
      {
        mainStat: player.mainStat,
        vitality: player.vitality,
        luck: player.luck,
        armor: player.armor,
      },
      { weapon: player.equippedWeapon, armor: player.equippedArmor, trinket: player.equippedTrinket },
    );
  }

  // `spellId` scopes in spellStatBonus talents matching that spell, on top of the always-on
  // statBonus ones - see shared/src/types.ts's getTalentBonus.
  getTalentBonusFor(player: Player, spellId?: SpellId): TalentBonus {
    return getTalentBonus(resolveClassId(player.classId), player.talentRanks, spellId);
  }

  // Talent bonus plus whatever the player's currently active buffs (see BuffKind/BUFFS) add on
  // top - the two are separate sources (spent talent points vs. a timed proc) but combine additively
  // into the same five-key shape, so every caller that used to just read getTalentBonusFor can
  // switch to this without otherwise changing how it uses the result.
  getCombinedBonusFor(player: Player, spellId?: SpellId): TalentBonus {
    const talentBonus = this.getTalentBonusFor(player, spellId);
    const buffBonus = getActiveBuffBonus(player.buffs, Date.now());
    return {
      damagePercent: talentBonus.damagePercent + (buffBonus.damagePercent ?? 0),
      critChanceBonus: talentBonus.critChanceBonus + (buffBonus.critChanceBonus ?? 0),
      cooldownPercent: talentBonus.cooldownPercent + (buffBonus.cooldownPercent ?? 0),
      armorBonus: talentBonus.armorBonus + (buffBonus.armorBonus ?? 0),
      maxHpPercent: talentBonus.maxHpPercent,
    };
  }

  recomputeMaxHp(player: Player) {
    const maxHpPercent = this.getTalentBonusFor(player).maxHpPercent;
    const baseMaxHp = this.getEffectiveStatsFor(player).vitality * VITALITY_TO_HP;
    player.maxHp = Math.round(baseMaxHp * (1 + maxHpPercent / 100));
    player.hp = Math.min(player.hp, player.maxHp);
  }

  grantXp(player: Player, amount: number) {
    player.xp += amount;

    while (player.level < MAX_LEVEL && player.xp >= xpForNextLevel(player.level)) {
      player.xp -= xpForNextLevel(player.level);
      player.level += 1;
      player.talentPoints += TALENT_POINTS_PER_LEVEL;
      player.vitality += VITALITY_PER_LEVEL;
      player.mainStat += MAIN_STAT_PER_LEVEL;
      this.recomputeMaxHp(player);
      player.hp = player.maxHp;
    }
  }

  computePlayerDamage(player: Player, baseDamage: number, spellId?: SpellId): number {
    const effective = this.getEffectiveStatsFor(player);
    const bonus = this.getCombinedBonusFor(player, spellId);
    const ailmentMultiplier = this.getAilmentDamageMultiplier(player);
    const statBonus = Math.floor(effective.mainStat * DAMAGE_STAT_FACTOR);
    let damage = (baseDamage + statBonus) * (1 + bonus.damagePercent / 100) * ailmentMultiplier;
    const critChance = Math.min(1, critChanceFromLuck(effective.luck) + bonus.critChanceBonus / 100);
    if (Math.random() < critChance) {
      damage = damage * CRIT_MULTIPLIER;
    }
    return Math.round(damage);
  }

  // Healing reuses the talent system's damagePercent bucket as a general "spell power"
  // multiplier rather than introducing a separate heal-only talent effect, since no talent
  // in the current roster distinguishes the two - simplest thing that could work.
  computePlayerHeal(player: Player, baseAmount: number, spellId?: SpellId): number {
    const effective = this.getEffectiveStatsFor(player);
    const bonus = this.getCombinedBonusFor(player, spellId);
    const statBonus = Math.floor(effective.mainStat * DAMAGE_STAT_FACTOR);
    const heal = (baseAmount + statBonus) * (1 + bonus.damagePercent / 100);
    return Math.round(heal);
  }

  healPlayer(caster: Player, target: Player, baseAmount: number, spellId?: SpellId) {
    const heal = this.computePlayerHeal(caster, baseAmount, spellId);
    target.hp = Math.min(target.maxHp, target.hp + heal);
  }

  applyAilment(player: Player, kind: AilmentKind, durationMs: number) {
    player.ailments.set(kind, Date.now() + durationMs);
  }

  applyBuff(player: Player, kind: BuffKind) {
    player.buffs.set(kind, Date.now() + BUFFS[kind].durationMs);
  }

  private getAilmentDamageMultiplier(player: Player): number {
    let multiplier = 1;
    const now = Date.now();
    for (const [kind, expiresAt] of player.ailments) {
      if (expiresAt <= now) continue;
      const def = AILMENTS[kind as AilmentKind];
      if (def) multiplier *= 1 - def.damagePercent / 100;
    }
    return multiplier;
  }

  damagePlayer(sessionId: string, player: Player, amount: number) {
    const effective = this.getEffectiveStatsFor(player);
    const armorBonus = this.getCombinedBonusFor(player).armorBonus;
    const mitigated = Math.max(1, amount - (effective.armor + armorBonus));
    player.hp = Math.max(0, player.hp - mitigated);
    if (player.hp === 0) {
      this.cancelPlayerCast(sessionId);
      player.hp = player.maxHp;
      player.ailments.clear();
      player.buffs.clear();
      this.config.onPlayerRespawn(sessionId, player);
    }
  }

  // --- Targeting/AoE resolution ---

  // Resolves a raw CastMessage into a ResolvedTarget based on the spell's targetType.
  // "ally" falls back to the caster themself when no valid ally id was sent, which is
  // what makes self-heal/self-cleanse work without requiring a self-click.
  private resolveCastTarget(
    player: Player,
    sessionId: string,
    spell: SpellDef,
    message: CastMessage,
  ): ResolvedTarget | null {
    switch (spell.targetType) {
      case "enemy": {
        if (!message.targetId) return null;
        const enemy = this.state.enemies.get(message.targetId);
        if (!enemy || enemy.hp <= 0) return null;
        return { kind: "enemy", id: message.targetId };
      }
      case "ally": {
        const candidateId = message.targetId && this.state.players.has(message.targetId) ? message.targetId : sessionId;
        const ally = this.state.players.get(candidateId);
        if (!ally || ally.hp <= 0) return null;
        return { kind: "ally", id: candidateId };
      }
      case "self":
        return { kind: "self" };
      case "ground": {
        if (message.targetX === undefined || message.targetZ === undefined) return null;
        if (Math.abs(message.targetX) > MAP_HALF_EXTENT || Math.abs(message.targetZ) > MAP_HALF_EXTENT) return null;
        return { kind: "ground", x: message.targetX, z: message.targetZ };
      }
    }
  }

  // Live x/z of a resolved target, re-derived fresh each call (never cached) so cast-time
  // spells re-validate a moving/dying unit at fire time instead of using a stale position.
  private resolveImpactPoint(caster: Player, target: ResolvedTarget): { x: number; z: number } | null {
    switch (target.kind) {
      case "enemy": {
        const enemy = this.state.enemies.get(target.id);
        return enemy && enemy.hp > 0 ? { x: enemy.x, z: enemy.z } : null;
      }
      case "ally": {
        const ally = this.state.players.get(target.id);
        return ally && ally.hp > 0 ? { x: ally.x, z: ally.z } : null;
      }
      case "self":
        return { x: caster.x, z: caster.z };
      case "ground":
        return { x: target.x, z: target.z };
    }
  }

  private resolveAllyUnit(caster: Player, target: ResolvedTarget): Player | null {
    if (target.kind === "self") return caster;
    if (target.kind === "ally") {
      const ally = this.state.players.get(target.id);
      return ally && ally.hp > 0 ? ally : null;
    }
    return null;
  }

  // Cancels whatever the target currently has pending (enemy windup or player cast) and
  // applies a short lockout, regardless of whether anything was actually pending - a
  // whiffed interrupt still consumes its own cooldown, matching how every other spell's
  // cooldown is consumed once the cast is accepted.
  private tryInterrupt(target: ResolvedTarget) {
    if (target.kind === "enemy" && this.pendingEnemyCast.has(target.id)) {
      this.cancelEnemyCast(target.id);
      this.interruptLockoutUntil.set(target.id, Date.now() + INTERRUPT_LOCKOUT_MS);
    } else if (target.kind === "ally" && this.pendingPlayerCast.has(target.id)) {
      this.cancelPlayerCast(target.id);
      this.interruptLockoutUntil.set(target.id, Date.now() + INTERRUPT_LOCKOUT_MS);
    }
  }

  private resolveSpellEffect(caster: Player, casterSessionId: string, spell: SpellDef, target: ResolvedTarget) {
    for (const buffId of getOnCastBuffs(resolveClassId(caster.classId), spell.id, caster.talentRanks)) {
      this.applyBuff(caster, buffId);
    }

    if (spell.interruptsCast || spell.effectType === "interrupt") {
      this.tryInterrupt(target);
    }

    if (spell.effectType === "damage") {
      if (spell.aoeRadius) {
        const impact = this.resolveImpactPoint(caster, target);
        if (!impact) return;
        forEachAlive(this.state.enemies, impact.x, impact.z, spell.aoeRadius, (enemy, enemyId) => {
          const damage = this.computePlayerDamage(caster, spell.amount ?? 0, spell.id);
          this.applySpellDamage(enemy, damage, enemyId, casterSessionId);
        });
      } else if (target.kind === "enemy") {
        const enemy = this.state.enemies.get(target.id);
        if (enemy && enemy.hp > 0) {
          const damage = this.computePlayerDamage(caster, spell.amount ?? 0, spell.id);
          this.applySpellDamage(enemy, damage, target.id, casterSessionId);
        }
      }
    } else if (spell.effectType === "heal") {
      if (spell.aoeRadius) {
        const impact = this.resolveImpactPoint(caster, target);
        if (!impact) return;
        forEachAlive(this.state.players, impact.x, impact.z, spell.aoeRadius, (ally) => {
          this.healPlayer(caster, ally, spell.amount ?? 0, spell.id);
        });
      } else {
        const ally = this.resolveAllyUnit(caster, target);
        if (ally) this.healPlayer(caster, ally, spell.amount ?? 0, spell.id);
      }
    } else if (spell.effectType === "dispel") {
      const ally = this.resolveAllyUnit(caster, target);
      if (ally) ally.ailments.clear();
    }
  }

  private cancelPlayerCast(sessionId: string) {
    if (!this.pendingPlayerCast.has(sessionId)) return;
    this.pendingPlayerCast.delete(sessionId);
    const player = this.state.players.get(sessionId);
    if (player) player.castSpellId = "";
  }

  private cancelEnemyCast(enemyId: string) {
    if (!this.pendingEnemyCast.has(enemyId)) return;
    this.pendingEnemyCast.delete(enemyId);
    const enemy = this.state.enemies.get(enemyId);
    if (enemy) enemy.isCasting = false;
  }

  // --- Enemy damage / kill ---

  applySpellDamage(target: Enemy, damage: number, targetId: string, killerSessionId: string) {
    // Starts the enrage clock on the boss's first hit taken, never reset until it dies
    // (each room creates a fresh Enemy() per spawn, so a respawned/re-spawned boss starts clean).
    if (target.behavior === "boss" && target.enragesAt === 0) target.enragesAt = Date.now() + BOSS_ENRAGE_MS;

    target.hp = Math.max(0, target.hp - damage);
    if (target.hp === 0) {
      const deathX = target.x;
      const deathZ = target.z;
      this.state.enemies.delete(targetId);
      this.clearEnemyTracking(targetId);
      this.config.onEnemyKilled(targetId, target.enemyTypeId, killerSessionId, deathX, deathZ);
    }
  }

  private clearEnemyTracking(enemyId: string) {
    this.lastMeleeAttackAt.delete(enemyId);
    this.lastCasterAttackAt.delete(enemyId);
    this.pendingEnemyCast.delete(enemyId);
    this.interruptLockoutUntil.delete(enemyId);
  }

  // --- Boss phase/enrage (derived from already-synced fields, not a separate synced flag -
  // client and server independently compute the same threshold locally) ---

  isBossPhase2(enemy: Enemy): boolean {
    return enemy.behavior === "boss" && enemy.hp <= enemy.maxHp * BOSS_PHASE_2_HP_FRACTION;
  }

  isBossEnraged(enemy: Enemy): boolean {
    return enemy.behavior === "boss" && enemy.enragesAt !== 0 && Date.now() >= enemy.enragesAt;
  }

  // --- Per-tick simulation ---

  tick(dt: number) {
    this.tickPlayerMovement(dt);
    this.tickPlayerCasts();
    this.tickEnemyAttacks();
    this.tickPendingEnemyCasts();
    this.tickProjectiles(dt);
  }

  private tickPlayerMovement(dt: number) {
    for (const [sessionId, player] of this.state.players) {
      const input = this.lastInput.get(sessionId);
      if (!input) continue;

      const length = Math.hypot(input.moveX, input.moveZ);
      if (length === 0) continue;

      const normalizedX = input.moveX / length;
      const normalizedZ = input.moveZ / length;

      let nextX = clamp(player.x + normalizedX * PLAYER_SPEED * dt, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
      let nextZ = clamp(player.z + normalizedZ * PLAYER_SPEED * dt, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);

      if (this.config.collidableStructures) {
        const resolved = resolveStructureCollisions(nextX, nextZ, STRUCTURES);
        nextX = clamp(resolved.x, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
        nextZ = clamp(resolved.z, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
      }

      player.x = nextX;
      player.z = nextZ;
      player.rotationY = Math.atan2(normalizedX, normalizedZ);
    }
  }

  private tickPlayerCasts() {
    const now = Date.now();

    for (const [sessionId, pending] of this.pendingPlayerCast) {
      if (now < pending.fireAt) continue;
      this.pendingPlayerCast.delete(sessionId);

      const player = this.state.players.get(sessionId);
      if (player) player.castSpellId = "";
      if (!player || player.hp <= 0) continue;

      const spell = SPELLS[pending.spellId];
      if (!spell) continue;

      // Re-validate the target is still resolvable - it may have died, disconnected, or
      // (for ground casts) simply still be a valid point - before applying the effect.
      const impact = this.resolveImpactPoint(player, pending.target);
      if (!impact) continue; // target gone, cast fizzles

      // Also re-check line of sight - the target (or the caster, via knockback/etc.) may have
      // moved behind a wall during the windup, same as the immediate check in handleCast.
      if (this.config.collidableStructures && !hasLineOfSight(player.x, player.z, impact.x, impact.z, STRUCTURES)) continue;

      if (spell.projectileSpeed && pending.target.kind === "enemy") {
        const damage = this.computePlayerDamage(player, spell.amount ?? 0);
        this.spawnProjectile(player.x, player.z, "player", pending.target.id, damage, spell.projectileSpeed, sessionId);
      } else {
        this.resolveSpellEffect(player, sessionId, spell, pending.target);
      }
    }
  }

  private tickEnemyAttacks() {
    const now = Date.now();

    for (const [enemyId, enemy] of this.state.enemies) {
      if (enemy.hp <= 0) continue;
      const enemyType = ENEMY_TYPES[enemy.enemyTypeId];
      if (!enemyType) continue; // content deleted after this enemy spawned - skip its AI this tick

      const isBoss = enemy.behavior === "boss";
      const enrageMultiplier = this.isBossEnraged(enemy) ? BOSS_ENRAGE_DAMAGE_MULTIPLIER : 1;

      // Melee pattern: always active for "melee", and for "boss" in every phase.
      if (enemy.behavior === "melee" || isBoss) {
        const range = isBoss ? (enemyType.stats as BossStats).meleeRange : (enemyType.stats as MeleeStats).range;
        const interval = isBoss
          ? (enemyType.stats as BossStats).meleeIntervalMs
          : (enemyType.stats as MeleeStats).intervalMs;
        const damage = isBoss ? (enemyType.stats as BossStats).meleeDamage : (enemyType.stats as MeleeStats).damage;

        const lastAttack = this.lastMeleeAttackAt.get(enemyId) ?? 0;
        if (now - lastAttack >= interval) {
          for (const [sessionId, player] of this.state.players) {
            if (player.hp <= 0) continue;
            const dist = Math.hypot(player.x - enemy.x, player.z - enemy.z);
            if (dist <= range) {
              this.damagePlayer(sessionId, player, damage * enrageMultiplier);
              this.lastMeleeAttackAt.set(enemyId, now);
              break;
            }
          }
        }
      }

      // Ranged/AoE pattern: always active for "caster"; for "boss" only once phase 2 starts.
      if (enemy.behavior === "caster" || (isBoss && this.isBossPhase2(enemy))) {
        if (this.pendingEnemyCast.has(enemyId)) continue; // already winding up
        if ((this.interruptLockoutUntil.get(enemyId) ?? 0) > now) continue; // recently interrupted

        const range = isBoss ? (enemyType.stats as BossStats).aoeRange : (enemyType.stats as CasterStats).range;
        const cooldownMs = isBoss
          ? (enemyType.stats as BossStats).aoeCooldownMs
          : (enemyType.stats as CasterStats).cooldownMs;
        const castTimeMs = isBoss
          ? (enemyType.stats as BossStats).aoeCastTimeMs
          : (enemyType.stats as CasterStats).castTimeMs;

        const lastAttack = this.lastCasterAttackAt.get(enemyId) ?? 0;
        if (now - lastAttack < cooldownMs) continue;

        for (const [sessionId, player] of this.state.players) {
          if (player.hp <= 0) continue;
          const dist = Math.hypot(player.x - enemy.x, player.z - enemy.z);
          if (dist > range) continue;
          if (this.config.collidableStructures && !hasLineOfSight(enemy.x, enemy.z, player.x, player.z, STRUCTURES)) continue;

          enemy.isCasting = true;
          this.pendingEnemyCast.set(enemyId, { targetSessionId: sessionId, fireAt: now + castTimeMs });
          this.lastCasterAttackAt.set(enemyId, now);
          break;
        }
      }
    }
  }

  private tickPendingEnemyCasts() {
    const now = Date.now();

    for (const [enemyId, pending] of this.pendingEnemyCast) {
      if (now < pending.fireAt) continue;
      this.pendingEnemyCast.delete(enemyId);

      const enemy = this.state.enemies.get(enemyId);
      if (enemy) enemy.isCasting = false;
      if (!enemy || enemy.hp <= 0) continue;

      const player = this.state.players.get(pending.targetSessionId);
      if (!player || player.hp <= 0) continue; // target gone, cast fizzles

      const enemyType = ENEMY_TYPES[enemy.enemyTypeId];
      if (!enemyType) continue; // content deleted mid-windup - cast fizzles

      // Also re-check line of sight - the player may have broken it (or the enemy may have
      // been knocked/moved) during the windup, same as the player-cast fire-time re-check.
      if (this.config.collidableStructures && !hasLineOfSight(enemy.x, enemy.z, player.x, player.z, STRUCTURES)) continue;

      const isBoss = enemy.behavior === "boss";
      const enrageMultiplier = this.isBossEnraged(enemy) ? BOSS_ENRAGE_DAMAGE_MULTIPLIER : 1;
      const baseDamage = isBoss ? (enemyType.stats as BossStats).aoeDamage : (enemyType.stats as CasterStats).damage;
      const projectileSpeed = isBoss
        ? (enemyType.stats as BossStats).aoeProjectileSpeed
        : (enemyType.stats as CasterStats).projectileSpeed;

      // ownerId lets tickProjectiles recognize a boss-sourced projectile on impact (to
      // splash instead of single-target); harmless for non-boss enemies since nothing
      // else reads ownerId on enemy-sourced projectiles.
      this.spawnProjectile(
        enemy.x,
        enemy.z,
        "enemy",
        pending.targetSessionId,
        baseDamage * enrageMultiplier,
        projectileSpeed,
        enemyId,
      );
    }
  }

  private spawnProjectile(
    x: number,
    z: number,
    source: "enemy" | "player",
    targetId: string,
    damage: number,
    speed: number,
    ownerId: string,
  ) {
    const projectile = new Projectile();
    projectile.x = x;
    projectile.z = z;
    projectile.source = source;
    projectile.targetId = targetId;
    projectile.damage = damage;
    projectile.speed = speed;
    projectile.ownerId = ownerId;

    const id = `proj-${this.projectileSeq++}`;
    this.state.projectiles.set(id, projectile);
    this.projectileAge.set(id, 0);
  }

  private tickProjectiles(dt: number) {
    for (const [id, projectile] of this.state.projectiles) {
      let targetX: number;
      let targetZ: number;

      if (projectile.source === "enemy") {
        const player = this.state.players.get(projectile.targetId);
        if (!player || player.hp <= 0) {
          this.removeProjectile(id);
          continue;
        }
        targetX = player.x;
        targetZ = player.z;
      } else {
        const enemy = this.state.enemies.get(projectile.targetId);
        if (!enemy || enemy.hp <= 0) {
          this.removeProjectile(id);
          continue;
        }
        targetX = enemy.x;
        targetZ = enemy.z;
      }

      const dx = targetX - projectile.x;
      const dz = targetZ - projectile.z;
      const dist = Math.hypot(dx, dz);

      if (dist <= PROJECTILE_HIT_RADIUS) {
        if (projectile.source === "enemy") {
          const player = this.state.players.get(projectile.targetId)!;
          const ownerEnemy = this.state.enemies.get(projectile.ownerId);
          if (ownerEnemy?.behavior === "boss") {
            // Phase 2's ranged attack: splash the locked-target's impact point instead of
            // hitting only them - the enrage multiplier is already baked into projectile.damage.
            const ownerType = ENEMY_TYPES[ownerEnemy.enemyTypeId];
            const aoeRadius = (ownerType?.stats as BossStats | undefined)?.aoeRadius ?? 0;
            forEachAlive(this.state.players, player.x, player.z, aoeRadius, (splashPlayer, splashSessionId) => {
              this.damagePlayer(splashSessionId, splashPlayer, projectile.damage);
              if (splashPlayer.hp > 0) this.applyAilment(splashPlayer, "weaken", AILMENTS.weaken.durationMs);
            });
          } else {
            this.damagePlayer(projectile.targetId, player, projectile.damage);
            if (player.hp > 0) this.applyAilment(player, "weaken", AILMENTS.weaken.durationMs);
          }
        } else {
          const enemy = this.state.enemies.get(projectile.targetId)!;
          this.applySpellDamage(enemy, projectile.damage, projectile.targetId, projectile.ownerId);
        }
        this.removeProjectile(id);
        continue;
      }

      projectile.x += (dx / dist) * projectile.speed * dt;
      projectile.z += (dz / dist) * projectile.speed * dt;

      const age = (this.projectileAge.get(id) ?? 0) + dt * 1000;
      this.projectileAge.set(id, age);
      if (age > PROJECTILE_MAX_LIFETIME_MS) {
        this.removeProjectile(id);
      }
    }
  }

  private removeProjectile(id: string) {
    this.state.projectiles.delete(id);
    this.projectileAge.delete(id);
  }
}
