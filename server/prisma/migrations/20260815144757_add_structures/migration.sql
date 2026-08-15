-- CreateTable
CREATE TABLE "structures" (
    "id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "map_id" VARCHAR(32) NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "z" DOUBLE PRECISION NOT NULL,
    "rotation_y" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "width" DOUBLE PRECISION NOT NULL,
    "depth" DOUBLE PRECISION NOT NULL,
    "height" DOUBLE PRECISION NOT NULL,
    "color" VARCHAR(16) NOT NULL,

    CONSTRAINT "structures_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "structures" ADD CONSTRAINT "structures_map_id_fkey" FOREIGN KEY ("map_id") REFERENCES "game_maps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
