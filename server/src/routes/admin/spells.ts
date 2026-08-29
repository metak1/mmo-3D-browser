import { z } from "zod";
import { createCrudRouter } from "../../http/createCrudRouter.js";
import { effectDefSchema } from "./effectSchemas.js";

const spellSchema = z.object({
  id: z.string().min(1).max(64),
  class_id: z.string().min(1).max(32),
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(255),
  target_type: z.enum(["enemy", "ally", "self", "ground"]),
  cooldown_ms: z.number().int().nonnegative(),
  cast_time_ms: z.number().int().nonnegative(),
  range: z.number().positive(),
  projectile_speed: z.number().positive().nullable().optional(),
  effects: z.array(effectDefSchema).min(1),
});
const updateSchema = spellSchema.omit({ id: true }).partial();

// No checkDeletable - nothing else references a spell by id (characters don't "learn" spells
// individually, every spell belonging to your class is simply available).
export const spellsRouter = createCrudRouter("spells", {
  createSchema: spellSchema,
  updateSchema,
  jsonColumns: ["effects"],
});
