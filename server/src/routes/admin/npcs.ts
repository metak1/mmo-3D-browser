// Not built on createCrudRouter - an NPC's vendor catalog is a separate join table
// (NpcVendorItem), which needs its own sync step around the plain Npc row create/update that
// the generic factory doesn't have a hook for. This is the one entity that needs it, so it's
// hand-written rather than growing the factory a hook only one caller would ever use.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/client.js";
import { asyncHandler } from "../../http/asyncHandler.js";
import { reloadGameContent } from "../../db/content.js";

const npcFields = {
  name: z.string().min(1).max(64),
  x: z.number(),
  z: z.number(),
  map_id: z.string().min(1).max(32),
  vendor_item_ids: z.array(z.string()).optional(),
};
const createSchema = z.object({ id: z.string().min(1).max(32), ...npcFields });
const updateSchema = z.object(npcFields).partial();

function stripVendorField<T extends { vendor_item_ids?: string[] }>({ vendor_item_ids, ...rest }: T) {
  return rest;
}

async function syncVendorItems(npcId: string, itemIds: string[] | undefined) {
  if (itemIds === undefined) return; // field omitted entirely - leave the existing catalog untouched
  await prisma.npcVendorItem.deleteMany({ where: { npc_id: npcId } });
  if (itemIds.length > 0) {
    await prisma.npcVendorItem.createMany({ data: itemIds.map((item_id) => ({ npc_id: npcId, item_id })) });
  }
}

async function withVendorItems(npc: { id: string }) {
  const vendorRows = await prisma.npcVendorItem.findMany({ where: { npc_id: npc.id } });
  return { ...npc, vendor_item_ids: vendorRows.map((r) => r.item_id) };
}

function formatZodError(error: { issues: { message: string }[] }): string {
  return error.issues.map((issue) => issue.message).join(", ");
}

export const npcsRouter = Router();

npcsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const npcs = await prisma.npc.findMany();
    res.json({ items: await Promise.all(npcs.map(withVendorItems)) });
  }),
);

npcsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const npc = await prisma.npc.findUnique({ where: { id: req.params.id } });
    if (!npc) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ item: await withVendorItems(npc) });
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
    const npc = await prisma.npc.create({ data: stripVendorField(parsed.data) });
    await syncVendorItems(npc.id, parsed.data.vendor_item_ids);
    await reloadGameContent();
    res.status(201).json({ item: await withVendorItems(npc) });
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
    const npc = await prisma.npc.update({ where: { id: req.params.id }, data: stripVendorField(parsed.data) });
    await syncVendorItems(npc.id, parsed.data.vendor_item_ids);
    await reloadGameContent();
    res.json({ item: await withVendorItems(npc) });
  }),
);

npcsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const questCount = await prisma.quest.count({ where: { giver_npc_id: req.params.id } });
    if (questCount > 0) {
      res.status(409).json({ error: `${questCount} quest(s) are given by this NPC - delete or reassign them first` });
      return;
    }
    await prisma.npc.delete({ where: { id: req.params.id } });
    await reloadGameContent();
    res.status(204).send();
  }),
);
