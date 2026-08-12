import { Room, Client } from "@colyseus/core";
import {
  CastMessage,
  CLASSES,
  ClassId,
  CRIT_MULTIPLIER,
  DAMAGE_STAT_FACTOR,
  DEFAULT_CLASS_ID,
  ENEMY_RESPAWN_MS,
  ENEMY_STATS,
  EnemyKind,
  EquipMessage,
  EquipSlot,
  INVENTORY_SIZE,
  ITEM_IDS,
  ITEMS,
  InputMessage,
  LOOT_BAG_AGGREGATE_RADIUS,
  LOOT_BAG_DESPAWN_MS,
  LOOT_DROP_CHANCE,
  LOOT_PICKUP_RADIUS,
  LootTakeMessage,
  MAIN_STAT_PER_LEVEL,
  MAP_HALF_EXTENT,
  MAX_LEVEL,
  PLAYER_SPEED,
  PROJECTILE_HIT_RADIUS,
  PROJECTILE_MAX_LIFETIME_MS,
  PlayerStats,
  SPELLS,
  SpellId,
  UnequipMessage,
  VITALITY_PER_LEVEL,
  VITALITY_TO_HP,
  XP_PER_ENEMY_KIND,
  critChanceFromLuck,
  getEffectiveStats,
  xpForNextLevel,
} from "@mmo/shared";
import { verifyToken } from "../auth/jwt.js";
import { getCharacterForUser, saveCharacterProgress } from "../db/characters.js";
import { listCharacterItems, replaceCharacterItems } from "../db/items.js";
import { Enemy, LootBag, Player, Projectile, WorldState } from "./schema/WorldState.js";

const SIMULATION_INTERVAL_MS = 1000 / 30;
const RANGE_BUFFER = 1; // small allowance for latency between client input and server check
const AUTOSAVE_INTERVAL_MS = 30_000;

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
  private lootBagSeq = 0;
  private characterIdBySession = new Map<string, number>();

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
    this.onMessage("loot_take", (client, message: LootTakeMessage) => this.handleLootTake(client, message));
    this.onMessage("equip", (client, message: EquipMessage) => this.handleEquip(client, message));
    this.onMessage("unequip", (client, message: UnequipMessage) => this.handleUnequip(client, message));

    this.setSimulationInterval(() => this.tick(SIMULATION_INTERVAL_MS / 1000), SIMULATION_INTERVAL_MS);
    this.clock.setInterval(() => this.autosaveAll(), AUTOSAVE_INTERVAL_MS);
  }

  async onJoin(client: Client, options?: { token?: string; characterId?: number }) {
    if (!options?.token || !options?.characterId) {
      throw new Error("Missing token or characterId");
    }

    let userId: number;
    try {
      userId = verifyToken(options.token).userId;
    } catch {
      throw new Error("Invalid or expired session");
    }

    const character = await getCharacterForUser(options.characterId, userId);
    if (!character) {
      throw new Error("Character not found");
    }

    const classId = this.resolveClassId(character.class_id);

    const player = new Player();
    player.x = 0;
    player.y = 0;
    player.z = 0;
    player.classId = classId;
    player.level = character.level;
    player.xp = character.xp;
    player.strength = character.strength;
    player.dexterity = character.dexterity;
    player.intellect = character.intellect;
    player.vitality = character.vitality;
    player.luck = character.luck;
    player.armor = character.armor;

    const items = await listCharacterItems(character.id);
    for (const row of items) {
      if (row.slot === "weapon") player.equippedWeapon = row.item_id;
      else if (row.slot === "armor") player.equippedArmor = row.item_id;
      else if (row.slot === "trinket") player.equippedTrinket = row.item_id;
      else player.inventory.push(row.item_id);
    }

    player.maxHp = this.getEffectiveStatsFor(player).vitality * VITALITY_TO_HP;
    player.hp = player.maxHp;

    this.state.players.set(client.sessionId, player);
    this.characterIdBySession.set(client.sessionId, character.id);
    console.log(`[WorldRoom] ${client.sessionId} joined as ${character.name} (${classId}, lv ${player.level})`);
  }

  private resolveClassId(raw: unknown): ClassId {
    if (typeof raw === "string" && Object.prototype.hasOwnProperty.call(CLASSES, raw)) {
      return raw as ClassId;
    }
    return DEFAULT_CLASS_ID;
  }

  private bumpMainStat(player: Player, mainStat: "strength" | "dexterity" | "intellect", amount: number) {
    switch (mainStat) {
      case "strength":
        player.strength += amount;
        break;
      case "dexterity":
        player.dexterity += amount;
        break;
      case "intellect":
        player.intellect += amount;
        break;
    }
  }

  private getEffectiveStatsFor(player: Player): PlayerStats {
    return getEffectiveStats(
      {
        strength: player.strength,
        dexterity: player.dexterity,
        intellect: player.intellect,
        vitality: player.vitality,
        luck: player.luck,
        armor: player.armor,
      },
      { weapon: player.equippedWeapon, armor: player.equippedArmor, trinket: player.equippedTrinket },
    );
  }

  private getEquippedItemId(player: Player, slot: EquipSlot): string {
    switch (slot) {
      case "weapon":
        return player.equippedWeapon;
      case "armor":
        return player.equippedArmor;
      case "trinket":
        return player.equippedTrinket;
    }
  }

  private setEquippedItemId(player: Player, slot: EquipSlot, itemId: string) {
    switch (slot) {
      case "weapon":
        player.equippedWeapon = itemId;
        break;
      case "armor":
        player.equippedArmor = itemId;
        break;
      case "trinket":
        player.equippedTrinket = itemId;
        break;
    }
  }

  private recomputeMaxHp(player: Player) {
    player.maxHp = this.getEffectiveStatsFor(player).vitality * VITALITY_TO_HP;
    player.hp = Math.min(player.hp, player.maxHp);
  }

  async onLeave(client: Client) {
    await this.saveCharacter(client.sessionId);

    this.cancelPlayerCast(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.lastInput.delete(client.sessionId);
    this.characterIdBySession.delete(client.sessionId);
    console.log(`[WorldRoom] ${client.sessionId} left`);
  }

  private async saveCharacter(sessionId: string) {
    const player = this.state.players.get(sessionId);
    const characterId = this.characterIdBySession.get(sessionId);
    if (!player || !characterId) return;

    try {
      await saveCharacterProgress(characterId, {
        level: player.level,
        xp: player.xp,
        stats: {
          strength: player.strength,
          dexterity: player.dexterity,
          intellect: player.intellect,
          vitality: player.vitality,
          luck: player.luck,
          armor: player.armor,
        },
      });
    } catch (err) {
      console.error(`[WorldRoom] failed to save character ${characterId}:`, err);
    }
  }

  private async autosaveAll() {
    for (const sessionId of this.characterIdBySession.keys()) {
      await this.saveCharacter(sessionId);
    }
  }

  private async persistItems(sessionId: string) {
    const player = this.state.players.get(sessionId);
    const characterId = this.characterIdBySession.get(sessionId);
    if (!player || !characterId) return;

    try {
      await replaceCharacterItems(characterId, [...player.inventory], {
        weapon: player.equippedWeapon,
        armor: player.equippedArmor,
        trinket: player.equippedTrinket,
      });
    } catch (err) {
      console.error(`[WorldRoom] failed to persist items for character ${characterId}:`, err);
    }
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
      const damage = this.computePlayerDamage(player, spell.damage);
      this.applySpellDamage(target, damage, message.targetId, client.sessionId);
    }
  }

  private cancelPlayerCast(sessionId: string) {
    if (!this.pendingPlayerCast.has(sessionId)) return;
    this.pendingPlayerCast.delete(sessionId);
    const player = this.state.players.get(sessionId);
    if (player) player.castSpellId = 0;
  }

  private applySpellDamage(target: Enemy, damage: number, targetId: string, killerSessionId: string) {
    const kind = target.kind as EnemyKind;
    target.hp = Math.max(0, target.hp - damage);
    if (target.hp === 0) {
      const deathX = target.x;
      const deathZ = target.z;
      this.killEnemy(targetId);
      const killer = this.state.players.get(killerSessionId);
      if (killer) this.grantXp(killer, XP_PER_ENEMY_KIND[kind]);
      this.maybeDropLoot(deathX, deathZ);
    }
  }

  private maybeDropLoot(x: number, z: number) {
    if (Math.random() >= LOOT_DROP_CHANCE) return;
    const itemId = ITEM_IDS[Math.floor(Math.random() * ITEM_IDS.length)];
    this.dropLoot(x, z, itemId);
  }

  private dropLoot(x: number, z: number, itemId: string) {
    for (const bag of this.state.lootBags.values()) {
      const dist = Math.hypot(bag.x - x, bag.z - z);
      if (dist <= LOOT_BAG_AGGREGATE_RADIUS) {
        bag.items.push(itemId);
        return;
      }
    }

    const bag = new LootBag();
    bag.x = x;
    bag.z = z;
    bag.items.push(itemId);

    const id = `bag-${this.lootBagSeq++}`;
    this.state.lootBags.set(id, bag);
    this.clock.setTimeout(() => this.state.lootBags.delete(id), LOOT_BAG_DESPAWN_MS);
  }

  private handleLootTake(client: Client, message: LootTakeMessage) {
    const player = this.state.players.get(client.sessionId);
    const bag = this.state.lootBags.get(message.bagId);
    if (!player || !bag) return;

    const dist = Math.hypot(player.x - bag.x, player.z - bag.z);
    if (dist > LOOT_PICKUP_RADIUS) return;

    const index = bag.items.indexOf(message.itemId);
    if (index === -1) return;
    if (player.inventory.length >= INVENTORY_SIZE) return;

    bag.items.splice(index, 1);
    player.inventory.push(message.itemId);

    if (bag.items.length === 0) {
      this.state.lootBags.delete(message.bagId);
    }

    this.persistItems(client.sessionId);
  }

  private handleEquip(client: Client, message: EquipMessage) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const item = ITEMS[message.itemId];
    if (!item) return;

    const index = player.inventory.indexOf(message.itemId);
    if (index === -1) return;

    player.inventory.splice(index, 1);

    const previous = this.getEquippedItemId(player, item.slot);
    if (previous) player.inventory.push(previous);
    this.setEquippedItemId(player, item.slot, message.itemId);

    this.recomputeMaxHp(player);
    this.persistItems(client.sessionId);
  }

  private handleUnequip(client: Client, message: UnequipMessage) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const itemId = this.getEquippedItemId(player, message.slot);
    if (!itemId) return;
    if (player.inventory.length >= INVENTORY_SIZE) return;

    this.setEquippedItemId(player, message.slot, "");
    player.inventory.push(itemId);

    this.recomputeMaxHp(player);
    this.persistItems(client.sessionId);
  }

  private grantXp(player: Player, amount: number) {
    player.xp += amount;

    while (player.level < MAX_LEVEL && player.xp >= xpForNextLevel(player.level)) {
      player.xp -= xpForNextLevel(player.level);
      player.level += 1;
      player.vitality += VITALITY_PER_LEVEL;
      this.bumpMainStat(player, CLASSES[this.resolveClassId(player.classId)].mainStat, MAIN_STAT_PER_LEVEL);
      player.maxHp = this.getEffectiveStatsFor(player).vitality * VITALITY_TO_HP;
      player.hp = player.maxHp;
    }
  }

  private computePlayerDamage(player: Player, baseDamage: number): number {
    const effective = this.getEffectiveStatsFor(player);
    const statBonus = Math.floor((effective.strength + effective.dexterity + effective.intellect) * DAMAGE_STAT_FACTOR);
    let damage = baseDamage + statBonus;
    if (Math.random() < critChanceFromLuck(effective.luck)) {
      damage = Math.round(damage * CRIT_MULTIPLIER);
    }
    return damage;
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

      const damage = this.computePlayerDamage(player, spell.damage);

      if (spell.projectileSpeed) {
        this.spawnProjectile(player.x, player.z, "player", pending.targetId, damage, spell.projectileSpeed, sessionId);
      } else {
        this.applySpellDamage(target, damage, pending.targetId, sessionId);
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
      this.spawnProjectile(enemy.x, enemy.z, "enemy", pending.targetSessionId, stats.damage, stats.projectileSpeed, "");
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
          this.damagePlayer(projectile.targetId, player, projectile.damage);
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

  private damagePlayer(sessionId: string, player: Player, amount: number) {
    const effective = this.getEffectiveStatsFor(player);
    const mitigated = Math.max(1, amount - effective.armor);
    player.hp = Math.max(0, player.hp - mitigated);
    if (player.hp === 0) {
      this.respawnPlayer(sessionId, player);
    }
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
