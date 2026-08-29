-- Character spawn coordinates, distinct from the existing portal_x/portal_z (which position the
-- clickable dungeon-entrance portal object, not where a player actually appears - see
-- shared's SPAWN_POSITION/PORTAL_POSITION doc comments). Nullable, defaulting to the origin at
-- read time (see loadGameContent) - same "unset means (0,0)" convention portal_x/z already use.
ALTER TABLE "game_maps" ADD COLUMN "spawn_x" DOUBLE PRECISION;
ALTER TABLE "game_maps" ADD COLUMN "spawn_z" DOUBLE PRECISION;
