import { z } from "zod";
import { createCrudRouter } from "../../http/createCrudRouter.js";

const respawnPointSchema = z.object({
  id: z.string().min(1).max(32),
  name: z.string().min(1).max(64),
  map_id: z.string().min(1).max(32),
  x: z.number(),
  z: z.number(),
});
const updateSchema = respawnPointSchema.omit({ id: true }).partial();

// No checkDeletable - nothing references a respawn point by id, it's a leaf row (same as waypoints).
export const respawnPointsRouter = createCrudRouter("respawn_points", { createSchema: respawnPointSchema, updateSchema });
