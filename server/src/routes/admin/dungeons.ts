import { z } from "zod";
import { pool, withTransaction } from "../../db/client.js";
import { createCrudRouter } from "../../http/createCrudRouter.js";
import { asyncHandler } from "../../http/asyncHandler.js";
import { reloadGameContent } from "../../db/content.js";

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
// is_active is exclusively managed via POST /:id/activate below, same reasoning as maps.ts.
const updateSchema = dungeonSchema.omit({ id: true }).partial();

export const dungeonsRouter = createCrudRouter("dungeons", {
  createSchema: dungeonSchema,
  updateSchema,
  jsonColumns: ["composition", "spawns"],
});

// Activating one dungeon clears every other dungeon's flag in the same transaction, so
// "exactly one active dungeon" always holds (the overworld portal always leads to whichever
// dungeon has is_active=true).
dungeonsRouter.post(
  "/:id/activate",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM dungeons WHERE id = $1", [req.params.id]);
    if (rows.length === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    await withTransaction(async (client) => {
      await client.query("UPDATE dungeons SET is_active = false");
      await client.query("UPDATE dungeons SET is_active = true WHERE id = $1", [req.params.id]);
    });
    await reloadGameContent();
    const { rows: updated } = await pool.query("SELECT * FROM dungeons WHERE id = $1", [req.params.id]);
    res.json({ item: updated[0] });
  }),
);
