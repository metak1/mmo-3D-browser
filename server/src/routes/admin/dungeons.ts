import { z } from "zod";
import { countWhere } from "../../db/client.js";
import { createCrudRouter } from "../../http/createCrudRouter.js";

// One fixed spawn point, live for the whole run from the moment the instance is created (see
// DungeonRoom.spawnDungeonEnemy) - no wave gating. The one entry whose enemyTypeId resolves to a
// "boss"-behavior enemy type is what the run is building toward; it doesn't respawn once killed,
// every other entry does (respawnMs, defaulting to ENEMY_RESPAWN_MS - same contract as the
// overworld's EnemySpawnDef).
const spawnSpecSchema = z.object({
  id: z.string().min(1).max(32),
  enemyTypeId: z.string().min(1).max(32),
  x: z.number(),
  z: z.number(),
  respawnMs: z.number().int().positive().optional(),
});

const dungeonSchema = z.object({
  id: z.string().min(1).max(32),
  name: z.string().min(1).max(64),
  map_id: z.string().min(1).max(32),
  party_size: z.number().int().positive(),
  composition: z.record(z.string(), z.number()),
  spawns: z.array(spawnSpecSchema),
});
const updateSchema = dungeonSchema.omit({ id: true }).partial();

// A dungeon simply exists or doesn't now (no more is_active/"exactly one active dungeon" flag -
// many can be reachable at once, each through its own dungeon_portals row(s)), so checkDeletable
// is the one guard left: a dungeon still pointed at by a portal can't just vanish out from under
// it (mirrors maps.ts's own checkDeletable pattern).
export const dungeonsRouter = createCrudRouter("dungeons", {
  createSchema: dungeonSchema,
  updateSchema,
  jsonColumns: ["composition", "spawns"],
  checkDeletable: async (id) => {
    const portalCount = await countWhere("dungeon_portals", "dungeon_id = $1", [id]);
    if (portalCount > 0) return `${portalCount} portal(s) still lead to this dungeon`;
    return null;
  },
});
