import { z } from "zod";
import { prisma } from "../../db/client.js";
import { createCrudRouter } from "../../http/createCrudRouter.js";

const talentSchema = z.object({
  id: z.string().min(1).max(64),
  class_id: z.string().min(1).max(32),
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(255),
  max_rank: z.number().int().positive(),
  effect_key: z.enum(["damagePercent", "critChanceBonus", "cooldownPercent", "armorBonus", "maxHpPercent"]),
  per_rank: z.number(),
});
const updateSchema = talentSchema.omit({ id: true }).partial();

// No checkDeletable - Character.talent_ranks is a JSON map keyed by talent id; a stale entry
// for a deleted talent is silently ignored by getTalentBonus (same graceful-orphan pattern as
// items), not a crash risk.
export const talentsRouter = createCrudRouter(prisma.talent, { createSchema: talentSchema, updateSchema });
