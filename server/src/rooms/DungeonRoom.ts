import { Room, Client } from "@colyseus/core";
import {
  CastMessage,
  ENEMY_STATS,
  EnemyKind,
  INVENTORY_SIZE,
  InputMessage,
  LOOT_BAG_AGGREGATE_RADIUS,
  LOOT_BAG_DESPAWN_MS,
  LOOT_DROP_CHANCE,
  LOOT_PICKUP_RADIUS,
  LootTakeMessage,
  ITEM_IDS,
  XP_PER_ENEMY_KIND,
  decodeItemToken,
  encodeItemToken,
  resolveClassId,
  rollRarity,
} from "@mmo/shared";
import { verifyToken } from "../auth/jwt.js";
import { getCharacterForUser, saveCharacterProgress } from "../db/characters.js";
import { listCharacterItems, replaceCharacterItems } from "../db/items.js";
import { CombatEngine } from "./combat/CombatEngine.js";
import { DungeonState, Enemy, LootBag, Player } from "./schema/DungeonState.js";

const SIMULATION_INTERVAL_MS = 1000 / 30;
const ENCOUNTER_CHECK_INTERVAL_MS = 1000;
const ENCOUNTER_GAP_MS = 3000; // pause between one cleared encounter and the next spawning
const BOSS_MAX_HP = 350; // a "mini" version of the overworld boss's 500 - same attack patterns
const BOSS_GUARANTEED_DROPS = 3;

interface EncounterEnemySpec {
  id: string;
  kind: EnemyKind;
  x: number;
  z: number;
}

// All three encounters sit at the same spot - this is a small sequential-wave instance,
// not a spatial dungeon crawl, so there's nothing to walk between.
const ENCOUNTERS: EncounterEnemySpec[][] = [
  [
    { id: "pack1-a", kind: "melee", x: -1.5, z: 8 },
    { id: "pack1-b", kind: "melee", x: 1.5, z: 8 },
  ],
  [
    { id: "pack2-a", kind: "melee", x: -1.5, z: 8 },
    { id: "pack2-b", kind: "caster", x: 1.5, z: 8 },
  ],
  [{ id: "dungeon-boss", kind: "boss", x: 0, z: 8 }],
];

export class DungeonRoom extends Room<DungeonState> {
  private combat!: CombatEngine;
  private characterIdBySession = new Map<string, number>();
  private currentEncounterEnemyIds = new Set<string>();
  private lootBagSeq = 0;

  onCreate() {
    this.setState(new DungeonState());

    this.combat = new CombatEngine({
      state: this.state,
      onEnemyKilled: (enemyId, kind, killerSessionId, x, z) => this.handleEnemyKilled(enemyId, kind, killerSessionId, x, z),
      onPlayerRespawn: (sessionId, player) => this.handlePlayerRespawn(sessionId, player),
    });

    this.spawnEncounter(0);

    this.onMessage("input", (client, message: InputMessage) => this.combat.handleInput(client.sessionId, message));
    this.onMessage("cast", (client, message: CastMessage) => this.combat.handleCast(client, message));
    this.onMessage("loot_take", (client, message: LootTakeMessage) => this.handleLootTake(client, message));

    this.setSimulationInterval(() => this.combat.tick(SIMULATION_INTERVAL_MS / 1000), SIMULATION_INTERVAL_MS);
    this.clock.setInterval(() => this.checkEncounterProgress(), ENCOUNTER_CHECK_INTERVAL_MS);
  }

  async onJoin(client: Client, options?: { token?: string; characterId?: number; partyId?: string }) {
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

    const player = new Player();
    player.x = 0;
    player.y = 0;
    player.z = 0;
    player.name = character.name;
    // Carried over from the WorldRoom party that started this instance (see
    // WorldRoom.handleDungeonStart) - without this every dungeon Player defaults to the
    // schema's "" partyId, which reads client-side as "not grouped" and hides the party UI
    // the moment players arrive, even though they're the same party that queued together.
    player.partyId = options.partyId ?? "";
    player.classId = resolveClassId(character.class_id);
    player.level = character.level;
    player.xp = character.xp;
    player.mainStat = character.main_stat;
    player.vitality = character.vitality;
    player.luck = character.luck;
    player.armor = character.armor;
    player.talentPoints = character.talent_points;
    // Talent ranks matter for combat formulas (getTalentBonusFor) even though talents
    // aren't spendable mid-dungeon, so they're loaded read-only here.
    const savedRanks = (character.talent_ranks as Record<string, number>) ?? {};
    for (const [talentId, rank] of Object.entries(savedRanks)) {
      player.talentRanks.set(talentId, rank);
    }

    const items = await listCharacterItems(character.id);
    for (const row of items) {
      if (row.slot === "weapon") player.equippedWeapon = row.item_id;
      else if (row.slot === "armor") player.equippedArmor = row.item_id;
      else if (row.slot === "trinket") player.equippedTrinket = row.item_id;
      else player.inventory.push(row.item_id);
    }

    this.combat.recomputeMaxHp(player);
    player.hp = player.maxHp;

    this.state.players.set(client.sessionId, player);
    this.characterIdBySession.set(client.sessionId, character.id);
    console.log(`[DungeonRoom] ${client.sessionId} joined as ${character.name}`);
  }

  async onLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    const characterId = this.characterIdBySession.get(client.sessionId);
    if (player && characterId) {
      try {
        await saveCharacterProgress(characterId, {
          level: player.level,
          xp: player.xp,
          stats: { mainStat: player.mainStat, vitality: player.vitality, luck: player.luck, armor: player.armor },
          talentPoints: player.talentPoints,
          talentRanks: Object.fromEntries(player.talentRanks),
          questProgress: {},
          questCompleted: {},
        });
      } catch (err) {
        console.error(`[DungeonRoom] failed to save character ${characterId}:`, err);
      }
    }

    this.combat.clearSessionTracking(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.characterIdBySession.delete(client.sessionId);
  }

  private spawnEncounter(index: number) {
    const encounter = ENCOUNTERS[index];
    this.currentEncounterEnemyIds.clear();
    for (const spec of encounter) {
      const enemy = new Enemy();
      enemy.kind = spec.kind;
      enemy.x = spec.x;
      enemy.z = spec.z;
      const maxHp = spec.kind === "boss" ? BOSS_MAX_HP : ENEMY_STATS[spec.kind].maxHp;
      enemy.hp = maxHp;
      enemy.maxHp = maxHp;
      this.state.enemies.set(spec.id, enemy);
      this.currentEncounterEnemyIds.add(spec.id);
    }
  }

  private checkEncounterProgress() {
    if (this.state.cleared) return;
    if (this.currentEncounterEnemyIds.size === 0) return; // waiting on the gap timer already

    const allDead = [...this.currentEncounterEnemyIds].every((id) => !this.state.enemies.has(id));
    if (!allDead) return;

    this.currentEncounterEnemyIds.clear(); // stop this check from re-firing during the gap
    const nextIndex = this.state.encounterIndex + 1;
    if (nextIndex >= ENCOUNTERS.length) return; // that was the boss - handleEnemyKilled already set cleared

    this.clock.setTimeout(() => {
      this.state.encounterIndex = nextIndex;
      this.spawnEncounter(nextIndex);
    }, ENCOUNTER_GAP_MS);
  }

  // CombatEngine hook: called once an enemy's hp hits 0 (already removed from state by then).
  private handleEnemyKilled(_enemyId: string, kind: EnemyKind, _killerSessionId: string, x: number, z: number) {
    for (const player of this.state.players.values()) {
      this.combat.grantXp(player, XP_PER_ENEMY_KIND[kind]);
    }

    if (kind === "boss") {
      for (let i = 0; i < BOSS_GUARANTEED_DROPS; i++) this.maybeDropLoot(x, z, true);
      this.state.cleared = true;
    } else {
      this.maybeDropLoot(x, z, false);
    }
  }

  // CombatEngine hook: called after a dead player's hp/ailments/cast have already been reset.
  private handlePlayerRespawn(_sessionId: string, player: Player) {
    player.x = 0;
    player.y = 0;
    player.z = 0;
  }

  private maybeDropLoot(x: number, z: number, guaranteed: boolean) {
    if (!guaranteed && Math.random() >= LOOT_DROP_CHANCE) return;
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
      console.error(`[DungeonRoom] failed to persist items for character ${characterId}:`, err);
    }
  }
}
