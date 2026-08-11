import { Room, Client } from "@colyseus/core";
import {
  CastMessage,
  ENEMY_RESPAWN_MS,
  ENEMY_STATS,
  EnemyKind,
  InputMessage,
  MAP_HALF_EXTENT,
  PLAYER_MAX_HP,
  PLAYER_SPEED,
  PROJECTILE_HIT_RADIUS,
  PROJECTILE_MAX_LIFETIME_MS,
  SPELLS,
  SpellId,
} from "@mmo/shared";
import { Enemy, Player, Projectile, WorldState } from "./schema/WorldState.js";

const SIMULATION_INTERVAL_MS = 1000 / 30;
const RANGE_BUFFER = 1; // small allowance for latency between client input and server check

interface PlayerInput {
  moveX: number;
  moveZ: number;
  seq: number;
}

interface EnemySpawnPoint {
  id: string;
  kind: EnemyKind;
  x: number;
  z: number;
}

interface PendingPlayerCast {
  spellId: SpellId;
  targetId: string;
  fireAt: number;
}

interface PendingEnemyCast {
  targetSessionId: string;
  fireAt: number;
}

const SPAWN_POINTS: EnemySpawnPoint[] = [
  { id: "melee-1", kind: "melee", x: 8, z: 8 },
  { id: "melee-2", kind: "melee", x: -8, z: 8 },
  { id: "caster-1", kind: "caster", x: 8, z: -8 },
  { id: "caster-2", kind: "caster", x: -8, z: -8 },
];

export class WorldRoom extends Room<WorldState> {
  private lastInput = new Map<string, PlayerInput>();
  private lastCastAt = new Map<string, number>(); // key: `${sessionId}:${spellId}`
  private lastMeleeAttackAt = new Map<string, number>(); // key: enemyId
  private lastCasterAttackAt = new Map<string, number>(); // key: enemyId
  private pendingPlayerCast = new Map<string, PendingPlayerCast>(); // key: sessionId
  private pendingEnemyCast = new Map<string, PendingEnemyCast>(); // key: enemyId
  private projectileAge = new Map<string, number>(); // key: projectileId, value: ms alive
  private projectileSeq = 0;

  onCreate() {
    this.setState(new WorldState());

    for (const point of SPAWN_POINTS) {
      this.spawnEnemy(point);
    }

    this.onMessage("input", (client, message: InputMessage) => {
      if (message.moveX !== 0 || message.moveZ !== 0) {
        this.cancelPlayerCast(client.sessionId);
      }

      this.lastInput.set(client.sessionId, {
        moveX: clamp(message.moveX, -1, 1),
        moveZ: clamp(message.moveZ, -1, 1),
        seq: message.seq,
      });
    });

    this.onMessage("cast", (client, message: CastMessage) => this.handleCast(client, message));

    this.setSimulationInterval(() => this.tick(SIMULATION_INTERVAL_MS / 1000), SIMULATION_INTERVAL_MS);
  }

  onJoin(client: Client) {
    const player = new Player();
    player.x = 0;
    player.y = 0;
    player.z = 0;
    player.hp = PLAYER_MAX_HP;
    player.maxHp = PLAYER_MAX_HP;
    this.state.players.set(client.sessionId, player);
    console.log(`[WorldRoom] ${client.sessionId} joined`);
  }

  onLeave(client: Client) {
    this.cancelPlayerCast(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.lastInput.delete(client.sessionId);
    console.log(`[WorldRoom] ${client.sessionId} left`);
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

  private handleCast(client: Client, message: CastMessage) {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.hp <= 0) return;
    if (player.castSpellId !== 0) return; // already casting

    const spell = SPELLS[message.spellId];
    if (!spell) return;

    const cooldownKey = `${client.sessionId}:${message.spellId}`;
    const now = Date.now();
    const lastCast = this.lastCastAt.get(cooldownKey) ?? 0;
    if (now - lastCast < spell.cooldownMs) return;

    const target = this.state.enemies.get(message.targetId);
    if (!target || target.hp <= 0) return;

    const dist = Math.hypot(player.x - target.x, player.z - target.z);
    if (dist > spell.range + RANGE_BUFFER) return;

    this.lastCastAt.set(cooldownKey, now);

    if (spell.castTimeMs > 0) {
      player.castSpellId = message.spellId;
      this.pendingPlayerCast.set(client.sessionId, {
        spellId: message.spellId,
        targetId: message.targetId,
        fireAt: now + spell.castTimeMs,
      });
    } else {
      this.applySpellDamage(target, spell.damage, message.targetId);
    }
  }

  private cancelPlayerCast(sessionId: string) {
    if (!this.pendingPlayerCast.has(sessionId)) return;
    this.pendingPlayerCast.delete(sessionId);
    const player = this.state.players.get(sessionId);
    if (player) player.castSpellId = 0;
  }

  private applySpellDamage(target: Enemy, damage: number, targetId: string) {
    target.hp = Math.max(0, target.hp - damage);
    if (target.hp === 0) {
      this.killEnemy(targetId);
    }
  }

  private killEnemy(enemyId: string) {
    this.state.enemies.delete(enemyId);
    this.lastMeleeAttackAt.delete(enemyId);
    this.lastCasterAttackAt.delete(enemyId);
    this.pendingEnemyCast.delete(enemyId);

    const point = SPAWN_POINTS.find((p) => p.id === enemyId);
    if (!point) return;

    this.clock.setTimeout(() => this.spawnEnemy(point), ENEMY_RESPAWN_MS);
  }

  private respawnPlayer(sessionId: string, player: Player) {
    this.cancelPlayerCast(sessionId);
    player.hp = player.maxHp;
    player.x = 0;
    player.y = 0;
    player.z = 0;
  }

  private tick(dt: number) {
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

      player.x = clamp(player.x + normalizedX * PLAYER_SPEED * dt, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
      player.z = clamp(player.z + normalizedZ * PLAYER_SPEED * dt, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
      player.rotationY = Math.atan2(normalizedX, normalizedZ);
    }
  }

  private tickPlayerCasts() {
    const now = Date.now();

    for (const [sessionId, pending] of this.pendingPlayerCast) {
      if (now < pending.fireAt) continue;
      this.pendingPlayerCast.delete(sessionId);

      const player = this.state.players.get(sessionId);
      if (player) player.castSpellId = 0;
      if (!player || player.hp <= 0) continue;

      const spell = SPELLS[pending.spellId];
      const target = this.state.enemies.get(pending.targetId);
      if (!target || target.hp <= 0) continue; // target gone, cast fizzles

      if (spell.projectileSpeed) {
        this.spawnProjectile(player.x, player.z, "player", pending.targetId, spell.damage, spell.projectileSpeed);
      } else {
        this.applySpellDamage(target, spell.damage, pending.targetId);
      }
    }
  }

  private tickEnemyAttacks() {
    const now = Date.now();

    for (const [enemyId, enemy] of this.state.enemies) {
      if (enemy.hp <= 0) continue;

      if (enemy.kind === "melee") {
        const stats = ENEMY_STATS.melee;
        const lastAttack = this.lastMeleeAttackAt.get(enemyId) ?? 0;
        if (now - lastAttack < stats.intervalMs) continue;

        for (const [sessionId, player] of this.state.players) {
          if (player.hp <= 0) continue;
          const dist = Math.hypot(player.x - enemy.x, player.z - enemy.z);
          if (dist <= stats.range) {
            this.damagePlayer(sessionId, player, stats.damage);
            this.lastMeleeAttackAt.set(enemyId, now);
            break;
          }
        }
      } else {
        if (this.pendingEnemyCast.has(enemyId)) continue; // already winding up

        const stats = ENEMY_STATS.caster;
        const lastAttack = this.lastCasterAttackAt.get(enemyId) ?? 0;
        if (now - lastAttack < stats.cooldownMs) continue;

        for (const [sessionId, player] of this.state.players) {
          if (player.hp <= 0) continue;
          const dist = Math.hypot(player.x - enemy.x, player.z - enemy.z);
          if (dist <= stats.range) {
            enemy.isCasting = true;
            this.pendingEnemyCast.set(enemyId, { targetSessionId: sessionId, fireAt: now + stats.castTimeMs });
            this.lastCasterAttackAt.set(enemyId, now);
            break;
          }
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

      const stats = ENEMY_STATS.caster;
      this.spawnProjectile(enemy.x, enemy.z, "enemy", pending.targetSessionId, stats.damage, stats.projectileSpeed);
    }
  }

  private spawnProjectile(
    x: number,
    z: number,
    source: "enemy" | "player",
    targetId: string,
    damage: number,
    speed: number,
  ) {
    const projectile = new Projectile();
    projectile.x = x;
    projectile.z = z;
    projectile.source = source;
    projectile.targetId = targetId;
    projectile.damage = damage;
    projectile.speed = speed;

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
          this.damagePlayer(projectile.targetId, player, projectile.damage);
        } else {
          const enemy = this.state.enemies.get(projectile.targetId)!;
          this.applySpellDamage(enemy, projectile.damage, projectile.targetId);
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

  private damagePlayer(sessionId: string, player: Player, amount: number) {
    player.hp = Math.max(0, player.hp - amount);
    if (player.hp === 0) {
      this.respawnPlayer(sessionId, player);
    }
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
