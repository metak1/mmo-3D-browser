import { z } from "zod";
import { prisma } from "../../db/client.js";
import { createCrudRouter } from "../../http/createCrudRouter.js";

const itemSchema = z.object({
  id: z.string().min(1).max(32),
  name: z.string().min(1).max(64),
  slot: z.enum(["weapon", "armor", "trinket"]),
  bonuses: z.record(z.string(), z.number()).default({}),
  icon: z.string().min(1).max(16),
  description: z.string().min(1).max(255),
  base_price: z.number().int().nonnegative(),
});
const updateSchema = itemSchema.omit({ id: true }).partial();

export const itemsRouter = createCrudRouter(prisma.item, {
  createSchema: itemSchema,
  updateSchema,
  checkDeletable: async (id) => {
    // character_items.item_id stores "itemId@rarity" tokens (or a bare legacy id) - see
    // encodeItemToken/decodeItemToken in shared/src/types.ts.
    const [itemCount, questCount] = await Promise.all([
      prisma.characterItem.count({ where: { OR: [{ item_id: id }, { item_id: { startsWith: `${id}@` } }] } }),
      prisma.quest.count({ where: { reward_item_id: id } }),
    ]);
    if (itemCount > 0) return `${itemCount} character item row(s) reference this item`;
    if (questCount > 0) return `${questCount} quest(s) reward this item - reassign or delete them first`;
    return null;
  },
});
