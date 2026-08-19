/*
  Warnings:

  - The primary key for the `enemy_spawns` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to alter the column `id` on the `enemy_spawns` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(32)`.

*/
-- AlterTable
ALTER TABLE "enemy_spawns" DROP CONSTRAINT "enemy_spawns_pkey",
ALTER COLUMN "id" SET DATA TYPE VARCHAR(32),
ADD CONSTRAINT "enemy_spawns_pkey" PRIMARY KEY ("id");
