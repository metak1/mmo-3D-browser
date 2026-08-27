-- Area-based mob spawning: a circle (x, z, radius) that maintains up to max_population enemies
-- alive at once, each randomly drawn from enemy_spawn_zone_types and randomly positioned within
-- the circle - an alternative to enemy_spawns' one-row-one-fixed-point model, not a replacement
-- for it (see shared's EnemySpawnZoneDef doc comment).
-- CreateTable
CREATE TABLE "enemy_spawn_zones" (
    "id" VARCHAR(32) NOT NULL,
    "map_id" VARCHAR(32) NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "z" DOUBLE PRECISION NOT NULL,
    "radius" DOUBLE PRECISION NOT NULL,
    "max_population" INTEGER NOT NULL,
    "respawn_ms" INTEGER,
    "wander_radius" DOUBLE PRECISION,
    "leash_range" DOUBLE PRECISION,

    CONSTRAINT "enemy_spawn_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enemy_spawn_zone_types" (
    "zone_id" VARCHAR(32) NOT NULL,
    "enemy_type_id" VARCHAR(32) NOT NULL,

    CONSTRAINT "enemy_spawn_zone_types_pkey" PRIMARY KEY ("zone_id", "enemy_type_id")
);

-- AddForeignKey
ALTER TABLE "enemy_spawn_zones" ADD CONSTRAINT "enemy_spawn_zones_map_id_fkey" FOREIGN KEY ("map_id") REFERENCES "game_maps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enemy_spawn_zone_types" ADD CONSTRAINT "enemy_spawn_zone_types_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "enemy_spawn_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enemy_spawn_zone_types" ADD CONSTRAINT "enemy_spawn_zone_types_enemy_type_id_fkey" FOREIGN KEY ("enemy_type_id") REFERENCES "enemy_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
