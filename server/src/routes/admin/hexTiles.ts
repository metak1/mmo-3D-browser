import { z } from "zod";
import { HEX_MAX_ELEVATION } from "@mmo/shared";
import { createCrudRouter } from "../../http/createCrudRouter.js";

const hexTileSchema = z.object({
  id: z.string().min(1).max(48),
  map_id: z.string().min(1).max(32),
  q: z.number().int(),
  r: z.number().int(),
  kind: z.enum(["grass", "water", "road", "river", "coastCornerLight", "coastNarrowEdge", "coastHalf", "coastMostly"]),
  // Only meaningful for the coast* kinds - see HexTileOverrideDef's own doc comment. Nullable
  // (like elevation/ramp_rotation below) because the admin's EntityForm round-trips the whole row
  // on every save, including untouched columns that are already null in the DB - a plain
  // z.number().optional() rejects an explicit null with "Expected number, received null" even
  // though the column itself has always allowed it.
  rotation: z.number().nullable().optional(),
  // Applies to any kind - see HexTileOverrideDef's own doc comment.
  elevation: z.number().int().min(0).max(HEX_MAX_ELEVATION).nullable().optional(),
  // Only meaningful for "grass" with elevation > 0 - see HexTileOverrideDef's own doc comment.
  ramp_rotation: z.number().nullable().optional(),
});
const updateSchema = hexTileSchema.omit({ id: true }).partial();

// No checkDeletable - nothing references a hex tile override by id, it's a leaf row (same as
// waypoints/structures). Deleting one just reverts that cell to shared/src/hex.ts's procedural
// default (see classify()'s "overrides win first" ordering) rather than leaving a gap.
export const hexTilesRouter = createCrudRouter("hex_tiles", { createSchema: hexTileSchema, updateSchema });
