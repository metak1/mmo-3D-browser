import { z } from "zod";
import { prisma } from "../../db/client.js";
import { createCrudRouter } from "../../http/createCrudRouter.js";

const structureSchema = z.object({
  id: z.string().min(1).max(32),
  name: z.string().min(1).max(64),
  map_id: z.string().min(1).max(32),
  kind: z.enum(["wall", "door", "tower", "gate"]),
  x: z.number(),
  z: z.number(),
  rotation_y: z.number().default(0),
  width: z.number().positive(),
  depth: z.number().positive(),
  height: z.number().positive(),
  color: z.string().min(1).max(16),
  y_offset: z.number().default(0),
});
const updateSchema = structureSchema.omit({ id: true }).partial();

// No checkDeletable - nothing references a structure by id, it's a leaf row (purely decorative
// geometry placed on a map).
export const structuresRouter = createCrudRouter(prisma.structure, { createSchema: structureSchema, updateSchema });
