import { pool, withTransaction } from "./client.js";

export type GuildRole = "leader" | "member";

export interface GuildRow {
  id: number;
  name: string;
}

export interface GuildMembershipRow {
  guild_id: number;
  guild_name: string;
  role: GuildRole;
}

export interface GuildMemberRow {
  character_id: number;
  role: GuildRole;
  joined_at: Date;
  name: string;
  level: number;
  class_id: string;
}

export interface GuildInviteRow {
  id: number;
  guild_id: number;
  guild_name: string;
  character_id: number;
  invited_by_name: string;
}

// Wrapped in a transaction: creating a guild and seating its first leader must succeed or fail
// together, same reasoning as replaceCharacterItems's own delete+reinsert transaction in
// db/items.ts. May reject with a unique-violation if the name is taken.
export async function createGuild(name: string, leaderCharacterId: number): Promise<GuildRow> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<GuildRow>("INSERT INTO guilds (name) VALUES ($1) RETURNING id, name", [name]);
    const guild = rows[0];
    await client.query("INSERT INTO guild_members (character_id, guild_id, role) VALUES ($1, $2, 'leader')", [
      leaderCharacterId,
      guild.id,
    ]);
    return guild;
  });
}

export async function getGuildForCharacter(characterId: number): Promise<GuildMembershipRow | null> {
  const { rows } = await pool.query<GuildMembershipRow>(
    `SELECT gm.guild_id, g.name AS guild_name, gm.role
     FROM guild_members gm
     JOIN guilds g ON g.id = gm.guild_id
     WHERE gm.character_id = $1`,
    [characterId],
  );
  return rows[0] ?? null;
}

export async function listGuildMembers(guildId: number): Promise<GuildMemberRow[]> {
  const { rows } = await pool.query<GuildMemberRow>(
    `SELECT gm.character_id, gm.role, gm.joined_at, c.name, c.level, c.class_id
     FROM guild_members gm
     JOIN characters c ON c.id = gm.character_id
     WHERE gm.guild_id = $1
     ORDER BY gm.role = 'leader' DESC, gm.joined_at ASC`,
    [guildId],
  );
  return rows;
}

// May reject with a unique-violation if this (guild, character) invite already exists.
export async function createGuildInvite(guildId: number, characterId: number, invitedByCharacterId: number): Promise<{ id: number }> {
  const { rows } = await pool.query<{ id: number }>(
    "INSERT INTO guild_invites (guild_id, character_id, invited_by_character_id) VALUES ($1, $2, $3) RETURNING id",
    [guildId, characterId, invitedByCharacterId],
  );
  return rows[0];
}

export async function listIncomingGuildInvites(characterId: number): Promise<GuildInviteRow[]> {
  const { rows } = await pool.query<GuildInviteRow>(
    `SELECT gi.id, gi.guild_id, g.name AS guild_name, gi.character_id, inviter.name AS invited_by_name
     FROM guild_invites gi
     JOIN guilds g ON g.id = gi.guild_id
     JOIN characters inviter ON inviter.id = gi.invited_by_character_id
     WHERE gi.character_id = $1
     ORDER BY gi.created_at ASC`,
    [characterId],
  );
  return rows;
}

export async function getGuildInviteById(
  id: number,
): Promise<{ id: number; guild_id: number; guild_name: string; character_id: number } | null> {
  const { rows } = await pool.query<{ id: number; guild_id: number; guild_name: string; character_id: number }>(
    `SELECT gi.id, gi.guild_id, g.name AS guild_name, gi.character_id
     FROM guild_invites gi
     JOIN guilds g ON g.id = gi.guild_id
     WHERE gi.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function deleteGuildInvite(id: number): Promise<void> {
  await pool.query("DELETE FROM guild_invites WHERE id = $1", [id]);
}

// Hygiene after an accept - a guildless character could have multiple pending invites from
// different guilds; once they join one, the rest are no longer meaningful.
export async function deleteOtherInvitesForCharacter(characterId: number, exceptInviteId: number): Promise<void> {
  await pool.query("DELETE FROM guild_invites WHERE character_id = $1 AND id != $2", [characterId, exceptInviteId]);
}

// May reject with a unique-violation if the character is already in a guild (character_id is
// guild_members' own primary key) - the DB enforces "one guild per character", not a pre-check.
export async function addGuildMember(guildId: number, characterId: number, role: GuildRole): Promise<void> {
  await pool.query("INSERT INTO guild_members (character_id, guild_id, role) VALUES ($1, $2, $3)", [characterId, guildId, role]);
}

export async function removeGuildMember(characterId: number): Promise<void> {
  await pool.query("DELETE FROM guild_members WHERE character_id = $1", [characterId]);
}

export async function transferLeadership(guildId: number, fromCharacterId: number, toCharacterId: number): Promise<void> {
  await withTransaction(async (client) => {
    // Demote first - the partial unique index (one leader per guild) would otherwise momentarily
    // reject the new leader row while the old one is still marked 'leader'.
    await client.query("UPDATE guild_members SET role = 'member' WHERE character_id = $1 AND guild_id = $2", [
      fromCharacterId,
      guildId,
    ]);
    await client.query("UPDATE guild_members SET role = 'leader' WHERE character_id = $1 AND guild_id = $2", [
      toCharacterId,
      guildId,
    ]);
  });
}

// Picks the longest-standing remaining member to promote after a leader leaves without disbanding
// (the guild still has other members) - returns null if the guild is now empty, meaning the
// caller should delete it instead.
export async function promoteNextMemberAsLeader(guildId: number): Promise<number | null> {
  const { rows } = await pool.query<{ character_id: number }>(
    "SELECT character_id FROM guild_members WHERE guild_id = $1 ORDER BY joined_at ASC LIMIT 1",
    [guildId],
  );
  const next = rows[0];
  if (!next) return null;
  await pool.query("UPDATE guild_members SET role = 'leader' WHERE character_id = $1", [next.character_id]);
  return next.character_id;
}

export async function deleteGuild(guildId: number): Promise<void> {
  await pool.query("DELETE FROM guilds WHERE id = $1", [guildId]);
}
