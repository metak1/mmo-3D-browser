import { z } from "zod";
import { createCrudRouter } from "../../http/createCrudRouter.js";

const ingredientSchema = z.object({ itemId: z.string().min(1), quantity: z.number().int().positive() });

const recipeSchema = z.object({
  id: z.string().min(1).max(64),
  profession: z.enum(["alchemist", "cook", "blacksmith", "tailor", "jeweler"]), // must be a CRAFTING_PROFESSIONS member
  name: z.string().min(1).max(64),
  required_level: z.number().int().nonnegative(),
  ingredients: z.array(ingredientSchema).min(1),
  output_item_id: z.string().min(1).max(32),
  output_quantity: z.number().int().positive(),
  xp_award: z.number().int().nonnegative(),
});
const updateSchema = recipeSchema.omit({ id: true }).partial();

// No checkDeletable - nothing else references a recipe by id (characters don't "know" recipes
// individually, every recipe belonging to a learned profession is simply available, same as spells).
export const recipesRouter = createCrudRouter("recipes", {
  createSchema: recipeSchema,
  updateSchema,
  jsonColumns: ["ingredients"],
});
