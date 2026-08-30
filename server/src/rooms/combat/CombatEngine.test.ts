import { Client } from "@colyseus/core";
import { MapSchema } from "@colyseus/schema";
import { BUFFS, MOUNT_SPEED_MULTIPLIER, PLAYER_SPEED, SPELLS, TALENTS } from "@mmo/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Enemy, Player, Projectile } from "../schema/WorldState.js";
import { CombatEngine, CombatState } from "./CombatEngine.js";

function makeClient(sessionId: string): Client {
  return { sessionId, send: vi.fn() } as unknown as Client;
}

// CombatEngine is a standalone class - it takes a plain {state, callbacks} config and has zero
// Colyseus-server/network imports (no `this.clock`/`this.send`/Room base class), so it's testable
// by constructing it directly with real schema instances, no room/network mocking needed.
function makeEngine() {
  const state: CombatState = {
    players: new MapSchema<Player>(),
    enemies: new MapSchema<Enemy>(),
    projectiles: new MapSchema<Projectile>(),
  };
  const onEnemyKilled = vi.fn();
  const onPlayerRespawn = vi.fn();
  const onCombatText = vi.fn();
  const engine = new CombatEngine({ state, onEnemyKilled, onPlayerRespawn, onCombatText });
  return { engine, state, onEnemyKilled, onPlayerRespawn, onCombatText };
}

function makePlayer(overrides: Partial<Player> = {}): Player {
  const player = new Player();
  player.hp = 100;
  player.maxHp = 100;
  Object.assign(player, overrides);
  return player;
}

function makeEnemy(overrides: Partial<Enemy> = {}): Enemy {
  const enemy = new Enemy();
  enemy.hp = 50;
  enemy.maxHp = 50;
  Object.assign(enemy, overrides);
  return enemy;
}

describe("CombatEngine.damagePlayer", () => {
  it("mitigates damage by the player's effective armor, flooring at 1", () => {
    const { engine, onCombatText } = makeEngine();
    const player = makePlayer({ armor: 5 });
    engine.damagePlayer("s1", player, 10);
    expect(player.hp).toBe(95); // 10 - 5 armor = 5 mitigated damage
    expect(onCombatText).toHaveBeenCalledWith(expect.objectContaining({ amount: 5, kind: "damage" }));
  });

  it("never mitigates below 1 damage even against overwhelming armor", () => {
    const { engine } = makeEngine();
    const player = makePlayer({ armor: 1000 });
    engine.damagePlayer("s1", player, 5);
    expect(player.hp).toBe(99);
  });

  it("dismounts the player on any hit", () => {
    const { engine } = makeEngine();
    const player = makePlayer({ armor: 0, mounted: true });
    engine.damagePlayer("s1", player, 1);
    expect(player.mounted).toBe(false);
  });

  it("respawns the player once hp reaches 0, clearing ailments/buffs and resetting hp", () => {
    const { engine, onPlayerRespawn } = makeEngine();
    const player = makePlayer({ hp: 3, armor: 0 });
    player.ailments.set("poison", Date.now() + 5000);
    player.buffs.set("battleFury", Date.now() + 5000);

    engine.damagePlayer("s1", player, 100);

    expect(player.hp).toBe(player.maxHp);
    expect(player.ailments.size).toBe(0);
    expect(player.buffs.size).toBe(0);
    expect(onPlayerRespawn).toHaveBeenCalledWith("s1", player);
  });
});

describe("CombatEngine movement / mount speed", () => {
  let engine: CombatEngine;
  let state: CombatState;
  let player: Player;

  beforeEach(() => {
    ({ engine, state } = makeEngine());
    player = makePlayer({ x: 0, z: 0 });
    state.players.set("s1", player);
  });

  it("moves a player at PLAYER_SPEED * dt while dismounted", () => {
    engine.handleInput("s1", { moveX: 1, moveZ: 0, seq: 1 });
    engine.tick(1);
    expect(player.x).toBeCloseTo(PLAYER_SPEED, 5);
  });

  it("moves a mounted player MOUNT_SPEED_MULTIPLIER times faster", () => {
    player.mounted = true;
    engine.handleInput("s1", { moveX: 1, moveZ: 0, seq: 1 });
    engine.tick(1);
    expect(player.x).toBeCloseTo(PLAYER_SPEED * MOUNT_SPEED_MULTIPLIER, 5);
  });

  it("does not move a player with no input", () => {
    engine.tick(1);
    expect(player.x).toBe(0);
    expect(player.z).toBe(0);
  });
});

describe("CombatEngine cast cancellation via movement", () => {
  const spellId = "testCastTimeSpell";

  beforeEach(() => {
    SPELLS[spellId] = {
      id: spellId,
      classId: "warrior",
      name: "Test Cast-Time Spell",
      description: "",
      targetType: "self",
      cooldownMs: 5000,
      castTimeMs: 1000,
      range: 10,
      effects: [{ shape: { kind: "singleTarget" }, actions: [{ kind: "heal", amount: 1 }] }],
    };
  });

  it("cancels the pending cast and clears castSpellId when the player moves mid-cast", () => {
    const { engine, state } = makeEngine();
    const player = makePlayer({ classId: "warrior" });
    state.players.set("s1", player);

    engine.handleCast(makeClient("s1"), { spellId });
    expect(player.castSpellId).toBe(spellId);

    engine.handleInput("s1", { moveX: 1, moveZ: 0, seq: 1 });
    expect(player.castSpellId).toBe("");
  });

  it("does not consume the cooldown when movement cancels the cast (unlike a completed cast)", () => {
    const { engine, state } = makeEngine();
    const player = makePlayer({ classId: "warrior" });
    state.players.set("s1", player);
    const client = makeClient("s1");

    engine.handleCast(client, { spellId });
    engine.handleInput("s1", { moveX: 1, moveZ: 0, seq: 1 }); // cancels before it ever fires

    // Recasting immediately must succeed - if the cooldown had wrongly been consumed, this
    // second handleCast would instead reject with "on_cooldown" and leave castSpellId empty.
    engine.handleCast(client, { spellId });
    expect(player.castSpellId).toBe(spellId);
    expect(client.send).not.toHaveBeenCalledWith("cast_failed", expect.objectContaining({ reason: "on_cooldown" }));
  });

  it("still consumes the cooldown when a cast completes normally (no movement)", () => {
    // tickPlayerCasts fires pending casts off a real Date.now() deadline (not tick()'s own dt
    // argument), so advancing wall-clock time here needs fake timers rather than a bigger dt.
    vi.useFakeTimers();
    try {
      const { engine, state } = makeEngine();
      const player = makePlayer({ classId: "warrior" });
      state.players.set("s1", player);
      const client = makeClient("s1");

      engine.handleCast(client, { spellId });
      vi.advanceTimersByTime(SPELLS[spellId].castTimeMs + 50);
      engine.tick(0.05); // tickPlayerCasts resolves the now-elapsed pending cast

      engine.handleCast(client, { spellId });
      expect(client.send).toHaveBeenCalledWith("cast_failed", expect.objectContaining({ reason: "on_cooldown" }));
    } finally {
      vi.useRealTimers();
    }
  });
});

// Player spells were migrated off an older flat-field resolver onto the same composable
// {shape, actions[]} system boss abilities use (see SpellDef.effects) - these cover the
// castSpellEffects path that replaced it, including two behaviors the migration had to
// specifically preserve: combining damage+interrupt in one cast, and onCastBuff talents (which
// used to be applied inside the deleted resolver and would have silently stopped firing if that
// call hadn't been carried over into castSpellEffects).
describe("CombatEngine player spells via the composable effect system", () => {
  it("resolves a single-target damage spell through effects[]", () => {
    const spellId = "testDamageSpell";
    SPELLS[spellId] = {
      id: spellId,
      classId: "warrior",
      name: "Test Damage Spell",
      description: "",
      targetType: "enemy",
      cooldownMs: 1000,
      castTimeMs: 0,
      range: 10,
      effects: [{ shape: { kind: "singleTarget" }, actions: [{ kind: "damage", amount: 12 }] }],
    };

    const { engine, state } = makeEngine();
    const player = makePlayer({ classId: "warrior" });
    const enemy = makeEnemy();
    state.players.set("s1", player);
    state.enemies.set("e1", enemy);

    engine.handleCast(makeClient("s1"), { spellId, targetId: "e1" });
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
  });

  it("combining damage + interrupt in one effect both damages the target and cancels its pending cast", () => {
    const spellId = "testInterruptComboSpell";
    SPELLS[spellId] = {
      id: spellId,
      classId: "warrior",
      name: "Test Interrupt Combo Spell",
      description: "",
      targetType: "enemy",
      cooldownMs: 1000,
      castTimeMs: 0,
      range: 10,
      effects: [{ shape: { kind: "singleTarget" }, actions: [{ kind: "damage", amount: 6 }, { kind: "interrupt" }] }],
    };

    const { engine, state } = makeEngine();
    const player = makePlayer({ classId: "warrior" });
    const enemy = makeEnemy();
    state.players.set("s1", player);
    state.enemies.set("e1", enemy);
    // Fakes "this enemy is mid-windup on a cast" - pendingEnemyCast has no public setter (only
    // reached in practice via the enemy AI's own tick), so this pokes the same private field
    // tickPendingEnemyCasts itself reads, matching PendingEnemyCast's real shape.
    (engine as unknown as { pendingEnemyCast: Map<string, unknown> }).pendingEnemyCast.set("e1", {
      targetSessionId: "s1",
      fireAt: Date.now() + 10000,
    });

    engine.handleCast(makeClient("s1"), { spellId, targetId: "e1" });

    expect(enemy.hp).toBeLessThan(enemy.maxHp);
    expect((engine as unknown as { pendingEnemyCast: Map<string, unknown> }).pendingEnemyCast.has("e1")).toBe(false);
  });

  it("still grants an onCastBuff talent's buff, now via castSpellEffects instead of the deleted resolveSpellEffect", () => {
    const spellId = "testOnCastBuffSpell";
    SPELLS[spellId] = {
      id: spellId,
      classId: "warrior",
      name: "Test OnCastBuff Spell",
      description: "",
      targetType: "self",
      cooldownMs: 1000,
      castTimeMs: 0,
      range: 10,
      effects: [{ shape: { kind: "singleTarget" }, actions: [{ kind: "heal", amount: 1 }] }],
    };
    TALENTS["test_talent"] = {
      id: "test_talent",
      classId: "warrior",
      name: "Test Talent",
      description: "",
      maxRank: 1,
      effects: [{ kind: "onCastBuff", spellId, buffId: "battleFury" }],
      tier: 1,
      column: 0,
    };
    BUFFS["battleFury"] = { name: "Test Buff", durationMs: 5000 };

    const { engine, state } = makeEngine();
    const player = makePlayer({ classId: "warrior" });
    player.talentRanks.set("test_talent", 1);
    state.players.set("s1", player);

    engine.handleCast(makeClient("s1"), { spellId });
    expect(player.buffs.has("battleFury")).toBe(true);
  });
});

// A talent node can now carry multiple TalentEffect entries (see TalentDef.effects), including a
// new "onCastEffect" kind resolving a full composable EffectDef against the triggering spell's own
// already-resolved target/impact, and a new "resetCooldown" EffectAction primitive it can reach for.
describe("CombatEngine talents' onCastEffect", () => {
  it("resolves a DOT against the same enemy the triggering cast hit", () => {
    const spellId = "testOnCastEffectDotSpell";
    SPELLS[spellId] = {
      id: spellId,
      classId: "warrior",
      name: "Test OnCastEffect Dot Spell",
      description: "",
      targetType: "enemy",
      cooldownMs: 1000,
      castTimeMs: 0,
      range: 10,
      effects: [{ shape: { kind: "singleTarget" }, actions: [{ kind: "damage", amount: 5 }] }],
    };
    TALENTS["test_dot_talent"] = {
      id: "test_dot_talent",
      classId: "warrior",
      name: "Test Dot Talent",
      description: "",
      maxRank: 1,
      effects: [
        {
          kind: "onCastEffect",
          spellId,
          effect: { shape: { kind: "singleTarget" }, actions: [{ kind: "dot", amount: 3, tickIntervalMs: 1000, durationMs: 4000 }] },
        },
      ],
      tier: 1,
      column: 0,
    };

    const { engine, state } = makeEngine();
    const player = makePlayer({ classId: "warrior" });
    player.talentRanks.set("test_dot_talent", 1);
    const enemy = makeEnemy();
    state.players.set("s1", player);
    state.enemies.set("e1", enemy);

    engine.handleCast(makeClient("s1"), { spellId, targetId: "e1" });

    expect(enemy.dots.length).toBe(1);
    expect(enemy.dots[0].damagePerTick).toBe(3);
  });

  it("resetCooldown clears the target spell's tracked cooldown, letting it be recast immediately", () => {
    const triggerSpellId = "testResetCooldownTriggerSpell";
    const targetSpellId = "testResetCooldownTargetSpell";
    SPELLS[triggerSpellId] = {
      id: triggerSpellId,
      classId: "warrior",
      name: "Test Reset-Cooldown Trigger Spell",
      description: "",
      targetType: "self",
      cooldownMs: 1000,
      castTimeMs: 0,
      range: 10,
      effects: [{ shape: { kind: "singleTarget" }, actions: [{ kind: "heal", amount: 1 }] }],
    };
    SPELLS[targetSpellId] = {
      id: targetSpellId,
      classId: "warrior",
      name: "Test Reset-Cooldown Target Spell",
      description: "",
      targetType: "self",
      cooldownMs: 60000,
      castTimeMs: 0,
      range: 10,
      effects: [{ shape: { kind: "singleTarget" }, actions: [{ kind: "heal", amount: 1 }] }],
    };
    TALENTS["test_reset_cooldown_talent"] = {
      id: "test_reset_cooldown_talent",
      classId: "warrior",
      name: "Test Reset-Cooldown Talent",
      description: "",
      maxRank: 1,
      effects: [{ kind: "onCastEffect", spellId: triggerSpellId, effect: { shape: { kind: "singleTarget" }, actions: [{ kind: "resetCooldown", spellId: targetSpellId }] } }],
      tier: 1,
      column: 0,
    };

    const { engine, state } = makeEngine();
    const player = makePlayer({ classId: "warrior" });
    player.talentRanks.set("test_reset_cooldown_talent", 1);
    state.players.set("s1", player);
    const client = makeClient("s1");

    // Puts targetSpellId on cooldown first, independent of the talent.
    engine.handleCast(client, { spellId: targetSpellId });
    expect(client.send).not.toHaveBeenCalledWith("cast_failed", expect.objectContaining({ reason: "on_cooldown" }));

    // Casting the trigger spell should reset targetSpellId's cooldown via the talent - if it
    // hadn't, this second cast of targetSpellId would reject with "on_cooldown".
    engine.handleCast(client, { spellId: triggerSpellId });
    engine.handleCast(client, { spellId: targetSpellId });
    expect(client.send).not.toHaveBeenCalledWith("cast_failed", expect.objectContaining({ reason: "on_cooldown" }));
  });
});
