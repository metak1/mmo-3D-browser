-- AlterTable
-- Existing rows get a temporary '{}' placeholder; the seed script immediately upserts every
-- talent row with its real TalentEffect payload right after this migration applies, so the
-- default only exists to satisfy the NOT NULL constraint during the ALTER itself.
ALTER TABLE "talents" ADD COLUMN     "effect" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "talents" ALTER COLUMN "effect" DROP DEFAULT;
ALTER TABLE "talents" DROP COLUMN "effect_key";
ALTER TABLE "talents" DROP COLUMN "per_rank";
