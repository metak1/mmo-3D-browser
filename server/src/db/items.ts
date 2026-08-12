import { EquipSlot } from "@mmo/shared";
import { prisma } from "./client.js";

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
  const rows = await prisma.characterItem.findMany({ where: { character_id: characterId } });
  return rows as CharacterItemRow[];
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
    ...(equipped.weapon ? [{ item_id: equipped.weapon, slot: "weapon" as EquipSlot }] : []),
    ...(equipped.armor ? [{ item_id: equipped.armor, slot: "armor" as EquipSlot }] : []),
    ...(equipped.trinket ? [{ item_id: equipped.trinket, slot: "trinket" as EquipSlot }] : []),
  ];

  await prisma.$transaction([
    prisma.characterItem.deleteMany({ where: { character_id: characterId } }),
    ...rows.map((row) =>
      prisma.characterItem.create({
        data: { character_id: characterId, item_id: row.item_id, slot: row.slot },
      }),
    ),
  ]);
}
