-- "lamp" kind structures (see shared's StructureKind doc comment) use this to scale their light's
-- intensity/glow strength - NULL means "use the built-in default" (see client's
-- LAMP_MAX_LIGHT_INTENSITY), same nullable-means-default convention model_id already uses.
-- AlterTable
ALTER TABLE "structures" ADD COLUMN     "light_intensity" DOUBLE PRECISION;
