import { Client } from "@colyseus/core";
import { MapSchema } from "@colyseus/schema";
import { GuildRosterSnapshot } from "@mmo/shared";
import * as guildsDb from "../db/guilds.js";
import { isOnline, notifyCharacter } from "../onlineRegistry.js";
import { FriendEntry, Player } from "./schema/WorldState.js";

// Shared SocialCapableRoom logic (see onlineRegistry.ts's own doc comment) - both WorldRoom and
// DungeonRoom implement SocialCapableRoom's methods themselves (the room instance is what
// notifyCharacter's matchMaker lookup treats structurally as a SocialCapableRoom), but each one's
// body just delegates to one of these instead of duplicating the logic.

export function setFriendOnline(player: Player | undefined, characterId: number, online: boolean) {
  const entry = player?.friends.get(String(characterId));
  if (entry) entry.online = online;
}

export function addFriendEntryToPlayer(
  player: Player,
  characterId: number,
  name: string,
  level: number,
  classId: string,
  online: boolean,
) {
  const entry = new FriendEntry();
  entry.characterId = characterId;
  entry.name = name;
  entry.level = level;
  entry.classId = classId;
  entry.online = online;
  player.friends.set(String(characterId), entry);
}

export function removeFriendEntry(player: Player | undefined, characterId: number) {
  player?.friends.delete(String(characterId));
}

export function setGuildFields(player: Player | undefined, guildId: number, guildName: string, guildRole: string) {
  if (!player) return;
  player.guildId = guildId;
  player.guildName = guildName;
  player.guildRole = guildRole;
}

export interface GuildCapableRoom {
  state: { players: MapSchema<Player> };
  characterIdBySession: Map<string, number>;
}

export async function handleGuildLeave(room: GuildCapableRoom, client: Client) {
  const player = room.state.players.get(client.sessionId);
  const characterId = room.characterIdBySession.get(client.sessionId);
  if (!player || characterId === undefined) return;
  if (player.guildId === 0) return;

  const guildId = player.guildId;
  const guildName = player.guildName;
  const wasLeader = player.guildRole === "leader";
  await guildsDb.removeGuildMember(characterId);
  player.guildId = 0;
  player.guildName = "";
  player.guildRole = "";

  if (wasLeader) {
    const promotedId = await guildsDb.promoteNextMemberAsLeader(guildId);
    if (promotedId === null) {
      await guildsDb.deleteGuild(guildId);
    } else {
      notifyCharacter(promotedId, (r, sid) => r.applyGuildFieldsChange(sid, guildId, guildName, "leader"));
    }
  }
}

export async function handleGuildRosterRequest(room: GuildCapableRoom, client: Client) {
  const player = room.state.players.get(client.sessionId);
  if (!player || player.guildId === 0) return;

  const members = await guildsDb.listGuildMembers(player.guildId);
  const snapshot: GuildRosterSnapshot = {
    guildId: player.guildId,
    guildName: player.guildName,
    members: members.map((m) => ({
      characterId: m.character_id,
      name: m.name,
      level: m.level,
      classId: m.class_id,
      role: m.role,
      online: isOnline(m.character_id),
    })),
  };
  client.send("guild_roster", snapshot);
}
