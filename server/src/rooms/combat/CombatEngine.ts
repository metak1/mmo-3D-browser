import { Client } from "@colyseus/core";
import { MapSchema } from "@colyseus/schema";
import {
  AILMENTS,
  AilmentKind,
  BOSS_ENRAGE_DAMAGE_MULTIPLIER,
  BOSS_PHASE_2_HP_FRACTION,
  BossAbilityDef,
  BossStats,
  CLASSES,
  CRIT_MULTIPLIER,
  CasterStats,
  CastFailedMessage,
  CastFailReason,
  CastMessage,
  ClassId,
  ClassRole,
  CombatTextEvent,
  DAMAGE_STAT_FACTOR,
  EffectAction,
  EffectDef,
  EffectShape,
  ENEMY_CHASE_SPEED,
  ENEMY_LEASH_RANGE,
  ENEMY_TYPES,
  ENEMY_WANDER_PAUSE_JITTER_MS,
  ENEMY_WANDER_PAUSE_MS,
  ENEMY_WANDER_RADIUS,
  ENEMY_WANDER_SPEED,
  FURNITURE,
  INTERRUPT_LOCKOUT_MS,
  InputMessage,
  MAIN_STAT_PER_LEVEL,
  MAP_HALF_EXTENT,
  MAX_LEVEL,
  MAX_PROFESSION_LEVEL,
  MeleeStats,
  PLAYER_SPEED,
  MOUNT_SPEED_MULTIPLIER,
  ProfessionId,
  professionXpForNextLevel,
  PROJECTILE_HIT_RADIUS,
  PROJECTILE_MAX_LIFETIME_MS,
  hasLineOfSight,
  isHexPassable,
  PlayerStats,
  resolveFurnitureCollisions,
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
import { DotStack, Enemy, Player, Projectile } from "../schema/WorldState.js";

const RANGE_BUFFER = 1; // small allowance for latency between client input and server check
const BOSS_ENRAGE_MS = 90_000; // time since first damage taken before the boss enrages
const ENEMY_WANDER_TARGET_ATTEMPTS = 6; // see pickWanderTarget's own doc comment

// A tank generates threat faster per point of damage than anyone else, which is what makes them
// naturally hold aggro without needing a special-cased "always target the tank" rule - it falls
// out of the same threat-comparison logic every other role uses.
const ROLE_THREAT_MULTIPLIER: Record<ClassRole, number> = { tank: 2, healer: 1, dps: 1 };
const THREAT_PER_HEAL = 0.5; // healing generates threat at half the rate damage does
// Enemies already in combat with someone within this radius of a healer count as "engaged with
// this fight" for heal-threat purposes - a simple proximity stand-in for party membership.
const HEAL_THREAT_RADIUS = 20;

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
  startedAt: number;
}

interface PendingEnemyCast {
  targetSessionId: string;
  fireAt: number;
  // Set only for a BossAbilityDef windup (see tickBossSpecialAbilities) - unset means this is
  // the boss's existing unnamed phase-2 ranged attack, resolved by spawning a projectile as before.
  abilityId?: string;
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
  // Fired on every damage/heal application (see applySpellDamage/damagePlayer/healPlayer) - the
  // room just rebroadcasts it as-is (see WorldRoom/DungeonRoom's identical "combat_text" wiring).
  // Not synced schema state on purpose: it's a transient notice, not a value a late-joining
  // client needs to reconcile.
  onCombatText: (event: CombatTextEvent) => void;
  // Gates both movement collision and line-of-sight checks (player casts and enemy casts) against
  // STRUCTURES. Only the overworld has any (dungeon coordinates are unrelated small numbers that
  // could otherwise collide with/be blocked by unrelated overworld buildings) - WorldRoom passes
  // true, DungeonRoom leaves this unset.
  collidableStructures?: boolean;
  // Enables tickEnemyMovement (idle wander + threat-target chase + proximity aggro for
  // "aggressive" enemy types). Dungeon encounters are small, hand-placed wave fights where an
  // enemy wandering off its spot would fight the encounter design, so only WorldRoom sets this;
  // DungeonRoom leaves it unset and enemies there behave exactly as before (stationary, purely
  // threat-driven, gated by tickEnemyAttacks' own range checks).
  enemiesWander?: boolean;
  // Gates hex-terrain water-blocking (see hex.ts's isHexPassable) against player/enemy movement.
  // Only the overworld has a hex terrain layer (see HexGround.ts) - WorldRoom passes true,
  // DungeonRoom leaves this unset (a dungeon has no hex terrain of its own).
  blockWaterTerrain?: boolean;
  // Gates movement collision against FURNITURE (see shared's FURNITURE_FOOTPRINT/
  // getFurnitureColliders for which kinds actually have a collider). A separate flag from
  // collidableStructures since the shared FURNITURE array is itself already overworld-only (see
  // reloadGameContent's own filter), but kept distinct rather than reusing collidableStructures so
  // this reads as what it actually gates, not "structures" - WorldRoom passes true, DungeonRoom
  // leaves this unset.
  collidableFurniture?: boolean;
}

// Slides a proposed move along whichever single axis is still passable, rather than freezing dead
// the instant a straight-line move would enter water - the same "try both axes" trick a rotated-
// AABB collision resolver would use, kept simple here since water cells are just a binary block.
function resolveWaterSlide(fromX: number, fromZ: number, nextX: number, nextZ: number): { x: number; z: number } {
  if (isHexPassable(nextX, nextZ)) return { x: nextX, z: nextZ };
  if (isHexPassable(nextX, fromZ)) return { x: nextX, z: fromZ };
  if (isHexPassable(fromX, nextZ)) return { x: fromX, z: nextZ };
  return { x: fromX, z: fromZ };
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

// --- Composable effect resolution (EffectDef = shape + actions[], see shared/src/types.ts) ---
// The single interpreter every spell/boss-ability call site funnels through once it opts into
// the composable path (spell.effects / BossAbilityDef.effect) - see resolveEffect below.

const MAX_DOT_STACKS = 4; // per unit - caps synced-state growth from repeated DOT casts on the same target

// Everything CasterContext needs to know about whoever triggered an EffectDef, independent of
// whether that's a player casting a spell or a boss firing a special ability - resolveEffect/
// applyAction branch on `isPlayer` wherever the two need genuinely different math (player damage
// goes through the stat/talent/crit formula; boss damage is a flat number times enrageMultiplier).
interface CasterContext {
  isPlayer: boolean;
  casterX: number;
  casterZ: number;
  sourceId: string; // sessionId (player) or enemyId (boss) - threat/kill-credit/DotStack.sourceId
  casterPlayer?: Player; // set iff isPlayer - needed for computePlayerDamage/computePlayerHeal/healPlayer's own stat lookups
  spellId?: SpellId; // for talent lookups (computePlayerDamage/computePlayerHeal's own spellId param)
  enrageMultiplier: number; // 1 for players; boss's current enrage multiplier otherwise
}

// Which side of the fight an action's target sits on, relative to whoever cast it - "enemy"
// actions (damage/dot/ailment/knockback/interrupt) hit the caster's opponents; "ally" actions
// (heal/buff/dispel) hit the caster's own side; "self" actions (summon) don't target a unit at
// all. Two separate shape-matching passes in resolveEffect (one per polarity actually present in
// an effect's actions[]) is what lets a single EffectDef mix polarities, e.g. "damage the enemies
// in this cone AND heal myself" from one cast.
const ACTION_POLARITY: Record<EffectAction["kind"], "enemy" | "ally" | "self"> = {
  damage: "enemy",
  dot: "enemy",
  ailment: "enemy",
  knockback: "enemy",
  interrupt: "enemy",
  heal: "ally",
  buff: "ally",
  dispel: "ally",
  summon: "self",
};

// Pure geometry - does (ux,uz) fall inside `shape`, given where the caster is standing and where
// the cast is aimed (the resolved impact point)? Circle stays a plain distance check (matches the
// old flat-aoeRadius behavior exactly when centeredOn:"impact"); cone/line are newly added, both
// aimed from the caster toward the impact point rather than needing a separately-tracked facing
// angle. singleTarget/randomPoints are handled by matchShape directly, not through here (neither
// is a per-unit geometric test against a fixed area).
function unitMatchesShape(shape: EffectShape, casterCtx: CasterContext, impact: { x: number; z: number }, ux: number, uz: number): boolean {
  if (shape.kind === "circle") {
    const cx = shape.centeredOn === "caster" ? casterCtx.casterX : impact.x;
    const cz = shape.centeredOn === "caster" ? casterCtx.casterZ : impact.z;
    return Math.hypot(ux - cx, uz - cz) <= shape.radius;
  }
  if (shape.kind === "cone") {
    const aimX = impact.x - casterCtx.casterX;
    const aimZ = impact.z - casterCtx.casterZ;
    const aimLen = Math.hypot(aimX, aimZ);
    if (aimLen < 0.0001) return false; // caster is standing exactly on the impact point - no facing to aim a cone along
    const toUx = ux - casterCtx.casterX;
    const toUz = uz - casterCtx.casterZ;
    const dist = Math.hypot(toUx, toUz);
    if (dist > shape.radius || dist < 0.0001) return false;
    const dot = (toUx / dist) * (aimX / aimLen) + (toUz / dist) * (aimZ / aimLen);
    const angleRad = Math.acos(clamp(dot, -1, 1));
    return angleRad <= (shape.angleDeg * Math.PI) / 180 / 2;
  }
  if (shape.kind === "line") {
    const dirX = impact.x - casterCtx.casterX;
    const dirZ = impact.z - casterCtx.casterZ;
    const len = Math.hypot(dirX, dirZ) || 1;
    const normX = dirX / len;
    const normZ = dirZ / len;
    const toUx = ux - casterCtx.casterX;
    const toUz = uz - casterCtx.casterZ;
    const along = toUx * normX + toUz * normZ; // distance projected along the caster->impact direction
    if (along < 0 || along > shape.length) return false;
    const perp = Math.abs(toUx * -normZ + toUz * normX); // perpendicular distance from that line
    return perp <= shape.width / 2;
  }
  return false; // singleTarget/randomPoints never reach here - see matchShape
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
  // key: projectileId - only set for a player-cast composable spell (spell.effects) delivered via
  // a projectile; consulted by tickProjectiles on arrival instead of the flat projectile.damage
  // field, so a projectile spell can carry any shape/actions combo, not just flat single-target
  // damage. Cleared on both hit and early removal (target death/timeout) - see removeProjectile.
  private pendingProjectileEffects = new Map<string, { effects: EffectDef[]; casterCtx: CasterContext; targetHint: string }>();
  // key: enemyId -> (sessionId -> accumulated threat). Server-internal, not synced - only
  // Enemy.aggroTargetId (who currently has the highest threat) is exposed to clients.
  private threatTables = new Map<string, Map<string, number>>();
  private lastAddSpawnAt = new Map<string, number>(); // key: boss enemyId
  private activeAddIds = new Map<string, Set<string>>(); // key: boss enemyId -> ids of adds it has spawned
  private addSeq = 0;
  private lastSpecialCastAt = new Map<string, number>(); // key: boss enemyId
  private specialRotationIndex = new Map<string, number>(); // key: boss enemyId -> next index into specialAbilities
  // key: enemyId -> current wander leg's destination, cleared once reached (see tickWander).
  private wanderTarget = new Map<string, { x: number; z: number }>();
  private wanderPauseUntil = new Map<string, number>(); // key: enemyId -> epoch ms, standing still between legs

  constructor(private config: CombatEngineConfig) {}

  private get state() {
    return this.config.state;
  }

  // --- Message-driven entry points ---

  handleInput(sessionId: string, message: InputMessage) {
    if (message.moveX !== 0 || message.moveZ !== 0) {
      this.cancelPlayerCast(sessionId, true);
    }
    this.lastInput.set(sessionId, {
      moveX: clamp(message.moveX, -1, 1),
      moveZ: clamp(message.moveZ, -1, 1),
      seq: message.seq,
    });
  }

  // Sends a CastFailedMessage back to just this one client - see that type's own doc comment for
  // why (client.ts's castSpell already predicts/blocks the common cases itself, so most of these
  // sites are a safety net for state drift rather than the normal path; no_line_of_sight has no
  // client-side equivalent at all, since a cheap client-side LOS check would need the same
  // structure-raycast work the server already does here).
  private rejectCast(client: Client, reason: CastFailReason) {
    const failure: CastFailedMessage = { reason };
    client.send("cast_failed", failure);
  }

  handleCast(client: Client, message: CastMessage) {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.hp <= 0) return;
    if (player.castSpellId !== "") return this.rejectCast(client, "already_casting");
    if ((this.interruptLockoutUntil.get(client.sessionId) ?? 0) > Date.now()) return this.rejectCast(client, "interrupted");

    const spell = SPELLS[message.spellId];
    if (!spell || spell.classId !== resolveClassId(player.classId)) return;

    const cooldownKey = `${client.sessionId}:${message.spellId}`;
    const now = Date.now();
    const cooldownPercent = this.getCombinedBonusFor(player, message.spellId).cooldownPercent;
    const effectiveCooldownMs = Math.max(100, spell.cooldownMs * (1 - cooldownPercent / 100));
    const maxCharges = 1 + getSpellCharges(resolveClassId(player.classId), message.spellId, player.talentRanks);
    const activeCasts = (this.lastCastAt.get(cooldownKey) ?? []).filter((t) => now - t < effectiveCooldownMs);
    if (activeCasts.length >= maxCharges) return this.rejectCast(client, "on_cooldown");

    const target = this.resolveCastTarget(player, client.sessionId, spell, message);
    if (!target) return this.rejectCast(client, "no_target");

    const impact = this.resolveImpactPoint(player, target);
    if (!impact) return this.rejectCast(client, "no_target");

    const dist = Math.hypot(player.x - impact.x, player.z - impact.z);
    if (dist > spell.range + RANGE_BUFFER) return this.rejectCast(client, "out_of_range");

    if (this.config.collidableStructures && !hasLineOfSight(player.x, player.z, impact.x, impact.z, STRUCTURES)) {
      return this.rejectCast(client, "no_line_of_sight");
    }

    activeCasts.push(now);
    this.lastCastAt.set(cooldownKey, activeCasts);

    if (spell.castTimeMs > 0) {
      player.castSpellId = message.spellId;
      this.pendingPlayerCast.set(client.sessionId, {
        spellId: message.spellId,
        target,
        fireAt: now + spell.castTimeMs,
        startedAt: now,
      });
    } else {
      this.castSpellEffects(player, client.sessionId, spell, target, impact);
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
      {
        weapon: player.equippedWeapon,
        offHand: player.equippedOffHand,
        head: player.equippedHead,
        neck: player.equippedNeck,
        shoulders: player.equippedShoulders,
        armor: player.equippedArmor,
        hands: player.equippedHands,
        waist: player.equippedWaist,
        legs: player.equippedLegs,
        feet: player.equippedFeet,
        ring: player.equippedRing,
        trinket: player.equippedTrinket,
      },
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

  // Mirrors grantXp's exact stored-level/loop pattern, on the separate professionXp/
  // professionLevel maps instead - only meaningful for a professionId already present in both
  // (i.e. learned - see WorldRoom.handleLearnProfession), capped at MAX_PROFESSION_LEVEL with no
  // further rewards (no talent points/stat gains, professions are a side-progression track).
  grantProfessionXp(player: Player, professionId: ProfessionId, amount: number) {
    if (!player.professionLevel.has(professionId)) return;
    let level = player.professionLevel.get(professionId) ?? 1;
    let xp = (player.professionXp.get(professionId) ?? 0) + amount;

    while (level < MAX_PROFESSION_LEVEL && xp >= professionXpForNextLevel(level)) {
      xp -= professionXpForNextLevel(level);
      level += 1;
    }

    player.professionXp.set(professionId, xp);
    player.professionLevel.set(professionId, level);
  }

  computePlayerDamage(player: Player, baseDamage: number, spellId?: SpellId): { amount: number; isCrit: boolean } {
    const effective = this.getEffectiveStatsFor(player);
    const bonus = this.getCombinedBonusFor(player, spellId);
    const ailmentMultiplier = this.getAilmentDamageMultiplier(player);
    const statBonus = Math.floor(effective.mainStat * DAMAGE_STAT_FACTOR);
    let damage = (baseDamage + statBonus) * (1 + bonus.damagePercent / 100) * ailmentMultiplier;
    const critChance = Math.min(1, critChanceFromLuck(effective.luck) + bonus.critChanceBonus / 100);
    const isCrit = Math.random() < critChance;
    if (isCrit) {
      damage = damage * CRIT_MULTIPLIER;
    }
    return { amount: Math.round(damage), isCrit };
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

  healPlayer(
    caster: Player,
    casterSessionId: string,
    target: Player,
    targetSessionId: string,
    baseAmount: number,
    spellId?: SpellId,
  ) {
    const heal = this.computePlayerHeal(caster, baseAmount, spellId);
    target.hp = Math.min(target.maxHp, target.hp + heal);
    this.addHealThreat(caster, casterSessionId, heal);
    this.config.onCombatText({ targetId: targetSessionId, targetKind: "player", amount: heal, kind: "heal", isCrit: false });
  }

  // Healing has no direct "which enemy" to attribute threat to (unlike damage, which always
  // targets one), so instead it's spread across every enemy already fighting *someone* within
  // range of the healer - see HEAL_THREAT_RADIUS.
  private addHealThreat(healer: Player, healerSessionId: string, healAmount: number) {
    if (healAmount <= 0) return;
    for (const [enemyId, table] of this.threatTables) {
      if (table.size === 0) continue;
      const enemy = this.state.enemies.get(enemyId);
      if (!enemy) continue;
      const dist = Math.hypot(healer.x - enemy.x, healer.z - enemy.z);
      if (dist <= HEAL_THREAT_RADIUS) this.addThreat(enemyId, healerSessionId, healAmount * THREAT_PER_HEAL);
    }
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
    this.config.onCombatText({ targetId: sessionId, targetKind: "player", amount: mitigated, kind: "damage", isCrit: false });
    player.hp = Math.max(0, player.hp - mitigated);
    player.mounted = false; // taking a hit always dismounts, same convention as classic MMO mounts
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

  private makePlayerCasterCtx(player: Player, sessionId: string, spellId?: SpellId): CasterContext {
    return { isPlayer: true, casterX: player.x, casterZ: player.z, sourceId: sessionId, casterPlayer: player, spellId, enrageMultiplier: 1 };
  }

  // Applies a consumable material's useEffects (see ItemDef.useEffects) - always a self-cast
  // (drinking a potion has no separate target to pick), through the exact same resolveEffect()
  // interpreter spells/boss abilities already go through. Public - WorldRoom.handleUseItem is the
  // only caller, same "one narrow public entry point" shape as grantXp/grantProfessionXp above.
  consumeItem(player: Player, sessionId: string, effects: EffectDef[]) {
    const casterCtx = this.makePlayerCasterCtx(player, sessionId);
    const impact = { x: player.x, z: player.z };
    for (const effect of effects) this.resolveEffect(casterCtx, effect, impact, sessionId);
  }

  // The unit id a composable EffectDef's shape:"singleTarget" should resolve to - "ground" has no
  // single unit to fall back to (a ground-targeted singleTarget effect is a no-op by construction,
  // an admin authoring error rather than something worth a special case here).
  private targetHintId(casterSessionId: string, target: ResolvedTarget): string | undefined {
    if (target.kind === "enemy" || target.kind === "ally") return target.id;
    if (target.kind === "self") return casterSessionId;
    return undefined;
  }

  // Cancels whatever the target currently has pending (enemy windup or player cast) and applies a
  // short lockout, regardless of whether anything was actually pending - a whiffed interrupt still
  // consumes its own cooldown, matching how every other spell's cooldown is consumed once the cast
  // is accepted. Takes a plain (id, "is this id an enemy or a player") pair rather than a
  // ResolvedTarget since the composable "interrupt" action targets whichever unit a shape matched,
  // not a single pre-resolved cast target.
  private tryInterruptUnit(unitId: string, unitIsEnemy: boolean) {
    if (unitIsEnemy && this.pendingEnemyCast.has(unitId)) {
      this.cancelEnemyCast(unitId);
      this.interruptLockoutUntil.set(unitId, Date.now() + INTERRUPT_LOCKOUT_MS);
    } else if (!unitIsEnemy && this.pendingPlayerCast.has(unitId)) {
      this.cancelPlayerCast(unitId);
      this.interruptLockoutUntil.set(unitId, Date.now() + INTERRUPT_LOCKOUT_MS);
    }
  }

  // Pushes a new DotStack (see WorldState.ts) onto a unit, evicting the oldest stack once
  // MAX_DOT_STACKS is reached - repeated casts stack rather than refresh/overwrite (unlike
  // ailments/buffs, which overwrite a single expiresAt per kind), since a DOT's whole point is
  // that reapplying it is a meaningful damage increase, not just a duration refresh.
  private addDot(unit: Player | Enemy, sourceId: string, amount: number, tickIntervalMs: number, durationMs: number) {
    if (unit.dots.length >= MAX_DOT_STACKS) unit.dots.shift();
    const dot = new DotStack();
    dot.sourceId = sourceId;
    dot.damagePerTick = amount;
    dot.tickIntervalMs = tickIntervalMs;
    const now = Date.now();
    dot.nextTickAt = now + tickIntervalMs;
    dot.expiresAt = now + durationMs;
    unit.dots.push(dot);
  }

  // Finds every [id, unit] pair `shape` covers, scanned from `pool` (already narrowed to the
  // correct side by resolveEffect - see ACTION_POLARITY). singleTarget/randomPoints don't fit
  // unitMatchesShape's per-unit geometric test (the former needs the pre-resolved target id, the
  // latter tests against several ad-hoc points rather than one fixed area), so both are handled
  // directly here instead.
  private matchShape(
    casterCtx: CasterContext,
    shape: EffectShape,
    impact: { x: number; z: number },
    pool: Iterable<[string, Player | Enemy]>,
    targetHint?: string,
  ): [string, Player | Enemy][] {
    const results: [string, Player | Enemy][] = [];
    if (shape.kind === "singleTarget") {
      if (!targetHint) return results;
      for (const [id, unit] of pool) {
        if (id === targetHint && unit.hp > 0) results.push([id, unit]);
      }
      return results;
    }
    if (shape.kind === "randomPoints") {
      const seen = new Set<string>();
      for (let i = 0; i < shape.count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const r = Math.random() * shape.spreadRadius;
        const px = impact.x + Math.cos(angle) * r;
        const pz = impact.z + Math.sin(angle) * r;
        for (const [id, unit] of pool) {
          if (seen.has(id) || unit.hp <= 0) continue;
          if (Math.hypot(unit.x - px, unit.z - pz) <= shape.pointRadius) {
            seen.add(id);
            results.push([id, unit]);
          }
        }
      }
      return results;
    }
    for (const [id, unit] of pool) {
      if (unit.hp <= 0) continue;
      if (unitMatchesShape(shape, casterCtx, impact, unit.x, unit.z)) results.push([id, unit]);
    }
    return results;
  }

  // The single interpreter every composable spell (SpellDef.effects) and boss ability
  // (BossAbilityDef.effect) resolves through - see this file's own header comment on
  // ACTION_POLARITY for why enemy-polarity and ally-polarity actions get their own shape-match
  // pass each (so one EffectDef can mix both, e.g. "damage the cone in front of me AND heal
  // myself"). `targetHint` is the pre-resolved single-target id (ResolvedTarget's own id for a
  // spell, or the boss's aggro target for an ability) - only consulted by shape:"singleTarget".
  private resolveEffect(casterCtx: CasterContext, effect: EffectDef, impact: { x: number; z: number }, targetHint?: string) {
    const enemyActions = effect.actions.filter((a) => ACTION_POLARITY[a.kind] === "enemy");
    const allyActions = effect.actions.filter((a) => ACTION_POLARITY[a.kind] === "ally");
    const selfActions = effect.actions.filter((a) => ACTION_POLARITY[a.kind] === "self");

    if (enemyActions.length > 0) {
      const pool = casterCtx.isPlayer ? this.state.enemies : this.state.players;
      for (const [unitId, unit] of this.matchShape(casterCtx, effect.shape, impact, pool, targetHint)) {
        for (const action of enemyActions) this.applyAction(casterCtx, action, unit, unitId);
      }
    }
    if (allyActions.length > 0) {
      const pool = casterCtx.isPlayer ? this.state.players : this.state.enemies;
      for (const [unitId, unit] of this.matchShape(casterCtx, effect.shape, impact, pool, targetHint)) {
        for (const action of allyActions) this.applyAction(casterCtx, action, unit, unitId);
      }
    }
    for (const action of selfActions) this.applySelfAction(casterCtx, action, impact);
  }

  // Actions with no unit target at all - just "summon" for now, spawning near the impact point
  // rather than the caster (a ground-targeted summon spell should drop its adds where it was
  // aimed, not at the caster's own feet) using the exact same Enemy-construction shape
  // tickBossAddSpawns already uses for reinforcement waves.
  private applySelfAction(casterCtx: CasterContext, action: EffectAction, impact: { x: number; z: number }) {
    if (action.kind !== "summon") return;
    const addType = ENEMY_TYPES[action.enemyTypeId];
    if (!addType) return;
    for (let i = 0; i < action.count; i++) {
      const add = new Enemy();
      add.enemyTypeId = action.enemyTypeId;
      add.behavior = addType.behavior;
      add.x = impact.x + (Math.random() * 4 - 2);
      add.z = impact.z + (Math.random() * 4 - 2);
      add.homeX = impact.x;
      add.homeZ = impact.z;
      add.hp = addType.stats.maxHp;
      add.maxHp = addType.stats.maxHp;
      this.state.enemies.set(`summon-${casterCtx.sourceId}-${this.addSeq++}`, add);
    }
  }

  // Applies one EffectAction to one unit a shape already matched - `unit`'s actual runtime type
  // (Player vs Enemy) is implied by which polarity/pool resolveEffect scanned to find it (see
  // ACTION_POLARITY), not by anything checkable at this level, so the branches below cast
  // accordingly rather than re-deriving it. ailment/buff/dispel only have somewhere to write when
  // the unit is a Player (Enemy has no ailments/buffs fields, unlike dots - see DotStack) - a
  // player-cast ailment/buff/dispel action landing on an enemy is a documented no-op, same
  // "accepted approximation" tone as this codebase's other asset/geometry limitations.
  private applyAction(casterCtx: CasterContext, action: EffectAction, unit: Player | Enemy, unitId: string) {
    switch (action.kind) {
      case "damage":
        if (casterCtx.isPlayer) {
          const { amount, isCrit } = this.computePlayerDamage(casterCtx.casterPlayer!, action.amount, casterCtx.spellId);
          this.applySpellDamage(unit as Enemy, amount, unitId, casterCtx.sourceId, isCrit);
        } else {
          this.damagePlayer(unitId, unit as Player, action.amount * casterCtx.enrageMultiplier);
        }
        return;
      case "heal":
        if (casterCtx.isPlayer) {
          this.healPlayer(casterCtx.casterPlayer!, casterCtx.sourceId, unit as Player, unitId, action.amount, casterCtx.spellId);
        } else {
          const enemyUnit = unit as Enemy;
          enemyUnit.hp = Math.min(enemyUnit.maxHp, enemyUnit.hp + action.amount);
        }
        return;
      case "dot":
        this.addDot(unit, casterCtx.sourceId, action.amount, action.tickIntervalMs, action.durationMs);
        return;
      case "ailment":
        if (!casterCtx.isPlayer) this.applyAilment(unit as Player, action.ailment, AILMENTS[action.ailment].durationMs);
        return;
      case "buff":
        if (casterCtx.isPlayer) this.applyBuff(unit as Player, action.buff);
        return;
      case "knockback": {
        // A simple clamped push away from the caster, not re-checked against structure/furniture/
        // water collision (those all live behind CombatEngineConfig flags this deep helper doesn't
        // have easy access to) - an accepted approximation matching this codebase's existing
        // "physics-lite" tone (e.g. hex.ts's own ramp/road edge-case comments).
        const dx = unit.x - casterCtx.casterX;
        const dz = unit.z - casterCtx.casterZ;
        const dist = Math.hypot(dx, dz) || 1;
        unit.x = clamp(unit.x + (dx / dist) * action.distance, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
        unit.z = clamp(unit.z + (dz / dist) * action.distance, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
        return;
      }
      case "dispel":
        if (casterCtx.isPlayer) (unit as Player).ailments.clear();
        return;
      case "interrupt":
        this.tryInterruptUnit(unitId, casterCtx.isPlayer);
        return;
    }
  }

  // Sweeps every player's and enemy's own `dots` array (see DotStack) once per tick, applying
  // `damagePerTick` through the same damagePlayer/applySpellDamage paths instant damage already
  // uses (so DOT damage still shows combat text, still triggers boss enrage-on-first-hit, still
  // respects armor mitigation, etc. - it's not a separate damage pipeline) whenever a stack's
  // nextTickAt has come due, then splices out anything past its expiresAt. Appended to tick()
  // as its own method, same "one tick* per mechanic" shape as tickBossAddSpawns/
  // tickBossSpecialAbilities.
  private tickDots() {
    const now = Date.now();
    for (const [sessionId, player] of this.state.players) {
      for (let i = player.dots.length - 1; i >= 0; i--) {
        const dot = player.dots[i];
        if (now >= dot.expiresAt) {
          player.dots.splice(i, 1);
          continue;
        }
        if (now >= dot.nextTickAt) {
          dot.nextTickAt += dot.tickIntervalMs;
          if (player.hp > 0) this.damagePlayer(sessionId, player, dot.damagePerTick);
        }
      }
    }
    for (const [enemyId, enemy] of this.state.enemies) {
      for (let i = enemy.dots.length - 1; i >= 0; i--) {
        const dot = enemy.dots[i];
        if (now >= dot.expiresAt) {
          enemy.dots.splice(i, 1);
          continue;
        }
        if (now >= dot.nextTickAt) {
          dot.nextTickAt += dot.tickIntervalMs;
          if (enemy.hp > 0) this.applySpellDamage(enemy, dot.damagePerTick, enemyId, dot.sourceId);
        }
      }
    }
  }

  // The sole non-projectile player-cast resolution path - every spell is authored as effects[]
  // (the same composable system boss abilities use), so this just applies any onCastBuff talents
  // for this spell first (kept as its own unconditional step here, not folded into resolveEffect,
  // since it's about the caster regardless of what the effect's shape/actions actually hit), then
  // runs each of the spell's effects through resolveEffect exactly like a boss ability does.
  private castSpellEffects(caster: Player, casterSessionId: string, spell: SpellDef, target: ResolvedTarget, impact: { x: number; z: number }) {
    for (const buffId of getOnCastBuffs(resolveClassId(caster.classId), spell.id, caster.talentRanks)) {
      this.applyBuff(caster, buffId);
    }
    const casterCtx = this.makePlayerCasterCtx(caster, casterSessionId, spell.id);
    const hint = this.targetHintId(casterSessionId, target);
    for (const effect of spell.effects) this.resolveEffect(casterCtx, effect, impact, hint);
  }

  // refundCooldown undoes the cooldown-charge this cast consumed at handleCast time (see the
  // activeCasts.push(now) there) - only appropriate when the player chose to cancel their own
  // cast (moving), not when it was cancelled by dying or by an enemy interrupt, which still
  // consume the cooldown same as a completed cast (matches tryInterrupt's own doc comment).
  private cancelPlayerCast(sessionId: string, refundCooldown = false) {
    const pending = this.pendingPlayerCast.get(sessionId);
    if (!pending) return;
    this.pendingPlayerCast.delete(sessionId);
    const player = this.state.players.get(sessionId);
    if (player) player.castSpellId = "";

    if (refundCooldown) {
      const cooldownKey = `${sessionId}:${pending.spellId}`;
      const activeCasts = this.lastCastAt.get(cooldownKey);
      if (activeCasts) {
        const index = activeCasts.indexOf(pending.startedAt);
        if (index !== -1) activeCasts.splice(index, 1);
      }
    }
  }

  private cancelEnemyCast(enemyId: string) {
    if (!this.pendingEnemyCast.has(enemyId)) return;
    this.pendingEnemyCast.delete(enemyId);
    const enemy = this.state.enemies.get(enemyId);
    if (enemy) enemy.isCasting = false;
  }

  // --- Threat/aggro ---

  private addThreat(enemyId: string, sessionId: string, amount: number) {
    if (amount <= 0) return;
    let table = this.threatTables.get(enemyId);
    if (!table) {
      table = new Map();
      this.threatTables.set(enemyId, table);
    }
    table.set(sessionId, (table.get(sessionId) ?? 0) + amount);
  }

  private threatRoleMultiplierFor(sessionId: string): number {
    const player = this.state.players.get(sessionId);
    const role = player && CLASSES[resolveClassId(player.classId)]?.role;
    return role ? ROLE_THREAT_MULTIPLIER[role] : 1;
  }

  // Highest-threat candidate wins; on a tie, keeps the enemy's current target instead of
  // arbitrarily picking whichever candidate happened to iterate first, so two players sitting at
  // equal threat don't cause the enemy to flicker between them every tick.
  // A candidate with zero recorded threat is skipped unless it's already the enemy's current
  // target - being merely in attack/cast range isn't provocation. Without this, tickEnemyAttacks'
  // range-only candidate list let ANY passive enemy (aggroRange<=0, the default - see
  // MeleeStats.aggroRange's own doc comment) take the first free hit on anyone who wandered into
  // range, even though it never proactively engaged them (a caster's much larger cast range than
  // its melee cousin's swing range made this especially visible: a "passive" caster would open
  // fire from well outside anything that looked like aggro). An aggressive type (aggroRange>0)
  // isn't affected - tickEnemyAggro already seeds threat=1 on whoever it engages, well before they
  // ever reach attack range, so they always clear this bar by the time they'd need to.
  private pickThreatTarget(enemyId: string, candidateSessionIds: string[]): string | undefined {
    if (candidateSessionIds.length === 0) return undefined;
    const table = this.threatTables.get(enemyId);
    const currentTarget = this.state.enemies.get(enemyId)?.aggroTargetId;
    let best: string | undefined;
    let bestThreat = -1;
    for (const sessionId of candidateSessionIds) {
      const threat = table?.get(sessionId) ?? 0;
      if (threat <= 0 && sessionId !== currentTarget) continue;
      if (threat > bestThreat || (threat === bestThreat && sessionId === currentTarget)) {
        best = sessionId;
        bestThreat = threat;
      }
    }
    return best;
  }

  // --- Enemy damage / kill ---

  applySpellDamage(target: Enemy, damage: number, targetId: string, killerSessionId: string, isCrit = false) {
    // Starts the enrage clock on the boss's first hit taken, never reset until it dies
    // (each room creates a fresh Enemy() per spawn, so a respawned/re-spawned boss starts clean).
    if (target.behavior === "boss" && target.enragesAt === 0) target.enragesAt = Date.now() + BOSS_ENRAGE_MS;

    this.addThreat(targetId, killerSessionId, damage * this.threatRoleMultiplierFor(killerSessionId));
    this.config.onCombatText({ targetId, targetKind: "enemy", amount: damage, kind: "damage", isCrit });

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
    this.threatTables.delete(enemyId);
    this.lastAddSpawnAt.delete(enemyId);
    this.activeAddIds.delete(enemyId);
    this.lastSpecialCastAt.delete(enemyId);
    this.specialRotationIndex.delete(enemyId);
    this.wanderTarget.delete(enemyId);
    this.wanderPauseUntil.delete(enemyId);
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
    this.tickDots();
    if (this.config.enemiesWander) this.tickEnemyMovement(dt);
    this.tickEnemyAttacks();
    this.tickPendingEnemyCasts();
    this.tickBossAddSpawns();
    this.tickBossSpecialAbilities();
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
      const speed = player.mounted ? PLAYER_SPEED * MOUNT_SPEED_MULTIPLIER : PLAYER_SPEED;

      let nextX = clamp(player.x + normalizedX * speed * dt, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
      let nextZ = clamp(player.z + normalizedZ * speed * dt, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);

      if (this.config.collidableStructures) {
        const resolved = resolveStructureCollisions(nextX, nextZ, STRUCTURES);
        nextX = clamp(resolved.x, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
        nextZ = clamp(resolved.z, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
      }
      if (this.config.collidableFurniture) {
        const resolved = resolveFurnitureCollisions(nextX, nextZ, FURNITURE);
        nextX = clamp(resolved.x, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
        nextZ = clamp(resolved.z, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
      }

      if (this.config.blockWaterTerrain) {
        const slid = resolveWaterSlide(player.x, player.z, nextX, nextZ);
        nextX = slid.x;
        nextZ = slid.z;
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
        const casterCtx = this.makePlayerCasterCtx(player, sessionId, spell.id);
        const projId = this.spawnProjectile(player.x, player.z, "player", pending.target.id, 0, spell.projectileSpeed, sessionId, false);
        this.pendingProjectileEffects.set(projId, { effects: spell.effects, casterCtx, targetHint: pending.target.id });
      } else {
        this.castSpellEffects(player, sessionId, spell, pending.target, impact);
      }
    }
  }

  // Idle enemies wander a short loop around their spawn point; engaged ones (see
  // currentChaseTarget) chase whoever has the most threat on them, independent of that target's
  // distance - a melee enemy has to physically close the gap on a ranged attacker before it can
  // ever land a counter-hit and set aggroTargetId itself via tickEnemyAttacks, so movement can't
  // wait for that. A chase that pulls the enemy too far from home (ENEMY_LEASH_RANGE) is
  // abandoned - threat is wiped and it wanders back toward home on its own next tick, same as a
  // target simply dying or disconnecting.
  private tickEnemyMovement(dt: number) {
    for (const [enemyId, enemy] of this.state.enemies) {
      if (enemy.hp <= 0 || enemy.behavior === "boss") continue; // bosses stay stationary/purely threat-driven, unchanged from before
      const enemyType = ENEMY_TYPES[enemy.enemyTypeId];
      if (!enemyType) continue;

      this.maybeAcquireProximityAggro(enemyId, enemy, enemyType.stats as MeleeStats | CasterStats);

      const chaseTargetId = this.currentChaseTarget(enemyId);
      const chaseTarget = chaseTargetId ? this.state.players.get(chaseTargetId) : undefined;
      const distFromHome = Math.hypot(enemy.x - enemy.homeX, enemy.z - enemy.homeZ);

      if (chaseTarget && chaseTarget.hp > 0 && distFromHome <= (enemy.leashRange || ENEMY_LEASH_RANGE)) {
        this.stepToward(enemy, chaseTarget.x, chaseTarget.z, ENEMY_CHASE_SPEED, dt);
      } else {
        if (chaseTargetId) {
          enemy.aggroTargetId = "";
          this.threatTables.delete(enemyId);
        }
        this.tickWander(enemyId, enemy, dt);
      }
    }
  }

  // Aggressive types (aggroRange > 0) auto-engage the nearest player within range once they have
  // nobody else's attention yet; passive types (the default) never do this - see aggroRange's own
  // doc comment. Seeds a token amount of threat so currentChaseTarget has something to pick up
  // immediately (real damage will quickly outweigh it once the enemy is actually in attack range).
  private maybeAcquireProximityAggro(enemyId: string, enemy: Enemy, stats: MeleeStats | CasterStats) {
    if (this.threatTables.get(enemyId)?.size) return; // already engaged with someone
    const aggroRange = stats.aggroRange ?? 0;
    if (aggroRange <= 0) return;

    let nearestId: string | undefined;
    let nearestDist = Infinity;
    for (const [sessionId, player] of this.state.players) {
      if (player.hp <= 0) continue;
      const dist = Math.hypot(player.x - enemy.x, player.z - enemy.z);
      if (dist <= aggroRange && dist < nearestDist) {
        nearestId = sessionId;
        nearestDist = dist;
      }
    }
    if (nearestId) {
      this.addThreat(enemyId, nearestId, 1);
      enemy.aggroTargetId = nearestId;
    }
  }

  // Whoever currently has the most threat on this enemy - independent of pickThreatTarget's usual
  // candidate list (which tickEnemyAttacks restricts to players already in attack range), since a
  // chase target needs to be tracked well before it's back in range.
  private currentChaseTarget(enemyId: string): string | undefined {
    const table = this.threatTables.get(enemyId);
    if (!table || table.size === 0) return undefined;
    return this.pickThreatTarget(enemyId, [...table.keys()]);
  }

  private stepToward(enemy: Enemy, targetX: number, targetZ: number, speed: number, dt: number) {
    const dx = targetX - enemy.x;
    const dz = targetZ - enemy.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) return;

    const step = Math.min(speed * dt, dist);
    let nextX = clamp(enemy.x + (dx / dist) * step, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
    let nextZ = clamp(enemy.z + (dz / dist) * step, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);

    if (this.config.collidableStructures) {
      const resolved = resolveStructureCollisions(nextX, nextZ, STRUCTURES);
      nextX = clamp(resolved.x, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
      nextZ = clamp(resolved.z, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
    }

    if (this.config.collidableFurniture) {
      const resolved = resolveFurnitureCollisions(nextX, nextZ, FURNITURE);
      nextX = clamp(resolved.x, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
      nextZ = clamp(resolved.z, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
    }

    if (this.config.blockWaterTerrain) {
      const slid = resolveWaterSlide(enemy.x, enemy.z, nextX, nextZ);
      nextX = slid.x;
      nextZ = slid.z;
    }

    enemy.x = nextX;
    enemy.z = nextZ;
  }

  private tickWander(enemyId: string, enemy: Enemy, dt: number) {
    const now = Date.now();
    if (now < (this.wanderPauseUntil.get(enemyId) ?? 0)) return;

    let target = this.wanderTarget.get(enemyId);
    if (!target) {
      target = this.pickWanderTarget(enemy);
      this.wanderTarget.set(enemyId, target);
    }

    if (Math.hypot(enemy.x - target.x, enemy.z - target.z) < 0.15) {
      this.wanderTarget.delete(enemyId);
      this.wanderPauseUntil.set(enemyId, now + ENEMY_WANDER_PAUSE_MS + Math.random() * ENEMY_WANDER_PAUSE_JITTER_MS);
      return;
    }

    this.stepToward(enemy, target.x, target.z, ENEMY_WANDER_SPEED, dt);
  }

  private pickWanderTarget(enemy: Enemy): { x: number; z: number } {
    return this.findClearPointNear(enemy.homeX, enemy.homeZ, enemy.wanderRadius || ENEMY_WANDER_RADIUS);
  }

  // Sampling a random point in a circle used to ignore structures/furniture entirely - once
  // decoration/buildings got real colliders (see shared's BUILDING_FOOTPRINT/FURNITURE_FOOTPRINT),
  // a leg that happened to land inside or behind one gave stepToward's push-out nothing reachable
  // to walk toward, so the enemy just vibrated against the obstacle every tick instead of visibly
  // wandering. Retries a few random points and keeps the first one that isn't blocked; if every
  // attempt is (boxed in by dense decoration), the center itself is always the fallback rather
  // than committing to an unreachable spot. Used for wander legs above (via pickWanderTarget) and
  // by WorldRoom to pick where a zone-based enemy spawns (see EnemySpawnZoneDef).
  findClearPointNear(cx: number, cz: number, radius: number): { x: number; z: number } {
    for (let attempt = 0; attempt < ENEMY_WANDER_TARGET_ATTEMPTS; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * radius;
      const x = clamp(cx + Math.cos(angle) * r, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
      const z = clamp(cz + Math.sin(angle) * r, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
      if (!this.isPointBlocked(x, z)) return { x, z };
    }
    return { x: cx, z: cz };
  }

  private isPointBlocked(x: number, z: number): boolean {
    if (this.config.collidableStructures) {
      const resolved = resolveStructureCollisions(x, z, STRUCTURES);
      if (Math.hypot(resolved.x - x, resolved.z - z) > 0.01) return true;
    }
    if (this.config.collidableFurniture) {
      const resolved = resolveFurnitureCollisions(x, z, FURNITURE);
      if (Math.hypot(resolved.x - x, resolved.z - z) > 0.01) return true;
    }
    return false;
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
          const candidates: string[] = [];
          for (const [sessionId, player] of this.state.players) {
            if (player.hp <= 0) continue;
            const dist = Math.hypot(player.x - enemy.x, player.z - enemy.z);
            if (dist <= range) candidates.push(sessionId);
          }
          const targetId = this.pickThreatTarget(enemyId, candidates);
          if (targetId) {
            this.damagePlayer(targetId, this.state.players.get(targetId)!, damage * enrageMultiplier);
            this.lastMeleeAttackAt.set(enemyId, now);
            enemy.aggroTargetId = targetId;
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

        const candidates: string[] = [];
        for (const [sessionId, player] of this.state.players) {
          if (player.hp <= 0) continue;
          const dist = Math.hypot(player.x - enemy.x, player.z - enemy.z);
          if (dist > range) continue;
          if (this.config.collidableStructures && !hasLineOfSight(enemy.x, enemy.z, player.x, player.z, STRUCTURES)) continue;
          candidates.push(sessionId);
        }
        const targetId = this.pickThreatTarget(enemyId, candidates);
        if (targetId) {
          enemy.isCasting = true;
          this.pendingEnemyCast.set(enemyId, { targetSessionId: targetId, fireAt: now + castTimeMs });
          this.lastCasterAttackAt.set(enemyId, now);
          enemy.aggroTargetId = targetId;
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
      if (enemy) {
        enemy.isCasting = false;
        enemy.castAbilityName = "";
      }
      if (!enemy || enemy.hp <= 0) continue;

      if (pending.abilityId) {
        this.resolveBossAbility(enemy, enemyId, pending);
        continue;
      }

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

  // Periodic reinforcement waves - purely opt-in via BossStats.addEnemyTypeId, so a boss with
  // none of those fields set (every non-boss enemy, and any boss content authored before this
  // existed) never spawns anything here. Spawned adds are ordinary Enemy entries with no owner
  // link back to the boss beyond activeAddIds (used only to cap concurrency) - they get threat,
  // AI, rewards, and rendering entirely for free through the normal enemy code paths.
  private tickBossAddSpawns() {
    const now = Date.now();

    for (const [bossId, boss] of this.state.enemies) {
      if (boss.behavior !== "boss" || boss.hp <= 0) continue;
      // Only summon while actually in a fight - aggroTargetId is only ever set once the boss
      // has picked a target (see tickEnemyAttacks), so an untouched boss never stacks up
      // reinforcements nobody is there to fight.
      if (boss.aggroTargetId === "") continue;
      const stats = ENEMY_TYPES[boss.enemyTypeId]?.stats as BossStats | undefined;
      if (!stats?.addEnemyTypeId || !stats.addIntervalMs || !stats.addCount || !stats.maxConcurrentAdds) continue;

      let liveAdds = this.activeAddIds.get(bossId);
      if (liveAdds) {
        for (const addId of liveAdds) {
          if (!this.state.enemies.has(addId)) liveAdds.delete(addId);
        }
      } else {
        liveAdds = new Set();
        this.activeAddIds.set(bossId, liveAdds);
      }

      if (liveAdds.size >= stats.maxConcurrentAdds) continue;
      const lastSpawn = this.lastAddSpawnAt.get(bossId);
      if (lastSpawn === undefined) {
        // First tick this boss has been seen engaged - defer the first wave a full interval
        // out from the pull instead of dumping adds in immediately.
        this.lastAddSpawnAt.set(bossId, now);
        continue;
      }
      if (now - lastSpawn < stats.addIntervalMs) continue;

      const addType = ENEMY_TYPES[stats.addEnemyTypeId];
      if (!addType) continue; // content deleted after this boss was authored

      for (let i = 0; i < stats.addCount && liveAdds.size < stats.maxConcurrentAdds; i++) {
        const add = new Enemy();
        add.enemyTypeId = stats.addEnemyTypeId;
        add.behavior = addType.behavior;
        add.x = boss.x + (Math.random() * 4 - 2);
        add.z = boss.z + (Math.random() * 4 - 2);
        add.homeX = boss.x;
        add.homeZ = boss.z;
        add.hp = addType.stats.maxHp;
        add.maxHp = addType.stats.maxHp;

        const addId = `add-${bossId}-${this.addSeq++}`;
        this.state.enemies.set(addId, add);
        liveAdds.add(addId);
      }
      this.lastAddSpawnAt.set(bossId, now);
    }
  }

  // Special-spell rotation - purely opt-in via BossStats.specialAbilities/specialCooldownMs, so
  // a boss without both set never uses this. Shares the same pendingEnemyCast/isCasting windup
  // slot as the existing phase-2 attack (a boss only ever winds up one thing at a time - whichever
  // cooldown comes due first claims the slot, the other just fires as soon as it's free next
  // tick), which also means the existing interrupt mechanic (tryInterruptUnit) works on these for
  // free with no extra code.
  private tickBossSpecialAbilities() {
    const now = Date.now();

    for (const [bossId, boss] of this.state.enemies) {
      if (boss.behavior !== "boss" || boss.hp <= 0) continue;
      if (boss.aggroTargetId === "") continue; // not engaged yet - see tickBossAddSpawns for the same reasoning
      if (this.pendingEnemyCast.has(bossId)) continue; // already winding something up
      if ((this.interruptLockoutUntil.get(bossId) ?? 0) > now) continue;

      const stats = ENEMY_TYPES[boss.enemyTypeId]?.stats as BossStats | undefined;
      if (!stats?.specialAbilities?.length || !stats.specialCooldownMs) continue;

      const lastCast = this.lastSpecialCastAt.get(bossId);
      if (lastCast === undefined) {
        // First tick this boss has been seen engaged - defer the first cast a full cooldown out
        // from the pull instead of firing immediately (mirrors tickBossAddSpawns).
        this.lastSpecialCastAt.set(bossId, now);
        continue;
      }
      if (now - lastCast < stats.specialCooldownMs) continue;

      const index = this.specialRotationIndex.get(bossId) ?? 0;
      const ability = stats.specialAbilities[index % stats.specialAbilities.length];
      this.specialRotationIndex.set(bossId, index + 1);
      this.lastSpecialCastAt.set(bossId, now);

      boss.isCasting = true;
      boss.castAbilityName = ability.name;
      this.pendingEnemyCast.set(bossId, {
        targetSessionId: boss.aggroTargetId,
        fireAt: now + ability.castTimeMs,
        abilityId: ability.id,
      });
    }
  }

  private resolveBossAbility(enemy: Enemy, enemyId: string, pending: PendingEnemyCast) {
    const stats = ENEMY_TYPES[enemy.enemyTypeId]?.stats as BossStats | undefined;
    const ability = stats?.specialAbilities?.find((a) => a.id === pending.abilityId);
    if (!ability) return; // content deleted mid-windup - cast fizzles

    const casterCtx: CasterContext = {
      isPlayer: false,
      casterX: enemy.x,
      casterZ: enemy.z,
      sourceId: enemyId,
      enrageMultiplier: this.isBossEnraged(enemy) ? BOSS_ENRAGE_DAMAGE_MULTIPLIER : 1,
    };
    const target = this.state.players.get(pending.targetSessionId);
    const impact = target ? { x: target.x, z: target.z } : { x: enemy.x, z: enemy.z };
    this.resolveEffect(casterCtx, ability.effect, impact, pending.targetSessionId);
  }

  private spawnProjectile(
    x: number,
    z: number,
    source: "enemy" | "player",
    targetId: string,
    damage: number,
    speed: number,
    ownerId: string,
    isCrit = false,
  ): string {
    const projectile = new Projectile();
    projectile.x = x;
    projectile.z = z;
    projectile.source = source;
    projectile.targetId = targetId;
    projectile.damage = damage;
    projectile.speed = speed;
    projectile.ownerId = ownerId;
    projectile.isCrit = isCrit;

    const id = `proj-${this.projectileSeq++}`;
    this.state.projectiles.set(id, projectile);
    this.projectileAge.set(id, 0);
    return id;
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
          const pending = this.pendingProjectileEffects.get(id);
          if (pending) {
            // Re-resolved against the target's live arrival position (not wherever they were at
            // cast time) - matches the homing behavior above (targetX/targetZ re-fetched every
            // tick), so e.g. a circle-on-impact AOE lands centered on where they actually are.
            const impact = { x: enemy.x, z: enemy.z };
            for (const effect of pending.effects) this.resolveEffect(pending.casterCtx, effect, impact, pending.targetHint);
          } else {
            this.applySpellDamage(enemy, projectile.damage, projectile.targetId, projectile.ownerId, projectile.isCrit);
          }
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
    this.pendingProjectileEffects.delete(id);
  }
}
