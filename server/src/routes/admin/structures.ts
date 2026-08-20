import { z } from "zod";
import { createCrudRouter } from "../../http/createCrudRouter.js";

const structureSchema = z.object({
  id: z.string().min(1).max(32),
  name: z.string().min(1).max(64),
  map_id: z.string().min(1).max(32),
  kind: z.enum(["wall", "door", "tower", "gate", "building"]),
  x: z.number(),
  z: z.number(),
  rotation_y: z.number().default(0),
  width: z.number().positive(),
  depth: z.number().positive(),
  height: z.number().positive(),
  color: z.string().min(1).max(16),
  y_offset: z.number().default(0),
  // "building" kind only - see shared's StructureKind and client/src/game/Structure.ts's
  // BUILDING_MODELS. width/depth/height above are unused for this kind (still required, so a
  // building row just gets nominal placeholder values) since the model has its own fixed shape.
  model_id: z.string().max(64).nullable().optional(),
});
const updateSchema = structureSchema.omit({ id: true }).partial();

// No checkDeletable - nothing references a structure by id, it's a leaf row (purely decorative
// geometry placed on a map).
export const structuresRouter = createCrudRouter("structures", { createSchema: structureSchema, updateSchema });
