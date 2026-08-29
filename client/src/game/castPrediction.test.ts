import { SPELLS } from "@mmo/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createCastPredictor } from "./castPrediction";

const INSTANT_SPELL = "testInstantSpell";
const CAST_TIME_SPELL = "testCastTimeSpell";

beforeEach(() => {
  SPELLS[INSTANT_SPELL] = {
    id: INSTANT_SPELL,
    classId: "warrior",
    name: "Test Instant Spell",
    description: "",
    effectType: "damage",
    targetType: "enemy",
    amount: 1,
    cooldownMs: 5000,
    castTimeMs: 0,
    range: 10,
  };
  SPELLS[CAST_TIME_SPELL] = {
    id: CAST_TIME_SPELL,
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

describe("activeCastsFor", () => {
  it("has nothing active before any cast is pushed", () => {
    const predictor = createCastPredictor();
    expect(predictor.activeCastsFor(INSTANT_SPELL, 0)).toEqual([]);
  });

  it("counts a pushed cast as active until its cooldownMs elapses", () => {
    const predictor = createCastPredictor();
    predictor.pushCast(INSTANT_SPELL, 1000);

    expect(predictor.activeCastsFor(INSTANT_SPELL, 1000)).toEqual([1000]);
    expect(predictor.activeCastsFor(INSTANT_SPELL, 1000 + SPELLS[INSTANT_SPELL].cooldownMs - 1)).toEqual([1000]);
    expect(predictor.activeCastsFor(INSTANT_SPELL, 1000 + SPELLS[INSTANT_SPELL].cooldownMs)).toEqual([]);
  });

  it("tracks each spell's cooldown independently", () => {
    const predictor = createCastPredictor();
    predictor.pushCast(INSTANT_SPELL, 1000);
    expect(predictor.activeCastsFor(CAST_TIME_SPELL, 1000)).toEqual([]);
  });
});

describe("maxChargesFor", () => {
  it("returns 1 with no classId", () => {
    const predictor = createCastPredictor();
    expect(predictor.maxChargesFor(INSTANT_SPELL, null, new Map())).toBe(1);
  });

  it("returns 1 with no talentRanks (e.g. player schema not loaded yet)", () => {
    const predictor = createCastPredictor();
    expect(predictor.maxChargesFor(INSTANT_SPELL, "warrior", undefined)).toBe(1);
  });

  it("returns 1 with an empty talentRanks map and no extraCharges talent invested", () => {
    const predictor = createCastPredictor();
    expect(predictor.maxChargesFor(INSTANT_SPELL, "warrior", new Map())).toBe(1);
  });
});

describe("pushCast", () => {
  it("does not create a pending cast for an instant (castTimeMs === 0) spell", () => {
    const predictor = createCastPredictor();
    predictor.pushCast(INSTANT_SPELL, 1000);
    // With nothing pending, cancelPendingCooldown must be a no-op - the cooldown entry stays.
    predictor.cancelPendingCooldown(1000);
    expect(predictor.activeCastsFor(INSTANT_SPELL, 1000)).toEqual([1000]);
  });

  it("still records the optimistic cooldown entry for an instant spell", () => {
    const predictor = createCastPredictor();
    predictor.pushCast(INSTANT_SPELL, 1000);
    expect(predictor.activeCastsFor(INSTANT_SPELL, 1000)).toEqual([1000]);
  });
});

describe("cancelPendingCooldown", () => {
  it("removes the optimistic cooldown entry when cancelled before the cast fires", () => {
    const predictor = createCastPredictor();
    predictor.pushCast(CAST_TIME_SPELL, 1000);
    expect(predictor.activeCastsFor(CAST_TIME_SPELL, 1000)).toEqual([1000]);

    predictor.cancelPendingCooldown(1500); // still within castTimeMs (1000ms) of 1000
    expect(predictor.activeCastsFor(CAST_TIME_SPELL, 1500)).toEqual([]);
  });

  it("is a no-op once the cast's castTimeMs has already elapsed", () => {
    const predictor = createCastPredictor();
    predictor.pushCast(CAST_TIME_SPELL, 1000);

    predictor.cancelPendingCooldown(1000 + SPELLS[CAST_TIME_SPELL].castTimeMs); // exactly fired
    expect(predictor.activeCastsFor(CAST_TIME_SPELL, 1000 + SPELLS[CAST_TIME_SPELL].castTimeMs)).toEqual([1000]);
  });

  it("a second cancel call after pending was already cleared is a safe no-op", () => {
    const predictor = createCastPredictor();
    predictor.pushCast(CAST_TIME_SPELL, 1000);
    predictor.cancelPendingCooldown(1200); // clears the pending cast, removes the 1000 entry
    expect(predictor.activeCastsFor(CAST_TIME_SPELL, 1200)).toEqual([]);

    predictor.cancelPendingCooldown(1200); // nothing pending anymore - must not throw or affect state
    expect(predictor.activeCastsFor(CAST_TIME_SPELL, 1200)).toEqual([]);
  });
});
