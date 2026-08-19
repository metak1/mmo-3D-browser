import { z } from "zod";
import { createCrudRouter } from "../../http/createCrudRouter.js";

const furnitureSchema = z.object({
  id: z.string().min(1).max(32),
  name: z.string().min(1).max(64),
  map_id: z.string().min(1).max(32),
  kind: z.enum(["table", "chair", "barrel", "crate", "bookshelf"]),
  x: z.number(),
  z: z.number(),
  rotation_y: z.number().default(0),
  color: z.string().min(1).max(16),
  y_offset: z.number().default(0),
});
const updateSchema = furnitureSchema.omit({ id: true }).partial();

// No checkDeletable - nothing references a furniture row by id, it's a leaf row (purely
// decorative geometry placed on a map, same as structures/waypoints).
export const furnitureRouter = createCrudRouter("furniture", { createSchema: furnitureSchema, updateSchema });
