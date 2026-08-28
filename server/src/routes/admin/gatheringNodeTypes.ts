import { z } from "zod";
import { countWhere } from "../../db/client.js";
import { createCrudRouter } from "../../http/createCrudRouter.js";

// The "species" of a gathering node (mirrors enemy-types vs enemy-spawns) - what it produces, its
// model, its yield/respawn tuning. See shared/src/types.ts's GatheringNodeTypeDef.
const nodeTypeSchema = z.object({
  id: z.string().min(1).max(32),
  profession: z.enum(["lumberjack", "miner"]), // must be a GATHERING_PROFESSIONS member
  name: z.string().min(1).max(64),
  model_id: z.string().min(1).max(64),
  output_item_id: z.string().min(1).max(32),
  output_quantity: z.number().int().positive(),
  xp_award: z.number().int().nonnegative(),
  respawn_ms: z.number().int().positive(),
  required_level: z.number().int().nonnegative(),
});
const updateSchema = nodeTypeSchema.omit({ id: true }).partial();

export const gatheringNodeTypesRouter = createCrudRouter("gathering_node_types", {
  createSchema: nodeTypeSchema,
  updateSchema,
  checkDeletable: async (id) => {
    const nodeCount = await countWhere("gathering_nodes", "node_type_id = $1", [id]);
    if (nodeCount > 0) return `${nodeCount} placed node(s) use this type - delete or reassign them first`;
    return null;
  },
});
