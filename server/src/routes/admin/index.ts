import { Router } from "express";
import { asyncHandler } from "../../http/asyncHandler.js";
import { reloadGameContent } from "../../db/content.js";
import { classesRouter } from "./classes.js";
import { spellsRouter } from "./spells.js";
import { itemsRouter } from "./items.js";
import { talentsRouter } from "./talents.js";
import { enemyTypesRouter } from "./enemyTypes.js";
import { enemySpawnsRouter } from "./enemySpawns.js";
import { enemySpawnZonesRouter } from "./enemySpawnZones.js";
import { npcsRouter } from "./npcs.js";
import { questsRouter } from "./quests.js";
import { mapsRouter } from "./maps.js";
import { dungeonsRouter } from "./dungeons.js";
import { structuresRouter } from "./structures.js";
import { waypointsRouter } from "./waypoints.js";
import { respawnPointsRouter } from "./respawnPoints.js";
import { furnitureRouter } from "./furniture.js";
import { hexTilesRouter } from "./hexTiles.js";
import { recipesRouter } from "./recipes.js";
import { gatheringNodeTypesRouter } from "./gatheringNodeTypes.js";
import { gatheringNodesRouter } from "./gatheringNodes.js";
import { dungeonPortalsRouter } from "./dungeonPortals.js";

export const adminRouter = Router();

adminRouter.use("/classes", classesRouter);
adminRouter.use("/spells", spellsRouter);
adminRouter.use("/items", itemsRouter);
adminRouter.use("/talents", talentsRouter);
adminRouter.use("/enemy-types", enemyTypesRouter);
adminRouter.use("/enemy-spawns", enemySpawnsRouter);
adminRouter.use("/enemy-spawn-zones", enemySpawnZonesRouter);
adminRouter.use("/npcs", npcsRouter);
adminRouter.use("/quests", questsRouter);
adminRouter.use("/maps", mapsRouter);
adminRouter.use("/dungeons", dungeonsRouter);
adminRouter.use("/structures", structuresRouter);
adminRouter.use("/waypoints", waypointsRouter);
adminRouter.use("/respawn-points", respawnPointsRouter);
adminRouter.use("/furniture", furnitureRouter);
adminRouter.use("/hex-tiles", hexTilesRouter);
adminRouter.use("/recipes", recipesRouter);
adminRouter.use("/gathering-node-types", gatheringNodeTypesRouter);
adminRouter.use("/gathering-nodes", gatheringNodesRouter);
adminRouter.use("/dungeon-portals", dungeonPortalsRouter);

// Manual escape hatch - every CRUD mutation already reloads on its own, but this is useful
// after a direct DB edit or for the admin UI to force-refresh the live server's view of content.
adminRouter.post(
  "/reload",
  asyncHandler(async (_req, res) => {
    await reloadGameContent();
    res.status(204).send();
  }),
);
