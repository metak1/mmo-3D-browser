import { Room, Client } from "@colyseus/core";
import {
  AILMENTS,
  AcceptQuestMessage,
  AilmentKind,
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
  INTERRUPT_LOCKOUT_MS,
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
  NPCS,
  NPC_INTERACT_RADIUS,
  PARTY_MAX_SIZE,
  PARTY_XP_SHARE_RADIUS,
  PLAYER_SPEED,
  PROJECTILE_HIT_RADIUS,
  PROJECTILE_MAX_LIFETIME_MS,
  PartyInviteMessage,
  PartyRespondMessage,
  PlayerStats,
  QUESTS,
  SPELLS,
  SpellDef,
  SpellId,
  SpendTalentMessage,
  TALENTS,
  TALENT_POINTS_PER_LEVEL,
  TalentBonus,
  TurnInQuestMessage,
  UnequipMessage,
  VITALITY_PER_LEVEL,
  VITALITY_TO_HP,
  XP_PER_ENEMY_KIND,
  critChanceFromLuck,
  decodeItemToken,
  encodeItemToken,
  getEffectiveStats,
  getTalentBonus,
  rollRarity,
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

const SPAWN_POINTS: EnemySpawnPoint[] = [
  { id: "melee-1", kind: "melee", x: 8, z: 8 },
  { id: "melee-2", kind: "melee", x: -8, z: 8 },
  { id: "caster-1", kind: "caster", x: 8, z: -8 },
  { id: "caster-2", kind: "caster", x: -8, z: -8 },
];

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

export class WorldRoom extends Room<WorldState> {
  private lastInput = new Map<string, PlayerInput>();
  private lastCastAt = new Map<string, number>(); // key: `${sessionId}:${spellId}`
  private lastMeleeAttackAt = new Map<string, number>(); // key: enemyId
  private lastCasterAttackAt = new Map<string, number>(); // key: enemyId
  private pendingPlayerCast = new Map<string, PendingPlayerCast>(); // key: sessionId
  private pendingEnemyCast = new Map<string, PendingEnemyCast>(); // key: enemyId
  private interruptLockoutUntil = new Map<string, number>(); // key: sessionId or enemyId
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
    this.onMessage("spend_talent", (client, message: SpendTalentMessage) => this.handleSpendTalent(client, message));
    this.onMessage("accept_quest", (client, message: AcceptQuestMessage) => this.handleAcceptQuest(client, message));
    this.onMessage("turn_in_quest", (client, message: TurnInQuestMessage) => this.handleTurnInQuest(client, message));
    this.onMessage("party_invite", (client, message: PartyInviteMessage) => this.handlePartyInvite(client, message));
    this.onMessage("party_respond", (client, message: PartyRespondMessage) => this.handlePartyRespond(client, message));
    this.onMessage("party_leave", (client) => this.handlePartyLeave(client));

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
    player.name = character.name;
    player.classId = classId;
    player.level = character.level;
    player.xp = character.xp;
    player.mainStat = character.main_stat;
    player.vitality = character.vitality;
    player.luck = character.luck;
    player.armor = character.armor;
    player.talentPoints = character.talent_points;
    const savedRanks = (character.talent_ranks as Record<string, number>) ?? {};
    for (const [talentId, rank] of Object.entries(savedRanks)) {
      player.talentRanks.set(talentId, rank);
    }
    const savedQuestProgress = (character.quest_progress as Record<string, number>) ?? {};
    for (const [questId, count] of Object.entries(savedQuestProgress)) {
      player.questProgress.set(questId, count);
    }
    const savedQuestCompleted = (character.quest_completed as Record<string, number>) ?? {};
    for (const [questId, completedAt] of Object.entries(savedQuestCompleted)) {
      player.questCompleted.set(questId, completedAt);
    }

    const items = await listCharacterItems(character.id);
    for (const row of items) {
      if (row.slot === "weapon") player.equippedWeapon = row.item_id;
      else if (row.slot === "armor") player.equippedArmor = row.item_id;
      else if (row.slot === "trinket") player.equippedTrinket = row.item_id;
      else player.inventory.push(row.item_id);
    }

    this.recomputeMaxHp(player);
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

  private getEffectiveStatsFor(player: Player): PlayerStats {
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

  private getTalentBonusFor(player: Player): TalentBonus {
    return getTalentBonus(this.resolveClassId(player.classId), player.talentRanks);
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
    const maxHpPercent = this.getTalentBonusFor(player).maxHpPercent;
    const baseMaxHp = this.getEffectiveStatsFor(player).vitality * VITALITY_TO_HP;
    player.maxHp = Math.round(baseMaxHp * (1 + maxHpPercent / 100));
    player.hp = Math.min(player.hp, player.maxHp);
  }

  async onLeave(client: Client) {
    await this.saveCharacter(client.sessionId);

    const leavingPlayer = this.state.players.get(client.sessionId);
    if (leavingPlayer) this.removeFromParty(leavingPlayer);

    this.cancelPlayerCast(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.lastInput.delete(client.sessionId);
    this.characterIdBySession.delete(client.sessionId);
    this.interruptLockoutUntil.delete(client.sessionId);
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
          mainStat: player.mainStat,
          vitality: player.vitality,
          luck: player.luck,
          armor: player.armor,
        },
        talentPoints: player.talentPoints,
        talentRanks: Object.fromEntries(player.talentRanks),
        questProgress: Object.fromEntries(player.questProgress),
        questCompleted: Object.fromEntries(player.questCompleted),
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
    if (player.castSpellId !== "") return; // already casting
    if ((this.interruptLockoutUntil.get(client.sessionId) ?? 0) > Date.now()) return;

    const spell = SPELLS[message.spellId];
    if (!spell || spell.classId !== this.resolveClassId(player.classId)) return;

    const cooldownKey = `${client.sessionId}:${message.spellId}`;
    const now = Date.now();
    const lastCast = this.lastCastAt.get(cooldownKey) ?? 0;
    const cooldownPercent = this.getTalentBonusFor(player).cooldownPercent;
    const effectiveCooldownMs = Math.max(100, spell.cooldownMs * (1 - cooldownPercent / 100));
    if (now - lastCast < effectiveCooldownMs) return;

    const target = this.resolveCastTarget(player, client.sessionId, spell, message);
    if (!target) return;

    const impact = this.resolveImpactPoint(player, target);
    if (!impact) return;

    const dist = Math.hypot(player.x - impact.x, player.z - impact.z);
    if (dist > spell.range + RANGE_BUFFER) return;

    this.lastCastAt.set(cooldownKey, now);

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
    if (spell.interruptsCast || spell.effectType === "interrupt") {
      this.tryInterrupt(target);
    }

    if (spell.effectType === "damage") {
      if (spell.aoeRadius) {
        const impact = this.resolveImpactPoint(caster, target);
        if (!impact) return;
        forEachAlive(this.state.enemies, impact.x, impact.z, spell.aoeRadius, (enemy, enemyId) => {
          const damage = this.computePlayerDamage(caster, spell.amount ?? 0);
          this.applySpellDamage(enemy, damage, enemyId, casterSessionId);
        });
      } else if (target.kind === "enemy") {
        const enemy = this.state.enemies.get(target.id);
        if (enemy && enemy.hp > 0) {
          const damage = this.computePlayerDamage(caster, spell.amount ?? 0);
          this.applySpellDamage(enemy, damage, target.id, casterSessionId);
        }
      }
    } else if (spell.effectType === "heal") {
      if (spell.aoeRadius) {
        const impact = this.resolveImpactPoint(caster, target);
        if (!impact) return;
        forEachAlive(this.state.players, impact.x, impact.z, spell.aoeRadius, (ally) => {
          this.healPlayer(caster, ally, spell.amount ?? 0);
        });
      } else {
        const ally = this.resolveAllyUnit(caster, target);
        if (ally) this.healPlayer(caster, ally, spell.amount ?? 0);
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

  private applySpellDamage(target: Enemy, damage: number, targetId: string, killerSessionId: string) {
    const kind = target.kind as EnemyKind;
    target.hp = Math.max(0, target.hp - damage);
    if (target.hp === 0) {
      const deathX = target.x;
      const deathZ = target.z;
      this.killEnemy(targetId);
      this.grantKillRewards(killerSessionId, kind, deathX, deathZ);
      this.maybeDropLoot(deathX, deathZ);
    }
  }

  // Every party member within PARTY_XP_SHARE_RADIUS of the kill (and alive) gets the same
  // XP/quest credit the killer would get solo - not a split pool, just shared credit for
  // being nearby. Degrades to exactly the old single-killer behavior when partyId is empty.
  private grantKillRewards(killerSessionId: string, kind: EnemyKind, x: number, z: number) {
    const killer = this.state.players.get(killerSessionId);
    if (!killer) return;

    for (const player of this.partyMembersNear(killer, x, z)) {
      this.grantXp(player, XP_PER_ENEMY_KIND[kind]);
      this.progressQuestKills(player, kind);
    }
  }

  private countPartyMembers(partyId: string): number {
    let count = 0;
    for (const player of this.state.players.values()) {
      if (player.partyId === partyId) count++;
    }
    return count;
  }

  private partyMembersNear(player: Player, x: number, z: number): Player[] {
    const result: Player[] = [player];
    if (!player.partyId) return result;

    for (const other of this.state.players.values()) {
      if (other === player) continue;
      if (other.partyId !== player.partyId) continue;
      if (other.hp <= 0) continue;
      if (Math.hypot(other.x - x, other.z - z) > PARTY_XP_SHARE_RADIUS) continue;
      result.push(other);
    }
    return result;
  }

  // Clears partyId; if exactly one member of that party remains afterward, clears theirs
  // too - a "party" of 1 isn't a party. Called from party_leave and from onLeave.
  private removeFromParty(player: Player) {
    const partyId = player.partyId;
    if (!partyId) return;
    player.partyId = "";

    const remaining = [...this.state.players.values()].filter((p) => p.partyId === partyId);
    if (remaining.length === 1) remaining[0].partyId = "";
  }

  private handlePartyInvite(client: Client, message: PartyInviteMessage) {
    const inviter = this.state.players.get(client.sessionId);
    const target = this.state.players.get(message.targetSessionId);
    if (!inviter || !target || target === inviter) return;
    if (inviter.partyId && inviter.partyId === target.partyId) return; // already grouped together
    // Refuse to bridge two already-established (different) parties - merging would require
    // re-keying every existing member of one side, which this simple model doesn't support.
    if (inviter.partyId && target.partyId && inviter.partyId !== target.partyId) return;

    const existingPartyId = inviter.partyId || target.partyId;
    if (existingPartyId && this.countPartyMembers(existingPartyId) >= PARTY_MAX_SIZE) return;

    target.pendingPartyInviteFrom = client.sessionId;
  }

  private handlePartyRespond(client: Client, message: PartyRespondMessage) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const inviterSessionId = player.pendingPartyInviteFrom;
    if (!inviterSessionId) return;
    player.pendingPartyInviteFrom = "";
    if (!message.accept) return;

    const inviter = this.state.players.get(inviterSessionId);
    if (!inviter) return; // inviter disconnected between inviting and being accepted
    if (inviter.partyId && player.partyId && inviter.partyId !== player.partyId) return; // see handlePartyInvite

    // Whichever side already has a party anchors the merge - the inviter usually does, but
    // e.g. a solo player inviting someone who's already grouped must join THEIR party, not
    // overwrite it with a fresh one anchored on the inviter.
    const partyId = inviter.partyId || player.partyId || inviterSessionId;
    if (this.countPartyMembers(partyId) >= PARTY_MAX_SIZE) return;

    inviter.partyId = partyId;
    player.partyId = partyId;
  }

  private handlePartyLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    this.removeFromParty(player);
  }

  private maybeDropLoot(x: number, z: number) {
    if (Math.random() >= LOOT_DROP_CHANCE) return;
    const itemId = ITEM_IDS[Math.floor(Math.random() * ITEM_IDS.length)];
    this.dropLoot(x, z, encodeItemToken(itemId, rollRarity()));
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

    const item = ITEMS[decodeItemToken(message.itemId).itemId];
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

  private handleSpendTalent(client: Client, message: SpendTalentMessage) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (player.talentPoints <= 0) return;

    const def = TALENTS[message.talentId];
    if (!def || def.classId !== this.resolveClassId(player.classId)) return;

    const currentRank = player.talentRanks.get(def.id) ?? 0;
    if (currentRank >= def.maxRank) return;

    player.talentRanks.set(def.id, currentRank + 1);
    player.talentPoints -= 1;
    this.recomputeMaxHp(player);
  }

  private isNearNpc(player: Player, npcId: string): boolean {
    const npc = NPCS[npcId];
    if (!npc) return false;
    return Math.hypot(player.x - npc.x, player.z - npc.z) <= NPC_INTERACT_RADIUS;
  }

  private handleAcceptQuest(client: Client, message: AcceptQuestMessage) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const quest = QUESTS[message.questId];
    if (!quest) return;
    if (player.questProgress.has(quest.id) || player.questCompleted.has(quest.id)) return;
    if (!this.isNearNpc(player, quest.giverNpcId)) return;

    player.questProgress.set(quest.id, 0);
  }

  private handleTurnInQuest(client: Client, message: TurnInQuestMessage) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const quest = QUESTS[message.questId];
    if (!quest) return;

    const progress = player.questProgress.get(quest.id);
    if (progress === undefined || progress < quest.objectiveCount) return;
    if (!this.isNearNpc(player, quest.giverNpcId)) return;
    if (quest.rewardItemId && player.inventory.length >= INVENTORY_SIZE) return;

    player.questProgress.delete(quest.id);
    player.questCompleted.set(quest.id, Date.now());
    this.grantXp(player, quest.rewardXp);

    if (quest.rewardItemId) {
      player.inventory.push(encodeItemToken(quest.rewardItemId, "common"));
      this.persistItems(client.sessionId);
    }
  }

  // Called alongside grantXp from applySpellDamage's kill branch - the single hook point
  // that already covers instant, AoE, and projectile-resolved enemy kills.
  private progressQuestKills(player: Player, enemyKind: EnemyKind) {
    for (const quest of Object.values(QUESTS)) {
      if (quest.objectiveEnemyKind !== enemyKind) continue;
      const progress = player.questProgress.get(quest.id);
      if (progress === undefined || progress >= quest.objectiveCount) continue;
      player.questProgress.set(quest.id, progress + 1);
    }
  }

  private grantXp(player: Player, amount: number) {
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

  private computePlayerDamage(player: Player, baseDamage: number): number {
    const effective = this.getEffectiveStatsFor(player);
    const talentBonus = this.getTalentBonusFor(player);
    const ailmentMultiplier = this.getAilmentDamageMultiplier(player);
    const statBonus = Math.floor(effective.mainStat * DAMAGE_STAT_FACTOR);
    let damage = (baseDamage + statBonus) * (1 + talentBonus.damagePercent / 100) * ailmentMultiplier;
    const critChance = Math.min(1, critChanceFromLuck(effective.luck) + talentBonus.critChanceBonus / 100);
    if (Math.random() < critChance) {
      damage = damage * CRIT_MULTIPLIER;
    }
    return Math.round(damage);
  }

  // Healing reuses the talent system's damagePercent bucket as a general "spell power"
  // multiplier rather than introducing a separate heal-only talent effect, since no talent
  // in the current roster distinguishes the two - simplest thing that could work.
  private computePlayerHeal(player: Player, baseAmount: number): number {
    const effective = this.getEffectiveStatsFor(player);
    const talentBonus = this.getTalentBonusFor(player);
    const statBonus = Math.floor(effective.mainStat * DAMAGE_STAT_FACTOR);
    const heal = (baseAmount + statBonus) * (1 + talentBonus.damagePercent / 100);
    return Math.round(heal);
  }

  private healPlayer(caster: Player, target: Player, baseAmount: number) {
    const heal = this.computePlayerHeal(caster, baseAmount);
    target.hp = Math.min(target.maxHp, target.hp + heal);
  }

  private applyAilment(player: Player, kind: AilmentKind, durationMs: number) {
    player.ailments.set(kind, Date.now() + durationMs);
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

  private killEnemy(enemyId: string) {
    this.state.enemies.delete(enemyId);
    this.lastMeleeAttackAt.delete(enemyId);
    this.lastCasterAttackAt.delete(enemyId);
    this.pendingEnemyCast.delete(enemyId);
    this.interruptLockoutUntil.delete(enemyId);

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
    player.ailments.clear();
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
      if (player) player.castSpellId = "";
      if (!player || player.hp <= 0) continue;

      const spell = SPELLS[pending.spellId];
      if (!spell) continue;

      // Re-validate the target is still resolvable - it may have died, disconnected, or
      // (for ground casts) simply still be a valid point - before applying the effect.
      const impact = this.resolveImpactPoint(player, pending.target);
      if (!impact) continue; // target gone, cast fizzles

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
        if ((this.interruptLockoutUntil.get(enemyId) ?? 0) > now) continue; // recently interrupted

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
          if (player.hp > 0) this.applyAilment(player, "weaken", AILMENTS.weaken.durationMs);
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
    const armorBonus = this.getTalentBonusFor(player).armorBonus;
    const mitigated = Math.max(1, amount - (effective.armor + armorBonus));
    player.hp = Math.max(0, player.hp - mitigated);
    if (player.hp === 0) {
      this.respawnPlayer(sessionId, player);
    }
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
