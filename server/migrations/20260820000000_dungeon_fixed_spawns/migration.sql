-- Dungeons no longer gate content behind ordered waves - every mob is a fixed spawn point live
-- for the whole run from the start (see DungeonRoom.spawnDungeonEnemy), same contract as the
-- overworld's spawn points. The column is renamed (not just reinterpreted) to match the renamed
-- DungeonDef.spawns field - existing values are the old nested-wave-array shape, which seed.ts
-- re-upserts into the new flat shape.
ALTER TABLE "dungeons" RENAME COLUMN "encounters" TO "spawns";
