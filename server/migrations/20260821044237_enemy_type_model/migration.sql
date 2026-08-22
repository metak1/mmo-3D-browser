-- An enemy type can pick a specific character model (see client/src/game/Enemy.ts's
-- MODEL_CONFIG) instead of always using the single shared goblin - same pattern as
-- structures.model_id for "building" kind structures.
ALTER TABLE "enemy_types" ADD COLUMN "model_id" VARCHAR(64);
