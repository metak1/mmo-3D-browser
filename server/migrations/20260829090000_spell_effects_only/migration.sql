-- Player spells now use the same composable {shape, actions[]} system boss abilities always have
-- (see shared's SpellDef/EffectDef) - the older flat-field resolution (effect_type/amount/
-- aoe_radius/interrupts_cast) is retired, so effects becomes the sole source of truth.
-- Defensive backfill so this migration is safe regardless of whether it runs before or after the
-- reseed that populates every spell's effects (see server/scripts/seed.ts).
UPDATE "spells" SET "effects" = '[]' WHERE "effects" IS NULL;
ALTER TABLE "spells" ALTER COLUMN "effects" SET NOT NULL;
ALTER TABLE "spells" ALTER COLUMN "effects" SET DEFAULT '[]';
ALTER TABLE "spells" DROP COLUMN "effect_type";
ALTER TABLE "spells" DROP COLUMN "amount";
ALTER TABLE "spells" DROP COLUMN "aoe_radius";
ALTER TABLE "spells" DROP COLUMN "interrupts_cast";
