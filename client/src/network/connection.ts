import { Client, Room, getStateCallbacks } from "colyseus.js";
import { WORLD_ROOM_NAME } from "@mmo/shared";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:2567";

export async function connectToWorld() {
  const client = new Client(SERVER_URL);
  const room: Room = await client.joinOrCreate(WORLD_ROOM_NAME);
  const $ = getStateCallbacks(room);
  return { room, $ };
}
