import "./env.js";
import express, { NextFunction, Request, Response } from "express";
import { Server } from "@colyseus/core";
import config from "@colyseus/tools";
import { DUNGEON_ROOM_NAME, WORLD_ROOM_NAME } from "@mmo/shared";
import { WorldRoom } from "./rooms/WorldRoom.js";
import { DungeonRoom } from "./rooms/DungeonRoom.js";
import { authRouter } from "./routes/auth.js";
import { charactersRouter } from "./routes/characters.js";
import { contentRouter } from "./routes/content.js";
import { adminRouter } from "./routes/admin/index.js";
import { requireAuth } from "./http/authMiddleware.js";
import { requireAdmin } from "./http/adminMiddleware.js";
import { reloadGameContent } from "./db/content.js";

// Extracted from a single imperative index.ts into @colyseus/tools' config shape so
// @colyseus/testing's boot() (see WorldRoom.integration.test.ts) can drive the exact same
// room/route definitions a real server run does - no separate test-only duplicate to drift
// out of sync. index.ts itself is now just `listen(appConfig)`.
export default config({
  initializeExpress: (app: express.Express) => {
    // @colyseus/tools already applies its own cors() before this runs (see getTransport) -
    // express.json() is the one thing it doesn't set up for you.
    app.use(express.json());

    app.use("/auth", authRouter);
    app.use("/characters", charactersRouter);
    app.use("/content", contentRouter);
    app.use("/admin", requireAuth, requireAdmin, adminRouter);

    app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    });
  },

  initializeGameServer: (gameServer: Server) => {
    gameServer.define(WORLD_ROOM_NAME, WorldRoom);
    gameServer.define(DUNGEON_ROOM_NAME, DungeonRoom);
  },

  // Game content (classes/spells/items/.../maps/dungeons) is DB-backed and must be loaded
  // into shared/src/types.ts's mutable tables before any room can serve a player - see
  // loadGameContent's contract there. @colyseus/tools' listen() calls this after
  // initializeGameServer but before gameServer.listen(), preserving that ordering.
  beforeListen: async () => {
    await reloadGameContent();
  },
});
