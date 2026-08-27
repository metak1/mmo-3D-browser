import { z } from "zod";
import { createCrudRouter } from "../../http/createCrudRouter.js";

// Mirrors shared's EffectShape/EffectAction/EffectDef (see shared/src/types.ts) - kept as an
// explicit Zod schema rather than `z.any()` so a malformed admin-authored effect (typo'd kind,
// missing field) fails fast at save time instead of silently no-op'ing the first time
// CombatEngine's resolveEffect actually tries to interpret it.
const effectShapeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("singleTarget") }),
  z.object({ kind: z.literal("circle"), radius: z.number().positive(), centeredOn: z.enum(["caster", "impact"]) }),
  z.object({ kind: z.literal("cone"), radius: z.number().positive(), angleDeg: z.number().positive().max(360) }),
  z.object({ kind: z.literal("line"), length: z.number().positive(), width: z.number().positive() }),
  z.object({ kind: z.literal("randomPoints"), count: z.number().int().positive(), spreadRadius: z.number().positive(), pointRadius: z.number().positive() }),
]);
const effectActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("damage"), amount: z.number() }),
  z.object({ kind: z.literal("heal"), amount: z.number() }),
  z.object({ kind: z.literal("dot"), amount: z.number(), tickIntervalMs: z.number().int().positive(), durationMs: z.number().int().positive() }),
  z.object({ kind: z.literal("ailment"), ailment: z.enum(["weaken"]) }),
  z.object({ kind: z.literal("buff"), buff: z.enum(["battleFury", "shadowStep", "huntersFocus", "divineFavor", "arcaneSurge"]) }),
  z.object({ kind: z.literal("knockback"), distance: z.number().positive() }),
  z.object({ kind: z.literal("dispel") }),
  z.object({ kind: z.literal("interrupt") }),
  z.object({ kind: z.literal("summon"), enemyTypeId: z.string().min(1), count: z.number().int().positive() }),
]);
const effectDefSchema = z.object({ shape: effectShapeSchema, actions: z.array(effectActionSchema).min(1) });

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
  effects: z.array(effectDefSchema).nullable().optional(),
});
const updateSchema = spellSchema.omit({ id: true }).partial();

// No checkDeletable - nothing else references a spell by id (characters don't "learn" spells
// individually, every spell belonging to your class is simply available).
export const spellsRouter = createCrudRouter("spells", {
  createSchema: spellSchema,
  updateSchema,
  jsonColumns: ["effects"],
});
