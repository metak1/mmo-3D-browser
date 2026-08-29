import { Client } from "@colyseus/core";
import { MapSchema } from "@colyseus/schema";
import {
  encodeItemToken,
  INVENTORY_SIZE,
  ITEM_IDS,
  ITEMS,
  LOOT_BAG_AGGREGATE_RADIUS,
  LOOT_BAG_DESPAWN_MS,
  LOOT_DROP_CHANCE,
  LOOT_PICKUP_RADIUS,
  LootTakeMessage,
  rollRarity,
} from "@mmo/shared";
import { LootBag, Player } from "./schema/WorldState.js";
import { rejectAction } from "./roomUtil.js";

export interface LootCapableRoom {
  state: { players: MapSchema<Player>; lootBags: MapSchema<LootBag> };
  clock: { setTimeout(callback: () => void, delayMs: number): unknown };
  persistItems(sessionId: string): void | Promise<void>;
}

// Shared by WorldRoom and DungeonRoom (both bodies were byte-for-byte identical) - same
// constructor-injection shape as TradeManager (trade.ts), which takes a similarly small
// structural interface of whatever it needs from the owning room.
export class LootManager {
  private lootBagSeq = 0;

  constructor(private room: LootCapableRoom) {}

  maybeDropLoot(x: number, z: number, guaranteed: boolean) {
    if (!guaranteed && Math.random() >= LOOT_DROP_CHANCE) return;
    // Materials (category "material") are excluded on purpose - they carry no rarity and belong
    // in Player.materials, not an equip-token inventory slot (see ItemDef.category's own doc
    // comment). They only ever enter play through gathering nodes/crafting, never a kill drop.
    const equipmentItemIds = ITEM_IDS.filter((id) => ITEMS[id]?.category === "equipment");
    const itemId = equipmentItemIds[Math.floor(Math.random() * equipmentItemIds.length)];
    this.dropLoot(x, z, encodeItemToken(itemId, rollRarity()));
  }

  dropLoot(x: number, z: number, itemId: string) {
    for (const bag of this.room.state.lootBags.values()) {
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
    this.room.state.lootBags.set(id, bag);
    this.room.clock.setTimeout(() => this.room.state.lootBags.delete(id), LOOT_BAG_DESPAWN_MS);
  }

  handleLootTake(client: Client, message: LootTakeMessage) {
    const player = this.room.state.players.get(client.sessionId);
    const bag = this.room.state.lootBags.get(message.bagId);
    if (!player || !bag) return;

    const dist = Math.hypot(player.x - bag.x, player.z - bag.z);
    if (dist > LOOT_PICKUP_RADIUS) return rejectAction(client, "too_far");

    const index = bag.items.indexOf(message.itemId);
    if (index === -1) return rejectAction(client, "not_available");
    if (player.inventory.length >= INVENTORY_SIZE) return rejectAction(client, "inventory_full");

    bag.items.splice(index, 1);
    player.inventory.push(message.itemId);

    if (bag.items.length === 0) {
      this.room.state.lootBags.delete(message.bagId);
    }

    this.room.persistItems(client.sessionId);
  }
}
