import { z } from "zod";
import { createCrudRouter } from "../../http/createCrudRouter.js";

// One map placement referencing a gathering-node-type - mirrors enemy_spawns exactly.
const nodeSchema = z.object({
  id: z.string().min(1).max(32),
  map_id: z.string().min(1).max(32),
  node_type_id: z.string().min(1).max(32),
  x: z.number(),
  z: z.number(),
});
const updateSchema = nodeSchema.omit({ id: true }).partial();

// No checkDeletable - nothing references a placed node by id, it's a leaf row.
export const gatheringNodesRouter = createCrudRouter("gathering_nodes", { createSchema: nodeSchema, updateSchema });
