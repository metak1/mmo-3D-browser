import { matchMaker } from "@colyseus/core";

// A Colyseus room only ever knows about its own connected clients - it has no idea whether a
// given character is online in a DIFFERENT room instance (the overworld vs. one of possibly
// several concurrent dungeon instances). This is the single process-wide place that knows "is
// character X online, and if so, in which room" - a plain in-memory Map is enough since this
// project runs a single Node process (no Redis/multi-instance presence needed - matches how
// matchMaker itself is already used directly elsewhere, e.g. WorldRoom.handleDungeonStart).
export interface OnlineEntry {
  sessionId: string;
  roomId: string; // this.roomId of whichever WorldRoom/DungeonRoom instance holds this character
  characterId: number;
  name: string;
  level: number;
  classId: string;
}

// The subset of room behavior notifyCharacter needs to reach into - implemented near-identically
// by WorldRoom and DungeonRoom as a handful of small private methods (same "each room keeps its
// own copy" precedent as chat.ts's ChatCapableRoom / DungeonRoom's own rejectAction).
export interface SocialCapableRoom {
  applyFriendOnlineChange(sessionId: string, characterId: number, online: boolean): void;
  applyFriendRequestPush(sessionId: string, entry: { requestId: number; fromCharacterId: number; fromName: string }): void;
  applyFriendAdded(sessionId: string, entry: { characterId: number; name: string; level: number; classId: string; online: boolean }): void;
  applyFriendRemoved(sessionId: string, characterId: number): void;
  applyGuildInvitePush(sessionId: string, entry: { inviteId: number; guildId: number; guildName: string; invitedByName: string }): void;
  applyGuildFieldsChange(sessionId: string, guildId: number, guildName: string, guildRole: string): void;
}

const byCharacterId = new Map<number, OnlineEntry>();

export function registerOnline(entry: OnlineEntry) {
  byCharacterId.set(entry.characterId, entry);
}

export function unregisterOnline(characterId: number) {
  byCharacterId.delete(characterId);
}

export function isOnline(characterId: number): boolean {
  return byCharacterId.has(characterId);
}

export function getOnlineEntry(characterId: number): OnlineEntry | undefined {
  return byCharacterId.get(characterId);
}

// Best-effort nudge to a specific online character, regardless of which room instance currently
// holds their session - every caller treats this purely as a live-UX nicety, never the source of
// truth, since a fresh onJoin always re-derives authoritative friends/guild state from the DB
// (see WorldRoom.onJoin). A missed notification here (room gone, race with a disconnect) just
// means the recipient's client stays stale until their next join/refresh instead of updating live.
export function notifyCharacter(characterId: number, apply: (room: SocialCapableRoom, sessionId: string) => void): void {
  const entry = byCharacterId.get(characterId);
  if (!entry) return;
  const room = matchMaker.getLocalRoomById(entry.roomId);
  if (!room) return;
  apply(room as unknown as SocialCapableRoom, entry.sessionId);
}
