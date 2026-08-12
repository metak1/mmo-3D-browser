-- AlterTable
ALTER TABLE "characters" ADD COLUMN "talent_points" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "characters" ADD COLUMN "talent_ranks" JSONB NOT NULL DEFAULT '{}';
