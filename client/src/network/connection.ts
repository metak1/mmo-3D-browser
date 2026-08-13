import { Client, Room, SeatReservation, getStateCallbacks } from "colyseus.js";
import { WORLD_ROOM_NAME } from "@mmo/shared";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:2567";

export async function connectToWorld(token: string, characterId: number) {
  const client = new Client(SERVER_URL);
  const room: Room = await client.joinOrCreate(WORLD_ROOM_NAME, { token, characterId });
  const $ = getStateCallbacks(room);
  return { room, $ };
}

// Used to return from a dungeon: the overworld isn't a fresh instance, so a normal
// joinOrCreate (not a reservation) is all that's needed - kept as a separate name purely
// for readability at call sites now that a second room type exists.
export const returnToWorld = connectToWorld;

// The dungeon room is a fresh instance reserved specifically for one party (see
// WorldRoom.handleDungeonStart) - the client must join with that exact reservation rather
// than matchmaking normally, or it would land in an unrelated/new dungeon instance.
export async function consumeDungeonReservation(reservation: SeatReservation) {
  const client = new Client(SERVER_URL);
  const room: Room = await client.consumeSeatReservation(reservation);
  const $ = getStateCallbacks(room);
  return { room, $ };
}
