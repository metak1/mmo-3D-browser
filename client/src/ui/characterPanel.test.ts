import { ENEMY_TYPES } from "@mmo/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { hpColor, isAggressiveEnemyType, typeColor } from "./characterPanel";

describe("hpColor", () => {
  it("is green above 50%", () => {
    expect(hpColor(0.51)).toBe("#4fd166");
    expect(hpColor(1)).toBe("#4fd166");
  });

  it("is yellow between 25% and 50%", () => {
    expect(hpColor(0.5)).toBe("#e0b23c");
    expect(hpColor(0.26)).toBe("#e0b23c");
  });

  it("is red at or below 25%", () => {
    expect(hpColor(0.25)).toBe("#e0503c");
    expect(hpColor(0)).toBe("#e0503c");
  });
});

describe("typeColor", () => {
  it("is red for an aggressive type, yellow for a passive one", () => {
    expect(typeColor(true)).toBe("#e0503c");
    expect(typeColor(false)).toBe("#e0b23c");
  });
});

describe("isAggressiveEnemyType", () => {
  beforeEach(() => {
    ENEMY_TYPES["test_aggressive"] = {
      id: "test_aggressive",
      name: "Test Aggressive",
      behavior: "melee",
      xpReward: 1,
      goldReward: 1,
      stats: { maxHp: 10, damage: 1, range: 1, intervalMs: 1000, aggroRange: 5 },
    };
    ENEMY_TYPES["test_passive"] = {
      id: "test_passive",
      name: "Test Passive",
      behavior: "melee",
      xpReward: 1,
      goldReward: 1,
      stats: { maxHp: 10, damage: 1, range: 1, intervalMs: 1000 },
    };
  });

  it("is true when the type's stats have a truthy aggroRange", () => {
    expect(isAggressiveEnemyType("test_aggressive")).toBe(true);
  });

  it("is false when aggroRange is unset", () => {
    expect(isAggressiveEnemyType("test_passive")).toBe(false);
  });

  it("is false for an enemy type id that doesn't exist", () => {
    expect(isAggressiveEnemyType("does_not_exist")).toBe(false);
  });
});
