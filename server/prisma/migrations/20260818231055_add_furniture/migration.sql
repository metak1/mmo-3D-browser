-- CreateTable
CREATE TABLE "furniture" (
    "id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "map_id" VARCHAR(32) NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "z" DOUBLE PRECISION NOT NULL,
    "rotation_y" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "color" VARCHAR(16) NOT NULL,
    "y_offset" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "furniture_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "furniture" ADD CONSTRAINT "furniture_map_id_fkey" FOREIGN KEY ("map_id") REFERENCES "game_maps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
