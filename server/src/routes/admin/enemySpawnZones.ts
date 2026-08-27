// Not built on createCrudRouter - a zone's enemy type pool is a separate join table
// (enemy_spawn_zone_types), which needs its own sync step around the plain row create/update
// the generic factory doesn't have a hook for. Mirrors npcs.ts's vendor_item_ids handling
// exactly (syncVendorItems/withVendorItems/stripVendorField -> the sync/with/strip trio below).
import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/client.js";
import { asyncHandler } from "../../http/asyncHandler.js";
import { reloadGameContent } from "../../db/content.js";

const zoneFields = {
  map_id: z.string().min(1).max(32),
  x: z.number(),
  z: z.number(),
  radius: z.number().positive(),
  max_population: z.number().int().positive(),
  respawn_ms: z.number().int().positive().nullable().optional(),
  wander_radius: z.number().positive().nullable().optional(),
  leash_range: z.number().positive().nullable().optional(),
  enemy_type_ids: z.array(z.string()).optional(),
};
const createSchema = z.object({ id: z.string().min(1).max(32), ...zoneFields });
const updateSchema = z.object(zoneFields).partial();

function stripZoneTypesField<T extends { enemy_type_ids?: string[] }>({ enemy_type_ids, ...rest }: T) {
  return rest;
}

async function syncZoneTypes(zoneId: string, typeIds: string[] | undefined) {
  if (typeIds === undefined) return; // field omitted entirely - leave the existing pool untouched
  await pool.query("DELETE FROM enemy_spawn_zone_types WHERE zone_id = $1", [zoneId]);
  if (typeIds.length > 0) {
    const values = typeIds.map((_, i) => `($1, $${i + 2})`).join(", ");
    await pool.query(`INSERT INTO enemy_spawn_zone_types (zone_id, enemy_type_id) VALUES ${values}`, [zoneId, ...typeIds]);
  }
}

async function withZoneTypes<T extends { id: string }>(zone: T) {
  const { rows } = await pool.query<{ enemy_type_id: string }>(
    "SELECT enemy_type_id FROM enemy_spawn_zone_types WHERE zone_id = $1",
    [zone.id],
  );
  return { ...zone, enemy_type_ids: rows.map((r) => r.enemy_type_id) };
}

function formatZodError(error: { issues: { message: string }[] }): string {
  return error.issues.map((issue) => issue.message).join(", ");
}

export const enemySpawnZonesRouter = Router();

enemySpawnZonesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const { rows } = await pool.query("SELECT * FROM enemy_spawn_zones");
    res.json({ items: await Promise.all(rows.map(withZoneTypes)) });
  }),
);

enemySpawnZonesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM enemy_spawn_zones WHERE id = $1", [req.params.id]);
    if (rows.length === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ item: await withZoneTypes(rows[0]) });
  }),
);

enemySpawnZonesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: formatZodError(parsed.error) });
      return;
    }
    const { id, map_id, x, z, radius, max_population, respawn_ms, wander_radius, leash_range } = parsed.data;
    const { rows } = await pool.query(
      `INSERT INTO enemy_spawn_zones (id, map_id, x, z, radius, max_population, respawn_ms, wander_radius, leash_range)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [id, map_id, x, z, radius, max_population, respawn_ms ?? null, wander_radius ?? null, leash_range ?? null],
    );
    await syncZoneTypes(id, parsed.data.enemy_type_ids);
    await reloadGameContent();
    res.status(201).json({ item: await withZoneTypes(rows[0]) });
  }),
);

enemySpawnZonesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: formatZodError(parsed.error) });
      return;
    }
    const fields = stripZoneTypesField(parsed.data) as Record<string, unknown>;
    const columns = Object.keys(fields);
    if (columns.length > 0) {
      const setClause = columns.map((col, i) => `${col} = $${i + 1}`).join(", ");
      await pool.query(`UPDATE enemy_spawn_zones SET ${setClause} WHERE id = $${columns.length + 1}`, [
        ...columns.map((col) => fields[col]),
        req.params.id,
      ]);
    }
    await syncZoneTypes(req.params.id, parsed.data.enemy_type_ids);
    await reloadGameContent();
    const { rows } = await pool.query("SELECT * FROM enemy_spawn_zones WHERE id = $1", [req.params.id]);
    if (rows.length === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ item: await withZoneTypes(rows[0]) });
  }),
);

enemySpawnZonesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await pool.query("DELETE FROM enemy_spawn_zones WHERE id = $1", [req.params.id]);
    await reloadGameContent();
    res.status(204).send();
  }),
);
