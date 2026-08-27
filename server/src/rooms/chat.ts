import { Client } from "@colyseus/core";
import { MapSchema } from "@colyseus/schema";
import { CHAT_MAX_LENGTH, ChatBroadcast, ChatMessage } from "@mmo/shared";
import { Player } from "./schema/WorldState.js";

// WorldRoom and DungeonRoom both need this exact behavior - small enough (and important
// enough to keep byte-for-byte identical between the two) that a shared function beats
// either duplicating it or building a class for something this size.
interface ChatCapableRoom {
  state: { players: MapSchema<Player> };
  clients: { getById(sessionId: string): Client | undefined };
  broadcast(type: string, payload: unknown): void;
}

export function handleChatMessage(room: ChatCapableRoom, client: Client, message: ChatMessage) {
  const player = room.state.players.get(client.sessionId);
  if (!player) return;
  if (message.channel !== "say" && message.channel !== "party" && message.channel !== "guild") return;

  const text = message.text.trim().slice(0, CHAT_MAX_LENGTH);
  if (!text) return;

  // A party/guild send with no party/guild is rejected outright, not silently downgraded to
  // "say" - that would leak a message the sender thought was scoped to their group.
  if (message.channel === "party" && !player.partyId) return;
  if (message.channel === "guild" && player.guildId === 0) return;

  const payload: ChatBroadcast = {
    channel: message.channel,
    senderName: player.name,
    senderSessionId: client.sessionId,
    text,
    sentAt: Date.now(),
  };

  if (message.channel === "party") {
    for (const [sessionId, other] of room.state.players) {
      if (other.partyId !== player.partyId) continue;
      room.clients.getById(sessionId)?.send("chat", payload);
    }
  } else if (message.channel === "guild") {
    // Guild chat is room-scoped only, same pre-existing limitation party chat already has - a
    // guildmate in a different room instance (overworld vs. a dungeon) doesn't receive it either.
    for (const [sessionId, other] of room.state.players) {
      if (other.guildId !== player.guildId) continue;
      room.clients.getById(sessionId)?.send("chat", payload);
    }
  } else {
    room.broadcast("chat", payload);
  }
}
