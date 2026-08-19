import { z } from "zod";
import { createCrudRouter } from "../../http/createCrudRouter.js";

const waypointSchema = z.object({
  id: z.string().min(1).max(32),
  name: z.string().min(1).max(64),
  map_id: z.string().min(1).max(32),
  x: z.number(),
  z: z.number(),
});
const updateSchema = waypointSchema.omit({ id: true }).partial();

// No checkDeletable - nothing references a waypoint by id, it's a leaf row (same as structures).
export const waypointsRouter = createCrudRouter("waypoints", { createSchema: waypointSchema, updateSchema });
