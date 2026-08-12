-- AlterTable: collapse strength/dexterity/intellect into a single main_stat column,
-- backfilled per-row from whichever of the three matches that character's class.
ALTER TABLE "characters" ADD COLUMN "main_stat" INTEGER;

UPDATE "characters" SET "main_stat" = CASE class_id
  WHEN 'warrior' THEN strength
  WHEN 'rogue' THEN dexterity
  WHEN 'ranger' THEN dexterity
  WHEN 'oracle' THEN intellect
  WHEN 'mage' THEN intellect
  ELSE strength
END;

ALTER TABLE "characters" ALTER COLUMN "main_stat" SET NOT NULL;
ALTER TABLE "characters" DROP COLUMN "strength";
ALTER TABLE "characters" DROP COLUMN "dexterity";
ALTER TABLE "characters" DROP COLUMN "intellect";
