-- AlterTable
ALTER TABLE "talents" ADD COLUMN     "tier" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "talents" ADD COLUMN     "column_index" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "talents" ADD COLUMN     "prerequisite_talent_id" VARCHAR(64);

-- AddForeignKey
ALTER TABLE "talents" ADD CONSTRAINT "talents_prerequisite_talent_id_fkey" FOREIGN KEY ("prerequisite_talent_id") REFERENCES "talents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
