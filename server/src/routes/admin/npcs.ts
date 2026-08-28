// Not built on createCrudRouter - an NPC's vendor catalog is a separate join table
// (NpcVendorItem), which needs its own sync step around the plain Npc row create/update that
// the generic factory doesn't have a hook for. This is the one entity that needs it, so it's
// hand-written rather than growing the factory a hook only one caller would ever use.
import { Router } from "express";
import { z } from "zod";
import { countWhere, pool } from "../../db/client.js";
import { asyncHandler } from "../../http/asyncHandler.js";
import { reloadGameContent } from "../../db/content.js";

const npcFields = {
  name: z.string().min(1).max(64),
  x: z.number(),
  z: z.number(),
  y_offset: z.number().default(0),
  map_id: z.string().min(1).max(32),
  vendor_item_ids: z.array(z.string()).optional(),
  teaches_profession_id: z
    .enum(["lumberjack", "miner", "alchemist", "cook", "blacksmith", "tailor", "jeweler"])
    .nullable()
    .optional(),
};
const createSchema = z.object({ id: z.string().min(1).max(32), ...npcFields });
const updateSchema = z.object(npcFields).partial();

function stripVendorField<T extends { vendor_item_ids?: string[] }>({ vendor_item_ids, ...rest }: T) {
  return rest;
}

async function syncVendorItems(npcId: string, itemIds: string[] | undefined) {
  if (itemIds === undefined) return; // field omitted entirely - leave the existing catalog untouched
  await pool.query("DELETE FROM npc_vendor_items WHERE npc_id = $1", [npcId]);
  if (itemIds.length > 0) {
    const values = itemIds.map((_, i) => `($1, $${i + 2})`).join(", ");
    await pool.query(`INSERT INTO npc_vendor_items (npc_id, item_id) VALUES ${values}`, [npcId, ...itemIds]);
  }
}

async function withVendorItems<T extends { id: string }>(npc: T) {
  const { rows } = await pool.query<{ item_id: string }>("SELECT item_id FROM npc_vendor_items WHERE npc_id = $1", [
    npc.id,
  ]);
  return { ...npc, vendor_item_ids: rows.map((r) => r.item_id) };
}

function formatZodError(error: { issues: { message: string }[] }): string {
  return error.issues.map((issue) => issue.message).join(", ");
}

export const npcsRouter = Router();

npcsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const { rows } = await pool.query("SELECT * FROM npcs");
    res.json({ items: await Promise.all(rows.map(withVendorItems)) });
  }),
);

npcsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM npcs WHERE id = $1", [req.params.id]);
    if (rows.length === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ item: await withVendorItems(rows[0]) });
  }),
);

npcsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: formatZodError(parsed.error) });
      return;
    }
    const { id, name, x, z, y_offset, map_id, teaches_profession_id } = parsed.data;
    const { rows } = await pool.query(
      "INSERT INTO npcs (id, name, x, z, y_offset, map_id, teaches_profession_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
      [id, name, x, z, y_offset, map_id, teaches_profession_id ?? null],
    );
    await syncVendorItems(id, parsed.data.vendor_item_ids);
    await reloadGameContent();
    res.status(201).json({ item: await withVendorItems(rows[0]) });
  }),
);

npcsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: formatZodError(parsed.error) });
      return;
    }
    const fields = stripVendorField(parsed.data) as Record<string, unknown>;
    const columns = Object.keys(fields);
    if (columns.length > 0) {
      const setClause = columns.map((col, i) => `${col} = $${i + 1}`).join(", ");
      await pool.query(`UPDATE npcs SET ${setClause} WHERE id = $${columns.length + 1}`, [
        ...columns.map((col) => fields[col]),
        req.params.id,
      ]);
    }
    await syncVendorItems(req.params.id, parsed.data.vendor_item_ids);
    await reloadGameContent();
    const { rows } = await pool.query("SELECT * FROM npcs WHERE id = $1", [req.params.id]);
    if (rows.length === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ item: await withVendorItems(rows[0]) });
  }),
);

npcsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const questCount = await countWhere("quests", "giver_npc_id = $1", [req.params.id]);
    if (questCount > 0) {
      res.status(409).json({ error: `${questCount} quest(s) are given by this NPC - delete or reassign them first` });
      return;
    }
    await pool.query("DELETE FROM npcs WHERE id = $1", [req.params.id]);
    await reloadGameContent();
    res.status(204).send();
  }),
);
