import { beforeAll, describe, expect, it } from "vitest";
import {
  ContentSnapshot,
  PLAYER_COLLISION_RADIUS,
  decodeItemToken,
  encodeItemToken,
  getActiveBuffBonus,
  getEffectiveStats,
  hasRankedDependents,
  isTalentUnlocked,
  loadGameContent,
  professionXpForNextLevel,
  resolveFurnitureCollisions,
  resolveStructureCollisions,
  xpForNextLevel,
} from "./types.js";

describe("encodeItemToken / decodeItemToken", () => {
  it("round-trips itemId and rarity", () => {
    const token = encodeItemToken("rusty_sword", "rare");
    expect(token).toBe("rusty_sword@rare");
    expect(decodeItemToken(token)).toEqual({ itemId: "rusty_sword", rarity: "rare" });
  });

  it("falls back to common rarity for a bare legacy id with no @rarity suffix", () => {
    expect(decodeItemToken("oak_log")).toEqual({ itemId: "oak_log", rarity: "common" });
  });

  it("falls back to common rarity for an unrecognized rarity suffix", () => {
    expect(decodeItemToken("sword@legendary")).toEqual({ itemId: "sword", rarity: "common" });
  });
});

describe("xpForNextLevel / professionXpForNextLevel", () => {
  it("scales linearly with level and is always positive", () => {
    expect(xpForNextLevel(1)).toBeGreaterThan(0);
    expect(xpForNextLevel(5)).toBeGreaterThan(xpForNextLevel(1));
    expect(xpForNextLevel(10)).toBe(xpForNextLevel(5) * 2);
  });

  it("profession XP curve also scales linearly", () => {
    expect(professionXpForNextLevel(2)).toBe(professionXpForNextLevel(1) * 2);
  });
});

describe("getActiveBuffBonus", () => {
  const now = 1000;

  it("ignores expired buffs", () => {
    const bonus = getActiveBuffBonus([["battleFury", now - 1]], now);
    expect(bonus.damagePercent).toBeUndefined();
  });

  it("sums bonuses from multiple still-active buffs", () => {
    // battleFury: +20% damage, arcaneSurge: +25% damage - both still active.
    const bonus = getActiveBuffBonus(
      [
        ["battleFury", now + 1000],
        ["arcaneSurge", now + 1000],
      ],
      now,
    );
    expect(bonus.damagePercent).toBe(45);
  });

  it("ignores an unrecognized buff kind instead of throwing", () => {
    const bonus = getActiveBuffBonus([["not_a_real_buff", now + 1000]], now);
    expect(bonus).toEqual({});
  });
});

// getEffectiveStats/isTalentUnlocked/hasRankedDependents read the mutable ITEMS/TALENTS
// registries loadGameContent() populates - it's a pure function of a plain snapshot object
// (no DB/network involved), so a small hand-built fixture exercises them for real.
describe("content-backed functions", () => {
  const fixture: ContentSnapshot = {
    classes: [{ id: "warrior", name: "Warrior", mainStat: "strength", role: "tank" }],
    spells: [],
    items: [
      {
        id: "test_sword",
        name: "Test Sword",
        category: "equipment",
        slot: "weapon",
        bonuses: { mainStat: 10, armor: 2 },
        icon: "🗡️",
        description: "",
        basePrice: 10,
      },
    ],
    talents: [
      { id: "root_talent", classId: "warrior", name: "Root", description: "", maxRank: 1, effect: { kind: "statBonus", stat: "damagePercent", perRank: 5 }, tier: 1, column: 0 },
      { id: "child_talent", classId: "warrior", name: "Child", description: "", maxRank: 1, effect: { kind: "statBonus", stat: "damagePercent", perRank: 5 }, tier: 2, column: 0, prerequisiteTalentId: "root_talent" },
    ],
    enemyTypes: [],
    npcs: [],
    quests: [],
    maps: [{ id: "overworld", name: "Overworld", kind: "overworld", halfExtent: 34, isActive: true }],
    dungeons: [],
    spawns: [],
    spawnZones: [],
    structures: [{ id: "wall1", name: "Wall", mapId: "overworld", kind: "wall", x: 0, z: 0, rotationY: 0, width: 2, depth: 2, height: 2, color: "#888", yOffset: 0 }],
    waypoints: [],
    respawnPoints: [],
    furniture: [{ id: "hill1", name: "Hill", mapId: "overworld", kind: "hill", x: 10, z: 10, rotationY: 0, color: "#000", yOffset: 0 }],
    hexTiles: [],
    recipes: [],
    gatheringNodeTypes: [],
    gatheringNodes: [],
  };

  beforeAll(() => {
    loadGameContent(fixture);
  });

  describe("getEffectiveStats", () => {
    it("adds equipped item bonuses on top of base stats, scaled by rarity", () => {
      const base = { mainStat: 5, vitality: 5, luck: 5, armor: 5 };
      const equipped = { weapon: encodeItemToken("test_sword", "common") } as Parameters<typeof getEffectiveStats>[1];
      const total = getEffectiveStats(base, equipped);
      expect(total.mainStat).toBe(15); // 5 base + 10 common-rarity bonus
      expect(total.armor).toBe(7); // 5 base + 2
    });

    it("scales the bonus by rarity multiplier (epic = x2)", () => {
      const base = { mainStat: 5, vitality: 5, luck: 5, armor: 5 };
      const equipped = { weapon: encodeItemToken("test_sword", "epic") } as Parameters<typeof getEffectiveStats>[1];
      const total = getEffectiveStats(base, equipped);
      expect(total.mainStat).toBe(25); // 5 base + (10 * 2) epic bonus
    });

    it("ignores an empty equip slot", () => {
      const base = { mainStat: 5, vitality: 5, luck: 5, armor: 5 };
      const equipped = { weapon: "" } as Parameters<typeof getEffectiveStats>[1];
      expect(getEffectiveStats(base, equipped)).toEqual(base);
    });
  });

  describe("isTalentUnlocked / hasRankedDependents", () => {
    it("a talent with no prerequisite is always unlocked", () => {
      expect(isTalentUnlocked("root_talent", [])).toBe(true);
    });

    it("a talent with an unmet prerequisite is locked", () => {
      expect(isTalentUnlocked("child_talent", [])).toBe(false);
    });

    it("a talent becomes unlocked once its prerequisite has a rank spent", () => {
      expect(isTalentUnlocked("child_talent", [["root_talent", 1]])).toBe(true);
    });

    it("refunding a talent's last point is blocked while a dependent still has ranks spent", () => {
      expect(hasRankedDependents("root_talent", [["child_talent", 1]])).toBe(true);
      expect(hasRankedDependents("root_talent", [["child_talent", 0]])).toBe(false);
    });
  });

  describe("resolveStructureCollisions", () => {
    it("pushes a position that's crept past a blocking structure's edge back out", () => {
      // wall1 sits at (0,0), 2x2 (half-extent 1) - approaching from outside and just
      // crossing the edge (as a moving player legitimately would) should get shoved back past
      // edge + PLAYER_COLLISION_RADIUS. (Landing dead-center, as no real movement ever would,
      // has no defined push direction - resolveStructureCollisions intentionally skips it.)
      const resolved = resolveStructureCollisions(1.2, 0, fixture.structures);
      expect(resolved.x).toBeGreaterThanOrEqual(1 + PLAYER_COLLISION_RADIUS - 1e-9);
    });

    it("leaves a position far from any structure unchanged", () => {
      const resolved = resolveStructureCollisions(50, 50, fixture.structures);
      expect(resolved).toEqual({ x: 50, z: 50 });
    });
  });

  describe("resolveFurnitureCollisions", () => {
    it("pushes a position that's crept past a blocking furniture footprint (hill) back out", () => {
      // hill1 sits at (10,10), halfWidth 1.842 - edge at x=11.842.
      const resolved = resolveFurnitureCollisions(12.0, 10, fixture.furniture);
      expect(resolved.x).toBeGreaterThan(12.0);
    });

    it("leaves a position far from any furniture unchanged", () => {
      const resolved = resolveFurnitureCollisions(-50, -50, fixture.furniture);
      expect(resolved).toEqual({ x: -50, z: -50 });
    });
  });
});
