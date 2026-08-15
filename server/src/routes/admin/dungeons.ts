import { z } from "zod";
import { prisma } from "../../db/client.js";
import { createCrudRouter } from "../../http/createCrudRouter.js";
import { asyncHandler } from "../../http/asyncHandler.js";
import { reloadGameContent } from "../../db/content.js";

const encounterSpecSchema = z.object({ enemyTypeId: z.string().min(1), x: z.number(), z: z.number() });

const dungeonSchema = z.object({
  id: z.string().min(1).max(32),
  name: z.string().min(1).max(64),
  map_id: z.string().min(1).max(32),
  party_size: z.number().int().positive(),
  composition: z.record(z.string(), z.number()),
  encounters: z.array(z.array(encounterSpecSchema)), // ordered waves
});
// is_active is exclusively managed via POST /:id/activate below, same reasoning as maps.ts.
const updateSchema = dungeonSchema.omit({ id: true }).partial();

export const dungeonsRouter = createCrudRouter(prisma.dungeon, { createSchema: dungeonSchema, updateSchema });

// Activating one dungeon clears every other dungeon's flag in the same transaction, so
// "exactly one active dungeon" always holds (the overworld portal always leads to whichever
// dungeon has is_active=true).
dungeonsRouter.post(
  "/:id/activate",
  asyncHandler(async (req, res) => {
    const dungeon = await prisma.dungeon.findUnique({ where: { id: req.params.id } });
    if (!dungeon) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    await prisma.$transaction([
      prisma.dungeon.updateMany({ data: { is_active: false } }),
      prisma.dungeon.update({ where: { id: req.params.id }, data: { is_active: true } }),
    ]);
    await reloadGameContent();
    res.json({ item: await prisma.dungeon.findUnique({ where: { id: req.params.id } }) });
  }),
);
