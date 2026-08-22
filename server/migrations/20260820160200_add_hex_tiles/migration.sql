-- CreateTable
CREATE TABLE "hex_tiles" (
    "id" VARCHAR(48) NOT NULL,
    "map_id" VARCHAR(32) NOT NULL,
    "q" INTEGER NOT NULL,
    "r" INTEGER NOT NULL,
    "kind" VARCHAR(16) NOT NULL,

    CONSTRAINT "hex_tiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hex_tiles_map_id_q_r_key" ON "hex_tiles"("map_id", "q", "r");

-- AddForeignKey
ALTER TABLE "hex_tiles" ADD CONSTRAINT "hex_tiles_map_id_fkey" FOREIGN KEY ("map_id") REFERENCES "game_maps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
