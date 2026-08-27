-- Lets an admin hand-sculpt a specific grass cell's height (0..HEX_MAX_ELEVATION), independent of
-- the procedural noise that would otherwise decide it - see shared's HexTileOverrideDef.elevation.
-- NULL means "flat, ground level" (0), matching every already-painted tile's existing behavior.
ALTER TABLE "hex_tiles" ADD COLUMN "elevation" INTEGER;
