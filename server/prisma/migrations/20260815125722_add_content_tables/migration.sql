-- AlterTable
ALTER TABLE "users" ADD COLUMN     "role" VARCHAR(16) NOT NULL DEFAULT 'player';

-- CreateTable
CREATE TABLE "game_classes" (
    "id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "main_stat" VARCHAR(16) NOT NULL,
    "role" VARCHAR(16) NOT NULL,

    CONSTRAINT "game_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spells" (
    "id" VARCHAR(64) NOT NULL,
    "class_id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "effect_type" VARCHAR(16) NOT NULL,
    "target_type" VARCHAR(16) NOT NULL,
    "amount" INTEGER,
    "aoe_radius" DOUBLE PRECISION,
    "interrupts_cast" BOOLEAN NOT NULL DEFAULT false,
    "cooldown_ms" INTEGER NOT NULL,
    "cast_time_ms" INTEGER NOT NULL,
    "range" DOUBLE PRECISION NOT NULL,
    "projectile_speed" DOUBLE PRECISION,

    CONSTRAINT "spells_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "slot" VARCHAR(16) NOT NULL,
    "bonuses" JSONB NOT NULL DEFAULT '{}',
    "icon" VARCHAR(16) NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "base_price" INTEGER NOT NULL,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "talents" (
    "id" VARCHAR(64) NOT NULL,
    "class_id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "max_rank" INTEGER NOT NULL,
    "effect_key" VARCHAR(32) NOT NULL,
    "per_rank" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "talents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enemy_types" (
    "id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "behavior" VARCHAR(16) NOT NULL,
    "xp_reward" INTEGER NOT NULL,
    "gold_reward" INTEGER NOT NULL,
    "stats" JSONB NOT NULL,

    CONSTRAINT "enemy_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_maps" (
    "id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "half_extent" DOUBLE PRECISION NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "portal_x" DOUBLE PRECISION,
    "portal_z" DOUBLE PRECISION,
    "boss_arena_x" DOUBLE PRECISION,
    "boss_arena_z" DOUBLE PRECISION,
    "boss_arena_radius" DOUBLE PRECISION,

    CONSTRAINT "game_maps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enemy_spawns" (
    "id" TEXT NOT NULL,
    "map_id" VARCHAR(32) NOT NULL,
    "enemy_type_id" VARCHAR(32) NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "z" DOUBLE PRECISION NOT NULL,
    "respawn_ms" INTEGER,

    CONSTRAINT "enemy_spawns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "npcs" (
    "id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "z" DOUBLE PRECISION NOT NULL,
    "map_id" VARCHAR(32) NOT NULL,

    CONSTRAINT "npcs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "npc_vendor_items" (
    "npc_id" VARCHAR(32) NOT NULL,
    "item_id" VARCHAR(32) NOT NULL,

    CONSTRAINT "npc_vendor_items_pkey" PRIMARY KEY ("npc_id","item_id")
);

-- CreateTable
CREATE TABLE "quests" (
    "id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "giver_npc_id" VARCHAR(32) NOT NULL,
    "objective_enemy_type_id" VARCHAR(32) NOT NULL,
    "objective_count" INTEGER NOT NULL,
    "reward_xp" INTEGER NOT NULL,
    "reward_item_id" VARCHAR(32),

    CONSTRAINT "quests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dungeons" (
    "id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "map_id" VARCHAR(32) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "party_size" INTEGER NOT NULL,
    "composition" JSONB NOT NULL,
    "encounters" JSONB NOT NULL,

    CONSTRAINT "dungeons_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "spells" ADD CONSTRAINT "spells_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "game_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "talents" ADD CONSTRAINT "talents_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "game_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enemy_spawns" ADD CONSTRAINT "enemy_spawns_map_id_fkey" FOREIGN KEY ("map_id") REFERENCES "game_maps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enemy_spawns" ADD CONSTRAINT "enemy_spawns_enemy_type_id_fkey" FOREIGN KEY ("enemy_type_id") REFERENCES "enemy_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "npcs" ADD CONSTRAINT "npcs_map_id_fkey" FOREIGN KEY ("map_id") REFERENCES "game_maps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "npc_vendor_items" ADD CONSTRAINT "npc_vendor_items_npc_id_fkey" FOREIGN KEY ("npc_id") REFERENCES "npcs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "npc_vendor_items" ADD CONSTRAINT "npc_vendor_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quests" ADD CONSTRAINT "quests_giver_npc_id_fkey" FOREIGN KEY ("giver_npc_id") REFERENCES "npcs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quests" ADD CONSTRAINT "quests_objective_enemy_type_id_fkey" FOREIGN KEY ("objective_enemy_type_id") REFERENCES "enemy_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quests" ADD CONSTRAINT "quests_reward_item_id_fkey" FOREIGN KEY ("reward_item_id") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dungeons" ADD CONSTRAINT "dungeons_map_id_fkey" FOREIGN KEY ("map_id") REFERENCES "game_maps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
