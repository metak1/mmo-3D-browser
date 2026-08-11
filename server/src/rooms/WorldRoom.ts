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
  PROJECTILE_MAX_LIFETIME_MS,
  SPELLS,
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
  private projectileAge = new Map<string, number>(); // key: projectileId, value: ms alive
  private projectileSeq = 0;

  onCreate() {
    this.setState(new WorldState());

    for (const point of SPAWN_POINTS) {
      this.spawnEnemy(point);
    }

    this.onMessage("input", (client, message: InputMessage) => {
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
    target.hp = Math.max(0, target.hp - spell.damage);

    if (target.hp === 0) {
      this.killEnemy(message.targetId);
    }
  }

  private killEnemy(enemyId: string) {
    this.state.enemies.delete(enemyId);
    this.lastMeleeAttackAt.delete(enemyId);
    this.lastCasterAttackAt.delete(enemyId);

    const point = SPAWN_POINTS.find((p) => p.id === enemyId);
    if (!point) return;

    this.clock.setTimeout(() => this.spawnEnemy(point), ENEMY_RESPAWN_MS);
  }

  private respawnPlayer(player: Player) {
    player.hp = player.maxHp;
    player.x = 0;
    player.y = 0;
    player.z = 0;
  }

  private tick(dt: number) {
    this.tickPlayerMovement(dt);
    this.tickEnemyAttacks();
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

  private tickEnemyAttacks() {
    const now = Date.now();

    for (const [enemyId, enemy] of this.state.enemies) {
      if (enemy.hp <= 0) continue;

      if (enemy.kind === "melee") {
        const stats = ENEMY_STATS.melee;
        const lastAttack = this.lastMeleeAttackAt.get(enemyId) ?? 0;
        if (now - lastAttack < stats.intervalMs) continue;

        for (const player of this.state.players.values()) {
          if (player.hp <= 0) continue;
          const dist = Math.hypot(player.x - enemy.x, player.z - enemy.z);
          if (dist <= stats.range) {
            this.damagePlayer(player, stats.damage);
            this.lastMeleeAttackAt.set(enemyId, now);
            break;
          }
        }
      } else {
        const stats = ENEMY_STATS.caster;
        const lastAttack = this.lastCasterAttackAt.get(enemyId) ?? 0;
        if (now - lastAttack < stats.cooldownMs) continue;

        for (const player of this.state.players.values()) {
          if (player.hp <= 0) continue;
          const dx = player.x - enemy.x;
          const dz = player.z - enemy.z;
          const dist = Math.hypot(dx, dz);
          if (dist <= stats.range && dist > 0) {
            this.spawnProjectile(enemy.x, enemy.z, dx / dist, dz / dist, stats.damage);
            this.lastCasterAttackAt.set(enemyId, now);
            break;
          }
        }
      }
    }
  }

  private spawnProjectile(x: number, z: number, dirX: number, dirZ: number, damage: number) {
    const projectile = new Projectile();
    projectile.x = x;
    projectile.z = z;
    projectile.dirX = dirX;
    projectile.dirZ = dirZ;
    projectile.damage = damage;

    const id = `proj-${this.projectileSeq++}`;
    this.state.projectiles.set(id, projectile);
    this.projectileAge.set(id, 0);
  }

  private tickProjectiles(dt: number) {
    const stats = ENEMY_STATS.caster;

    for (const [id, projectile] of this.state.projectiles) {
      projectile.x += projectile.dirX * stats.projectileSpeed * dt;
      projectile.z += projectile.dirZ * stats.projectileSpeed * dt;

      const age = (this.projectileAge.get(id) ?? 0) + dt * 1000;
      this.projectileAge.set(id, age);

      let hit = false;
      for (const player of this.state.players.values()) {
        if (player.hp <= 0) continue;
        const dist = Math.hypot(player.x - projectile.x, player.z - projectile.z);
        if (dist <= stats.hitRadius) {
          this.damagePlayer(player, projectile.damage);
          hit = true;
          break;
        }
      }

      const outOfBounds =
        Math.abs(projectile.x) > MAP_HALF_EXTENT + 5 || Math.abs(projectile.z) > MAP_HALF_EXTENT + 5;

      if (hit || outOfBounds || age > PROJECTILE_MAX_LIFETIME_MS) {
        this.state.projectiles.delete(id);
        this.projectileAge.delete(id);
      }
    }
  }

  private damagePlayer(player: Player, amount: number) {
    player.hp = Math.max(0, player.hp - amount);
    if (player.hp === 0) {
      this.respawnPlayer(player);
    }
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
