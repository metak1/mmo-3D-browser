import { Router } from "express";
import { ZodType } from "zod";
import { reloadGameContent } from "../db/content.js";
import { asyncHandler } from "./asyncHandler.js";

// Prisma's generated delegate methods are generic (SelectSubset<T, ...>), so TypeScript checks
// their parameters structurally even through a method-syntax interface - there's no reasonably
// sized structural type this factory could declare that every prisma.<model> delegate would
// actually satisfy. Accepting the delegate as `any` here is a deliberate, narrow escape hatch
// (this is the only place in the file untyped) rather than importing every model's specific
// generated Create/Update input types just to make a generic router factory typecheck.
type PrismaModelDelegate = any;

export interface CrudRouterOptions {
  createSchema: ZodType;
  updateSchema: ZodType;
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
export function createCrudRouter(model: PrismaModelDelegate, options: CrudRouterOptions): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      res.json({ items: await model.findMany() });
    }),
  );

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const item = await model.findUnique({ where: { id: req.params.id } });
      if (!item) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json({ item });
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
      const item = await model.create({ data: parsed.data });
      await reloadGameContent();
      res.status(201).json({ item });
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
      const item = await model.update({ where: { id: req.params.id }, data: parsed.data });
      await reloadGameContent();
      res.json({ item });
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
      await model.delete({ where: { id: req.params.id } });
      await reloadGameContent();
      res.status(204).send();
    }),
  );

  return router;
}
