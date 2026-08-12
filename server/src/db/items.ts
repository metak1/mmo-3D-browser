import { EquipSlot } from "@mmo/shared";
import { pool } from "./pool.js";

export interface CharacterItemRow {
  id: number;
  character_id: number;
  item_id: string;
  slot: EquipSlot | null;
}

export interface EquippedItemIds {
  weapon: string;
  armor: string;
  trinket: string;
}

export async function listCharacterItems(characterId: number): Promise<CharacterItemRow[]> {
  const result = await pool.query<CharacterItemRow>(`SELECT * FROM character_items WHERE character_id = $1`, [
    characterId,
  ]);
  return result.rows;
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
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM character_items WHERE character_id = $1`, [characterId]);

    const rows: Array<{ itemId: string; slot: EquipSlot | null }> = [
      ...inventory.map((itemId) => ({ itemId, slot: null })),
      ...(equipped.weapon ? [{ itemId: equipped.weapon, slot: "weapon" as EquipSlot }] : []),
      ...(equipped.armor ? [{ itemId: equipped.armor, slot: "armor" as EquipSlot }] : []),
      ...(equipped.trinket ? [{ itemId: equipped.trinket, slot: "trinket" as EquipSlot }] : []),
    ];

    for (const row of rows) {
      await client.query(`INSERT INTO character_items (character_id, item_id, slot) VALUES ($1, $2, $3)`, [
        characterId,
        row.itemId,
        row.slot,
      ]);
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
