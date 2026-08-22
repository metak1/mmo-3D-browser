-- A hand-painted coast tile (see shared's HexTerrainKind coastCornerLight/coastNarrowEdge/
-- coastHalf/coastMostly) needs its own stored rotation instead of one computed from neighbors -
-- these are now placed and rotated entirely by hand in the admin map editor.
ALTER TABLE "hex_tiles" ADD COLUMN "rotation" DOUBLE PRECISION;
