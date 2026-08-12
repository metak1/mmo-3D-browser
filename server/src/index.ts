import "./env.js";
import { createServer } from "http";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { WORLD_ROOM_NAME } from "@mmo/shared";
import { WorldRoom } from "./rooms/WorldRoom.js";
import { authRouter } from "./routes/auth.js";
import { charactersRouter } from "./routes/characters.js";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/auth", authRouter);
app.use("/characters", charactersRouter);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define(WORLD_ROOM_NAME, WorldRoom);

const port = Number(process.env.PORT ?? 2567);

gameServer
  .listen(port)
  .then(() => {
    console.log(`Colyseus server listening on ws://localhost:${port}`);
  })
  .catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
