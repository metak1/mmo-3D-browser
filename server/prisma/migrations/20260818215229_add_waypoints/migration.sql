-- CreateTable
CREATE TABLE "waypoints" (
    "id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "map_id" VARCHAR(32) NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "z" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "waypoints_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "waypoints" ADD CONSTRAINT "waypoints_map_id_fkey" FOREIGN KEY ("map_id") REFERENCES "game_maps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
