import { boot, ColyseusTestServer } from "@colyseus/testing";
import { DUNGEON_ROOM_NAME } from "@mmo/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import appConfig from "../app.config.js";
import { reloadGameContent } from "../db/content.js";

// A DungeonRoom used to read all its content off a singleton ACTIVE_DUNGEON global, so any two
// instances were indistinguishable and would render identically off whatever dungeon happened to
// be "active" - the whole point of scoping it to an onCreate-provided dungeonId (see
// DungeonRoom.onCreate) is that two concurrently-running instances for two different dungeons
// never bleed into each other. These tests cover exactly that regression, against the two
// dungeons server/scripts/seed.ts actually seeds (ashen_ruins: 9 spawns, frostbound_hollow: 3).

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  await reloadGameContent();
  colyseus = await boot(appConfig);
});

afterAll(async () => {
  await colyseus.shutdown();
});

afterEach(async () => {
  await colyseus.cleanup();
});

describe("DungeonRoom dungeonId scoping", () => {
  it("seeds each instance's own dungeon's spawns, not a shared/bleeding-together list", async () => {
    const ashenRuins = await colyseus.createRoom(DUNGEON_ROOM_NAME, { dungeonId: "ashen_ruins" });
    const frostboundHollow = await colyseus.createRoom(DUNGEON_ROOM_NAME, { dungeonId: "frostbound_hollow" });

    expect(ashenRuins.state.enemies.size).toBe(9);
    expect(frostboundHollow.state.enemies.size).toBe(3);
  });

  it("fails room creation for an unknown dungeonId", async () => {
    await expect(colyseus.createRoom(DUNGEON_ROOM_NAME, { dungeonId: "not_a_real_dungeon" })).rejects.toThrow();
  });
});
