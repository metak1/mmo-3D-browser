import { z } from "zod";
import { prisma } from "../../db/client.js";
import { createCrudRouter } from "../../http/createCrudRouter.js";

const spawnSchema = z.object({
  id: z.string().min(1).max(32),
  map_id: z.string().min(1).max(32),
  enemy_type_id: z.string().min(1).max(32),
  x: z.number(),
  z: z.number(),
  respawn_ms: z.number().int().positive().nullable().optional(),
});
const updateSchema = spawnSchema.omit({ id: true }).partial();

// No checkDeletable - nothing references a spawn point by id, it's a leaf row (a place on a
// map where an enemy type respawns).
export const enemySpawnsRouter = createCrudRouter(prisma.enemySpawn, { createSchema: spawnSchema, updateSchema });
