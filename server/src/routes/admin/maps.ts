import { z } from "zod";
import { prisma } from "../../db/client.js";
import { createCrudRouter } from "../../http/createCrudRouter.js";
import { asyncHandler } from "../../http/asyncHandler.js";
import { reloadGameContent } from "../../db/content.js";

const mapSchema = z.object({
  id: z.string().min(1).max(32),
  name: z.string().min(1).max(64),
  kind: z.enum(["overworld", "dungeon"]),
  half_extent: z.number().positive(),
  portal_x: z.number().nullable().optional(),
  portal_z: z.number().nullable().optional(),
  boss_arena_x: z.number().nullable().optional(),
  boss_arena_z: z.number().nullable().optional(),
  boss_arena_radius: z.number().positive().nullable().optional(),
});
// `kind` and `is_active` are excluded from ordinary updates - kind shouldn't change after
// creation, and is_active is exclusively managed via POST /:id/activate below (so "exactly one
// active overworld map" stays enforced instead of being editable as a plain boolean field).
const updateSchema = mapSchema.omit({ id: true, kind: true }).partial();

export const mapsRouter = createCrudRouter(prisma.gameMap, {
  createSchema: mapSchema,
  updateSchema,
  checkDeletable: async (id) => {
    const [npcCount, spawnCount, dungeonCount] = await Promise.all([
      prisma.npc.count({ where: { map_id: id } }),
      prisma.enemySpawn.count({ where: { map_id: id } }),
      prisma.dungeon.count({ where: { map_id: id } }),
    ]);
    if (npcCount > 0) return `${npcCount} NPC(s) are placed on this map`;
    if (spawnCount > 0) return `${spawnCount} enemy spawn point(s) are on this map`;
    if (dungeonCount > 0) return `${dungeonCount} dungeon(s) use this map as their ground`;
    return null;
  },
});

// Only meaningful for kind:"overworld" rows - activating one clears every other overworld
// map's flag in the same transaction, so "exactly one active overworld map" always holds.
mapsRouter.post(
  "/:id/activate",
  asyncHandler(async (req, res) => {
    const map = await prisma.gameMap.findUnique({ where: { id: req.params.id } });
    if (!map) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (map.kind !== "overworld") {
      res.status(400).json({ error: "Only overworld maps can be activated" });
      return;
    }

    await prisma.$transaction([
      prisma.gameMap.updateMany({ where: { kind: "overworld" }, data: { is_active: false } }),
      prisma.gameMap.update({ where: { id: req.params.id }, data: { is_active: true } }),
    ]);
    await reloadGameContent();
    res.json({ item: await prisma.gameMap.findUnique({ where: { id: req.params.id } }) });
  }),
);
