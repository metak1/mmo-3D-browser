import { z } from "zod";
import { prisma } from "../../db/client.js";
import { createCrudRouter } from "../../http/createCrudRouter.js";

// Mirrors shared/src/types.ts's TalentStatKey/BuffKind/TalentEffect - kept in sync by hand since
// this route validates the raw JSON before it ever reaches shared code.
const talentStatKey = z.enum(["damagePercent", "critChanceBonus", "cooldownPercent", "armorBonus", "maxHpPercent"]);
const buffKind = z.enum(["battleFury", "shadowStep", "huntersFocus", "divineFavor", "arcaneSurge"]);

const talentEffectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("statBonus"), stat: talentStatKey, perRank: z.number() }),
  z.object({ kind: z.literal("spellStatBonus"), spellId: z.string().min(1), stat: talentStatKey, perRank: z.number() }),
  z.object({ kind: z.literal("extraCharges"), spellId: z.string().min(1), perRank: z.number() }),
  z.object({ kind: z.literal("onCastBuff"), spellId: z.string().min(1), buffId: buffKind }),
]);

const talentSchema = z.object({
  id: z.string().min(1).max(64),
  class_id: z.string().min(1).max(32),
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(255),
  max_rank: z.number().int().positive(),
  effect: talentEffectSchema,
  tier: z.number().int().positive(),
  column_index: z.number().int().nonnegative(),
  prerequisite_talent_id: z.string().min(1).max(64).nullable().optional(),
});
const updateSchema = talentSchema.omit({ id: true }).partial();

// No checkDeletable - Character.talent_ranks is a JSON map keyed by talent id; a stale entry
// for a deleted talent is silently ignored by getTalentBonus (same graceful-orphan pattern as
// items), not a crash risk.
export const talentsRouter = createCrudRouter(prisma.talent, { createSchema: talentSchema, updateSchema });
