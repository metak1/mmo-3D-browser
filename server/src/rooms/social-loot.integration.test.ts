import { boot, ColyseusTestServer } from "@colyseus/testing";
import { ActionFailedMessage, DUNGEON_ROOM_NAME, GuildCreateMessage, LootTakeMessage, WORLD_ROOM_NAME } from "@mmo/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import appConfig from "../app.config.js";
import { reloadGameContent } from "../db/content.js";
import * as guildsDb from "../db/guilds.js";
import { cleanupTestUser, createTestUserAndCharacter, TestAccount } from "../../test/setup.js";
import { LootBag } from "./schema/WorldState.js";

// Covers the shared modules extracted from WorldRoom/DungeonRoom's former duplicated code
// (loot.ts, social.ts, persistQueue.ts) through both real room types, since the whole point of
// that extraction was "one body, exercised by both rooms" - see the plan for the full context.

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  await reloadGameContent();
  colyseus = await boot(appConfig);
});

afterAll(async () => {
  await colyseus.shutdown();
});

const accounts: TestAccount[] = [];
async function testAccount(): Promise<TestAccount> {
  const account = await createTestUserAndCharacter();
  accounts.push(account);
  return account;
}

afterEach(async () => {
  await colyseus.cleanup();
  for (const account of accounts.splice(0)) {
    await cleanupTestUser(account.userId);
  }
});

// Every character joins both room types at (0,0,0) - placing the bag there sidesteps needing to
// simulate movement/combat RNG just to get a real drop into range.
function bagAt(itemId: string): LootBag {
  const bag = new LootBag();
  bag.x = 0;
  bag.z = 0;
  bag.items.push(itemId);
  return bag;
}

for (const [roomName, label] of [
  [WORLD_ROOM_NAME, "WorldRoom"],
  [DUNGEON_ROOM_NAME, "DungeonRoom"],
] as const) {
  describe(`${label} loot_take (via LootManager)`, () => {
    it("moves the item into inventory and clears the bag when it's the last item", async () => {
      const account = await testAccount();
      const room = await colyseus.createRoom(roomName, {});
      const client = await colyseus.connectTo(room, { token: account.token, characterId: account.characterId });

      room.state.lootBags.set("test-bag", bagAt("rusty_sword@common"));

      const message: LootTakeMessage = { bagId: "test-bag", itemId: "rusty_sword@common" };
      client.send("loot_take", message);
      await room.waitForMessage("loot_take");

      const player = room.state.players.get(client.sessionId);
      expect(player?.inventory.includes("rusty_sword@common")).toBe(true);
      expect(room.state.lootBags.has("test-bag")).toBe(false);
    });

    it("rejects too_far without touching the bag or inventory", async () => {
      const account = await testAccount();
      const room = await colyseus.createRoom(roomName, {});
      const client = await colyseus.connectTo(room, { token: account.token, characterId: account.characterId });

      const farBag = bagAt("rusty_sword@common");
      farBag.x = 9999;
      room.state.lootBags.set("test-bag", farBag);

      const message: LootTakeMessage = { bagId: "test-bag", itemId: "rusty_sword@common" };
      client.send("loot_take", message);
      const failure: ActionFailedMessage = await client.waitForMessage("action_failed");

      expect(failure.reason).toBe("too_far");
      expect(room.state.players.get(client.sessionId)?.inventory.length).toBe(0);
      expect(room.state.lootBags.has("test-bag")).toBe(true);
    });
  });

  describe(`${label} guild_leave/guild_roster_request (via social.ts)`, () => {
    it("removes the sole leader and deletes the now-empty guild", async () => {
      const account = await testAccount();
      const guild = await guildsDb.createGuild(`TestGuild_${account.characterId}`, account.characterId);

      const room = await colyseus.createRoom(roomName, {});
      const client = await colyseus.connectTo(room, { token: account.token, characterId: account.characterId });

      // onJoin hydrates guild membership from the DB - confirms the pre-existing guild is visible
      // before exercising the actual code under test.
      expect(room.state.players.get(client.sessionId)?.guildId).toBe(guild.id);

      client.send("guild_leave");
      await room.waitForMessage("guild_leave");

      const player = room.state.players.get(client.sessionId);
      expect(player?.guildId).toBe(0);
      expect(await guildsDb.getGuildForCharacter(account.characterId)).toBeNull();
    });

    it("guild_roster_request on a guildless character sends nothing and doesn't error", async () => {
      const account = await testAccount();
      const room = await colyseus.createRoom(roomName, {});
      const client = await colyseus.connectTo(room, { token: account.token, characterId: account.characterId });

      client.send("guild_roster_request");
      await room.waitForMessage("guild_roster_request");
      // No assertion beyond "didn't throw" - handleGuildRosterRequest's own early-return path
      // (player.guildId === 0) is exactly what's being exercised here.
    });
  });
}

describe("guild_create (WorldRoom only)", () => {
  it("still works end-to-end through the real message pipeline, unaffected by the refactor", async () => {
    const account = await testAccount();
    const room = await colyseus.createRoom(WORLD_ROOM_NAME, {});
    const client = await colyseus.connectTo(room, { token: account.token, characterId: account.characterId });

    const message: GuildCreateMessage = { name: `CreateTest_${account.characterId}` };
    client.send("guild_create", message);
    await room.waitForMessage("guild_create");

    const player = room.state.players.get(client.sessionId);
    expect(player?.guildId).toBeGreaterThan(0);
    expect(player?.guildRole).toBe("leader");

    // Self-cleaning: leaving a solo-member guild deletes it (same path the guild_leave describe
    // block above verifies), so no guildsDb.deleteGuild cleanup call is needed here.
    client.send("guild_leave");
    await room.waitForMessage("guild_leave");
  });
});
