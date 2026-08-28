import { boot, ColyseusTestServer } from "@colyseus/testing";
import {
  ActionFailedMessage,
  BuyItemMessage,
  LearnProfessionMessage,
  SwapInventorySlotsMessage,
  WORLD_ROOM_NAME,
} from "@mmo/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import appConfig from "../app.config.js";
import { reloadGameContent } from "../db/content.js";
import { pool } from "../db/client.js";
import { cleanupTestUser, createTestUserAndCharacter, TestAccount } from "../../test/setup.js";

// Real WorldRoom, real dev Postgres (same DATABASE_URL the dev server uses - already migrated
// and holds realistic seeded content). Each test creates its own throwaway user/character and
// deletes it afterward - see test/setup.ts's own doc comment for why this reuses the dev DB
// rather than provisioning a separate one.
//
// Content this suite depends on already being seeded (from this project's earlier development,
// not created by this test file): the "alchemist_trainer" NPC (Herbalist Wren) at (0,-2),
// teaching "alchemist" - within NPC_INTERACT_RADIUS of the fixed (0,0,0) spawn point every new
// character joins at, so its proximity gate is reachable without simulating movement. The
// "merchant" NPC sits far enough from spawn (~6.7 units) that its own gate is exercised from
// the *rejected* side instead, for the same reason.

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

describe("toggle_mount", () => {
  it("rejects with no_mount when the character hasn't earned one", async () => {
    const account = await testAccount();
    const room = await colyseus.createRoom(WORLD_ROOM_NAME, {});
    const client = await colyseus.connectTo(room, { token: account.token, characterId: account.characterId });

    client.send("toggle_mount");
    const failure: ActionFailedMessage = await client.waitForMessage("action_failed");

    expect(failure.reason).toBe("no_mount");
    expect(room.state.players.get(client.sessionId)?.mounted).toBe(false);
  });

  it("toggles mounted on once the character has hasMount", async () => {
    const account = await testAccount();
    await pool.query("UPDATE characters SET has_mount = true WHERE id = $1", [account.characterId]);

    const room = await colyseus.createRoom(WORLD_ROOM_NAME, {});
    const client = await colyseus.connectTo(room, { token: account.token, characterId: account.characterId });

    client.send("toggle_mount");
    await room.waitForMessage("toggle_mount");

    expect(room.state.players.get(client.sessionId)?.mounted).toBe(true);
  });
});

describe("learn_profession", () => {
  it("grants the profession when standing near a trainer who teaches it", async () => {
    const account = await testAccount();
    const room = await colyseus.createRoom(WORLD_ROOM_NAME, {});
    const client = await colyseus.connectTo(room, { token: account.token, characterId: account.characterId });

    const message: LearnProfessionMessage = { professionId: "alchemist", npcId: "alchemist_trainer" };
    client.send("learn_profession", message);
    await room.waitForMessage("learn_profession");

    const player = room.state.players.get(client.sessionId);
    expect(player?.professionXp.has("alchemist")).toBe(true);
    expect(player?.professionLevel.get("alchemist")).toBe(1);
  });

  it("rejects a profession the targeted trainer doesn't teach, regardless of distance", async () => {
    const account = await testAccount();
    const room = await colyseus.createRoom(WORLD_ROOM_NAME, {});
    const client = await colyseus.connectTo(room, { token: account.token, characterId: account.characterId });

    // alchemist_trainer only teaches alchemist - asking for miner here should fail the
    // capability check before distance is even considered.
    const message: LearnProfessionMessage = { professionId: "miner", npcId: "alchemist_trainer" };
    client.send("learn_profession", message);
    const failure: ActionFailedMessage = await client.waitForMessage("action_failed");

    expect(failure.reason).toBe("not_available");
    expect(room.state.players.get(client.sessionId)?.professionXp.has("miner")).toBe(false);
  });
});

describe("buy_item", () => {
  it("rejects buying from a vendor too far from the player's position", async () => {
    const account = await testAccount();
    const room = await colyseus.createRoom(WORLD_ROOM_NAME, {});
    const client = await colyseus.connectTo(room, { token: account.token, characterId: account.characterId });

    // "merchant" sits ~6.7 units from the fixed (0,0,0) spawn point every character joins at -
    // well outside NPC_INTERACT_RADIUS.
    const message: BuyItemMessage = { npcId: "merchant", itemId: "rusty_sword" };
    client.send("buy_item", message);
    const failure: ActionFailedMessage = await client.waitForMessage("action_failed");

    expect(failure.reason).toBe("too_far");
    expect(room.state.players.get(client.sessionId)?.inventory.length).toBe(0);
  });
});

describe("swap_inventory_slots", () => {
  it("actually swaps the two slots' tokens, not just applies some change", async () => {
    const account = await testAccount();
    await pool.query(
      "INSERT INTO character_items (character_id, item_id, slot) VALUES ($1, 'rusty_sword@common', NULL), ($1, 'leather_vest@common', NULL)",
      [account.characterId],
    );

    const room = await colyseus.createRoom(WORLD_ROOM_NAME, {});
    const client = await colyseus.connectTo(room, { token: account.token, characterId: account.characterId });

    const before = [...(room.state.players.get(client.sessionId)?.inventory ?? [])];
    expect(before).toHaveLength(2);

    const message: SwapInventorySlotsMessage = { fromIndex: 0, toIndex: 1 };
    client.send("swap_inventory_slots", message);
    await room.waitForMessage("swap_inventory_slots");

    const after = [...(room.state.players.get(client.sessionId)?.inventory ?? [])];
    expect(after).toEqual([before[1], before[0]]);
  });
});
