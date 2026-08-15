import { z } from "zod";
import { prisma } from "../../db/client.js";
import { createCrudRouter } from "../../http/createCrudRouter.js";

const spellSchema = z.object({
  id: z.string().min(1).max(64),
  class_id: z.string().min(1).max(32),
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(255),
  effect_type: z.enum(["damage", "heal", "dispel", "interrupt"]),
  target_type: z.enum(["enemy", "ally", "self", "ground"]),
  amount: z.number().int().nullable().optional(),
  aoe_radius: z.number().positive().nullable().optional(),
  interrupts_cast: z.boolean().optional(),
  cooldown_ms: z.number().int().nonnegative(),
  cast_time_ms: z.number().int().nonnegative(),
  range: z.number().positive(),
  projectile_speed: z.number().positive().nullable().optional(),
});
const updateSchema = spellSchema.omit({ id: true }).partial();

// No checkDeletable - nothing else references a spell by id (characters don't "learn" spells
// individually, every spell belonging to your class is simply available).
export const spellsRouter = createCrudRouter(prisma.spell, { createSchema: spellSchema, updateSchema });
