import { z } from "zod";
import { createCrudRouter } from "../../http/createCrudRouter.js";

// One clickable dungeon-entrance marker referencing a dungeon - mirrors gathering_nodes exactly,
// except the thing it references (dungeon_id) is which dungeon clicking it opens the finder for.
const portalSchema = z.object({
  id: z.string().min(1).max(32),
  map_id: z.string().min(1).max(32),
  dungeon_id: z.string().min(1).max(32),
  x: z.number(),
  z: z.number(),
});
const updateSchema = portalSchema.omit({ id: true }).partial();

// No checkDeletable - nothing references a placed portal by id, it's a leaf row.
export const dungeonPortalsRouter = createCrudRouter("dungeon_portals", { createSchema: portalSchema, updateSchema });
