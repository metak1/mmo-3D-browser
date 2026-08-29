import { Client } from "@colyseus/core";
import { MapSchema } from "@colyseus/schema";
import { MOUNT_SPEED_MULTIPLIER, PLAYER_SPEED, SPELLS } from "@mmo/shared";
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
      effectType: "heal",
      targetType: "self",
      amount: 1,
      cooldownMs: 5000,
      castTimeMs: 1000,
      range: 10,
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
