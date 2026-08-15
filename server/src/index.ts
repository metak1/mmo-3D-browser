import "./env.js";
import { createServer } from "http";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
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

const app = express();
app.use(cors());
app.use(express.json());

app.use("/auth", authRouter);
app.use("/characters", charactersRouter);
app.use("/content", contentRouter);
app.use("/admin", requireAuth, requireAdmin, adminRouter);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define(WORLD_ROOM_NAME, WorldRoom);
gameServer.define(DUNGEON_ROOM_NAME, DungeonRoom);

const port = Number(process.env.PORT ?? 2567);

// Game content (classes/spells/items/.../maps/dungeons) is DB-backed and must be loaded into
// shared/src/types.ts's mutable tables before any room can serve a player - see
// loadGameContent's contract there for why this has to complete before gameServer.listen().
reloadGameContent()
  .then(() =>
    gameServer.listen(port).then(() => {
      console.log(`Colyseus server listening on ws://localhost:${port}`);
    }),
  )
  .catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
