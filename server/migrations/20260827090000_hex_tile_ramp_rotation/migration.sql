-- Lets an admin pick a specific direction for a grass cell's ramp (the sloped piece toward a
-- lower neighbor), replacing classifyElevationRamps' automatic neighbor-facing computation for
-- that cell. NULL means "keep computing it automatically" - see shared's HexTileOverrideDef.
ALTER TABLE "hex_tiles" ADD COLUMN "ramp_rotation" DOUBLE PRECISION;
