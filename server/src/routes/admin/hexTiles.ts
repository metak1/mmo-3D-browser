import { z } from "zod";
import { createCrudRouter } from "../../http/createCrudRouter.js";

const hexTileSchema = z.object({
  id: z.string().min(1).max(48),
  map_id: z.string().min(1).max(32),
  q: z.number().int(),
  r: z.number().int(),
  kind: z.enum(["grass", "water", "road", "river", "coastCornerLight", "coastNarrowEdge", "coastHalf", "coastMostly"]),
  // Only meaningful for the coast* kinds - see HexTileOverrideDef's own doc comment.
  rotation: z.number().optional(),
});
const updateSchema = hexTileSchema.omit({ id: true }).partial();

// No checkDeletable - nothing references a hex tile override by id, it's a leaf row (same as
// waypoints/structures). Deleting one just reverts that cell to shared/src/hex.ts's procedural
// default (see classify()'s "overrides win first" ordering) rather than leaving a gap.
export const hexTilesRouter = createCrudRouter("hex_tiles", { createSchema: hexTileSchema, updateSchema });
