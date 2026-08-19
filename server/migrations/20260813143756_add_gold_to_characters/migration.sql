-- DropForeignKey
ALTER TABLE "character_items" DROP CONSTRAINT "character_items_character_id_fkey";

-- DropForeignKey
ALTER TABLE "characters" DROP CONSTRAINT "characters_user_id_fkey";

-- DropIndex
DROP INDEX "character_items_equip_slot";

-- AlterTable
ALTER TABLE "characters" ADD COLUMN     "gold" INTEGER NOT NULL DEFAULT 50;

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "character_items" ADD CONSTRAINT "character_items_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
