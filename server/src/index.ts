import { createServer } from "http";
import express from "express";
import cors from "cors";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { WORLD_ROOM_NAME } from "@mmo/shared";
import { WorldRoom } from "./rooms/WorldRoom.js";

const app = express();
app.use(cors());

const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define(WORLD_ROOM_NAME, WorldRoom);

const port = Number(process.env.PORT ?? 2567);
gameServer.listen(port).then(() => {
  console.log(`Colyseus server listening on ws://localhost:${port}`);
});
