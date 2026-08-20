-- "building" kind structures (see shared's StructureKind doc comment) reference a single
-- pre-made whole-building model instead of being assembled from wall/door pieces.
ALTER TABLE "structures" ADD COLUMN "model_id" VARCHAR(64);
