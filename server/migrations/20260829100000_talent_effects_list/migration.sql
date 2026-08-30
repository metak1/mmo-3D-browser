-- Talents now carry a LIST of effects (TalentDef.effects: TalentEffect[]) instead of exactly one -
-- the same "combinable list" upgrade spells' effects/boss abilities' specialAbilities already got.
-- Defensive backfill so this migration is correct regardless of whether it runs before or after
-- the reseed that wraps every existing talent's single effect into a one-element array (see
-- server/scripts/seed.ts).
UPDATE "talents" SET "effect" = jsonb_build_array("effect") WHERE jsonb_typeof("effect") = 'object';
ALTER TABLE "talents" RENAME COLUMN "effect" TO "effects";
