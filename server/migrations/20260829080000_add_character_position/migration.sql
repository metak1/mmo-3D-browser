-- Persists a character's last overworld position (nullable - NULL means "never saved yet", i.e.
-- a brand new character, which spawns at SPAWN_POSITION instead - see WorldRoom.onJoin). Only
-- ever written from the overworld room; a dungeon run never touches these (dungeon coordinates
-- aren't meaningful outside that instance) - see DungeonRoom.onLeave's saveCharacterProgress call,
-- which omits position on purpose.
ALTER TABLE "characters" ADD COLUMN "x" DOUBLE PRECISION;
ALTER TABLE "characters" ADD COLUMN "z" DOUBLE PRECISION;
