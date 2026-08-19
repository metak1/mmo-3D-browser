-- AlterTable
ALTER TABLE "characters" ADD COLUMN "quest_progress" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "characters" ADD COLUMN "quest_completed" JSONB NOT NULL DEFAULT '{}';
