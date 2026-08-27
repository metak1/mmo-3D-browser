import { EquipSlot, EQUIP_SLOTS } from "@mmo/shared";
import { pool, withTransaction } from "./client.js";

export interface CharacterItemRow {
  id: number;
  character_id: number;
  item_id: string;
  slot: EquipSlot | null;
}

export type EquippedItemIds = Record<EquipSlot, string>;

export async function listCharacterItems(characterId: number): Promise<CharacterItemRow[]> {
  const { rows } = await pool.query<CharacterItemRow>(
    "SELECT * FROM character_items WHERE character_id = $1",
    [characterId],
  );
  return rows;
}

// Inventory is small (capped at INVENTORY_SIZE + 3 equip slots), so rather than tracking
// individual row ids through every mutation, each change just fully replaces this
// character's rows. Simple, self-healing (DB always exactly mirrors the in-memory
// Colyseus state), and cheap at this scale.
export async function replaceCharacterItems(
  characterId: number,
  inventory: string[],
  equipped: EquippedItemIds,
): Promise<void> {
  const rows: Array<{ item_id: string; slot: EquipSlot | null }> = [
    ...inventory.map((itemId) => ({ item_id: itemId, slot: null })),
    ...EQUIP_SLOTS.filter((slot) => equipped[slot]).map((slot) => ({ item_id: equipped[slot], slot })),
  ];

  await withTransaction(async (client) => {
    await client.query("DELETE FROM character_items WHERE character_id = $1", [characterId]);
    for (const row of rows) {
      await client.query(
        "INSERT INTO character_items (character_id, item_id, slot) VALUES ($1, $2, $3)",
        [characterId, row.item_id, row.slot],
      );
    }
  });
}
