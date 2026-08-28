-- Professions: gathering (lumberjack/miner) + crafting (alchemist/cook/blacksmith/tailor/jeweler).
-- See shared/src/types.ts's ProfessionId/RecipeDef/GatheringNodeTypeDef/GatheringNodeDef/ItemDef.

-- Items gain a category (equipment vs material) and an optional consumable use-effect. Existing
-- rows all backfill to 'equipment' (their only possible meaning before this column existed) -
-- additive, zero data loss. slot becomes nullable since a material item has no equip slot.
ALTER TABLE "items" ADD COLUMN "category" VARCHAR(16) NOT NULL DEFAULT 'equipment';
ALTER TABLE "items" ALTER COLUMN "slot" DROP NOT NULL;
ALTER TABLE "items" ADD COLUMN "use_effects" JSONB;

-- Characters persist their learned professions' xp/level and their materials bag the same way
-- talent_ranks/quest_progress already persist as a JSONB map keyed by id.
ALTER TABLE "characters" ADD COLUMN "profession_xp" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "characters" ADD COLUMN "profession_level" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "characters" ADD COLUMN "materials" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "recipes" (
    "id" VARCHAR(64) NOT NULL,
    "profession" VARCHAR(16) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "required_level" INTEGER NOT NULL,
    "ingredients" JSONB NOT NULL,
    "output_item_id" VARCHAR(32) NOT NULL,
    "output_quantity" INTEGER NOT NULL,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gathering_node_types" (
    "id" VARCHAR(32) NOT NULL,
    "profession" VARCHAR(16) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "model_id" VARCHAR(64) NOT NULL,
    "output_item_id" VARCHAR(32) NOT NULL,
    "output_quantity" INTEGER NOT NULL,
    "xp_award" INTEGER NOT NULL,
    "respawn_ms" INTEGER NOT NULL,
    "required_level" INTEGER NOT NULL,

    CONSTRAINT "gathering_node_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gathering_nodes" (
    "id" TEXT NOT NULL,
    "map_id" VARCHAR(32) NOT NULL,
    "node_type_id" VARCHAR(32) NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "z" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "gathering_nodes_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_output_item_id_fkey" FOREIGN KEY ("output_item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_node_types" ADD CONSTRAINT "gathering_node_types_output_item_id_fkey" FOREIGN KEY ("output_item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_nodes" ADD CONSTRAINT "gathering_nodes_map_id_fkey" FOREIGN KEY ("map_id") REFERENCES "game_maps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_nodes" ADD CONSTRAINT "gathering_nodes_node_type_id_fkey" FOREIGN KEY ("node_type_id") REFERENCES "gathering_node_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
