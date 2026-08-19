import { Router } from "express";
import { ZodType } from "zod";
import { pool } from "../db/client.js";
import { reloadGameContent } from "../db/content.js";
import { asyncHandler } from "./asyncHandler.js";

export interface CrudRouterOptions {
  createSchema: ZodType;
  updateSchema: ZodType;
  // Columns that hold jsonb - their values must be JSON.stringify'd before going into a query
  // parameter, since the driver doesn't serialize plain objects for jsonb columns on its own.
  jsonColumns?: string[];
  // Returns a user-facing error message if this id is still referenced elsewhere and must not
  // be deleted, or null if deletion is safe. Needed because most of the risky references
  // (Character.class_id, CharacterItem.item_id) have no DB-level foreign key to throw on -
  // see the admin backend plan's "Deletion safety" section.
  checkDeletable?: (id: string) => Promise<string | null>;
}

function formatZodError(error: { issues: { message: string }[] }): string {
  return error.issues.map((issue) => issue.message).join(", ");
}

// Every mutating route reloads live game content after a successful write, so admin edits take
// effect on the running server immediately - see loadGameContent's contract in shared/src/types.ts.
export function createCrudRouter(table: string, options: CrudRouterOptions): Router {
  const router = Router();
  const jsonColumns = options.jsonColumns ?? [];

  function encode(column: string, value: unknown): unknown {
    return jsonColumns.includes(column) ? JSON.stringify(value) : value;
  }

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      const { rows } = await pool.query(`SELECT * FROM ${table}`);
      res.json({ items: rows });
    }),
  );

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const { rows } = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [req.params.id]);
      if (rows.length === 0) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json({ item: rows[0] });
    }),
  );

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const parsed = options.createSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: formatZodError(parsed.error) });
        return;
      }
      const data = parsed.data as Record<string, unknown>;
      const columns = Object.keys(data);
      const values = columns.map((col) => encode(col, data[col]));
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
      const { rows } = await pool.query(
        `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders}) RETURNING *`,
        values,
      );
      await reloadGameContent();
      res.status(201).json({ item: rows[0] });
    }),
  );

  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const parsed = options.updateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: formatZodError(parsed.error) });
        return;
      }
      const data = parsed.data as Record<string, unknown>;
      const columns = Object.keys(data);
      if (columns.length === 0) {
        const { rows } = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [req.params.id]);
        if (rows.length === 0) {
          res.status(404).json({ error: "Not found" });
          return;
        }
        res.json({ item: rows[0] });
        return;
      }
      const values = columns.map((col) => encode(col, data[col]));
      const setClause = columns.map((col, i) => `${col} = $${i + 1}`).join(", ");
      const { rows } = await pool.query(
        `UPDATE ${table} SET ${setClause} WHERE id = $${columns.length + 1} RETURNING *`,
        [...values, req.params.id],
      );
      if (rows.length === 0) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      await reloadGameContent();
      res.json({ item: rows[0] });
    }),
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      if (options.checkDeletable) {
        const blockReason = await options.checkDeletable(req.params.id);
        if (blockReason) {
          res.status(409).json({ error: blockReason });
          return;
        }
      }
      await pool.query(`DELETE FROM ${table} WHERE id = $1`, [req.params.id]);
      await reloadGameContent();
      res.status(204).send();
    }),
  );

  return router;
}
