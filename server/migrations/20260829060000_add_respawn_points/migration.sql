-- CreateTable
CREATE TABLE "respawn_points" (
    "id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "map_id" VARCHAR(32) NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "z" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "respawn_points_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "respawn_points" ADD CONSTRAINT "respawn_points_map_id_fkey" FOREIGN KEY ("map_id") REFERENCES "game_maps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
