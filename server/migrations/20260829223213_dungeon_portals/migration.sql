-- Dungeon portals become a real placeable/removable list (many portals per map, each linking to
-- its own dungeon) instead of one fixed portal_x/z pair on game_maps always leading to whichever
-- single dungeon had is_active=true. Mirrors gathering_nodes' own table shape exactly.
CREATE TABLE "dungeon_portals" (
    "id" TEXT NOT NULL,
    "map_id" VARCHAR(32) NOT NULL,
    "dungeon_id" VARCHAR(32) NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "z" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "dungeon_portals_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "dungeon_portals" ADD CONSTRAINT "dungeon_portals_map_id_fkey"
    FOREIGN KEY ("map_id") REFERENCES "game_maps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dungeon_portals" ADD CONSTRAINT "dungeon_portals_dungeon_id_fkey"
    FOREIGN KEY ("dungeon_id") REFERENCES "dungeons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Best-effort carry-forward of the single existing overworld portal (if any) onto whichever
-- dungeon happens to be marked is_active today, since a NOT NULL dungeon_id has to point
-- somewhere - server/scripts/seed.ts's own reseed inserts the real curated portal rows
-- immediately after this migration runs, so this is purely a safety net for a migrate-without-
-- reseed environment.
INSERT INTO "dungeon_portals" ("id", "map_id", "dungeon_id", "x", "z")
SELECT 'portal_' || m.id, m.id, d.id, m.portal_x, m.portal_z
FROM "game_maps" m
CROSS JOIN LATERAL (SELECT id FROM "dungeons" WHERE is_active = true LIMIT 1) d
WHERE m.portal_x IS NOT NULL AND m.portal_z IS NOT NULL;

ALTER TABLE "game_maps" DROP COLUMN "portal_x";
ALTER TABLE "game_maps" DROP COLUMN "portal_z";
ALTER TABLE "dungeons" DROP COLUMN "is_active";
