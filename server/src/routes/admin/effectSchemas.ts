import { z } from "zod";

// Mirrors shared's EffectShape/EffectAction/EffectDef (see shared/src/types.ts) - kept as an
// explicit Zod schema rather than `z.any()` so a malformed admin-authored effect (typo'd kind,
// missing field) fails fast at save time instead of silently no-op'ing the first time
// CombatEngine's resolveEffect actually tries to interpret it. Shared by every admin route whose
// content carries an EffectDef[] (spells' `effects`, items' `use_effects`, boss abilities nested
// inside enemy-types' `stats`) so there's one copy to keep in sync with the shared union, not one
// per route.
export const effectShapeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("singleTarget") }),
  z.object({ kind: z.literal("circle"), radius: z.number().positive(), centeredOn: z.enum(["caster", "impact"]) }),
  z.object({ kind: z.literal("cone"), radius: z.number().positive(), angleDeg: z.number().positive().max(360) }),
  z.object({ kind: z.literal("line"), length: z.number().positive(), width: z.number().positive() }),
  z.object({ kind: z.literal("randomPoints"), count: z.number().int().positive(), spreadRadius: z.number().positive(), pointRadius: z.number().positive() }),
]);

export const effectActionSchema = z.discriminatedUnion("kind", [
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

export const effectDefSchema = z.object({ shape: effectShapeSchema, actions: z.array(effectActionSchema).min(1) });
