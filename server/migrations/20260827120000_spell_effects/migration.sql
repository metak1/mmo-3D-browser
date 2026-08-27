-- The composable effect system's opt-in path for spells (shared's EffectDef[] - shape + combinable
-- actions[], e.g. damage + a lingering DOT + knockback from one cast). Additive: NULL/empty means
-- "use the existing effect_type/target_type/amount/aoe_radius/interrupts_cast fields exactly as
-- before" (see CombatEngine.handleCast/tickPlayerCasts, both check this first and fall through
-- when unset) - every spell authored before this column existed keeps working unchanged.
ALTER TABLE "spells" ADD COLUMN "effects" JSONB;
