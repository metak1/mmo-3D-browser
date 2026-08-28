import { z } from "zod";
import { countWhere } from "../../db/client.js";
import { createCrudRouter } from "../../http/createCrudRouter.js";
import { effectDefSchema } from "./effectSchemas.js";

const equipSlotSchema = z.enum([
  "weapon",
  "offHand",
  "head",
  "neck",
  "shoulders",
  "armor",
  "hands",
  "waist",
  "legs",
  "feet",
  "ring",
  "trinket",
]);

const itemObjectSchema = z.object({
  id: z.string().min(1).max(32),
  name: z.string().min(1).max(64),
  category: z.enum(["equipment", "material"]).default("equipment"),
  slot: equipSlotSchema.nullable().optional(), // required for "equipment" - checked below, since a discriminated union would force re-shaping every existing admin caller
  bonuses: z.record(z.string(), z.number()).default({}),
  icon: z.string().min(1).max(16),
  description: z.string().min(1).max(255),
  base_price: z.number().int().nonnegative(),
  use_effects: z.array(effectDefSchema).nullable().optional(), // only meaningful for "material"
});
const itemSchema = itemObjectSchema.refine((item) => item.category !== "equipment" || !!item.slot, {
  message: "slot is required for category \"equipment\"",
  path: ["slot"],
});
const updateSchema = itemObjectSchema.omit({ id: true }).partial();

export const itemsRouter = createCrudRouter("items", {
  createSchema: itemSchema,
  updateSchema,
  jsonColumns: ["bonuses", "use_effects"],
  checkDeletable: async (id) => {
    // character_items.item_id stores "itemId@rarity" tokens (or a bare legacy id) - see
    // encodeItemToken/decodeItemToken in shared/src/types.ts.
    const [itemCount, questCount, recipeCount, nodeTypeCount] = await Promise.all([
      countWhere("character_items", "item_id = $1 OR item_id LIKE $2", [id, `${id}@%`]),
      countWhere("quests", "reward_item_id = $1", [id]),
      countWhere("recipes", "output_item_id = $1", [id]),
      countWhere("gathering_node_types", "output_item_id = $1", [id]),
    ]);
    if (itemCount > 0) return `${itemCount} character item row(s) reference this item`;
    if (questCount > 0) return `${questCount} quest(s) reward this item - reassign or delete them first`;
    if (recipeCount > 0) return `${recipeCount} recipe(s) output this item - reassign or delete them first`;
    if (nodeTypeCount > 0) return `${nodeTypeCount} gathering node type(s) output this item - reassign or delete them first`;
    return null;
  },
});
