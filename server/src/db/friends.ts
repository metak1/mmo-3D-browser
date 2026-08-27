import { pool } from "./client.js";

export interface FriendRow {
  character_id: number;
  name: string;
  level: number;
  class_id: string;
}

export interface FriendRequestRow {
  id: number;
  from_character_id: number;
  from_name: string;
}

// Friends are looked up from either side of the canonical (a < b) row - see the migration's own
// comment on why friendships never has two mirrored rows for the same pair.
export async function listFriends(characterId: number): Promise<FriendRow[]> {
  const { rows } = await pool.query<FriendRow>(
    `SELECT c.id AS character_id, c.name, c.level, c.class_id
     FROM friendships f
     JOIN characters c ON c.id = CASE WHEN f.character_id_a = $1 THEN f.character_id_b ELSE f.character_id_a END
     WHERE f.character_id_a = $1 OR f.character_id_b = $1`,
    [characterId],
  );
  return rows;
}

export async function listIncomingFriendRequests(characterId: number): Promise<FriendRequestRow[]> {
  const { rows } = await pool.query<FriendRequestRow>(
    `SELECT r.id, r.from_character_id, c.name AS from_name
     FROM friend_requests r
     JOIN characters c ON c.id = r.from_character_id
     WHERE r.to_character_id = $1
     ORDER BY r.created_at ASC`,
    [characterId],
  );
  return rows;
}

// Used by WorldRoom.handleFriendRequest to auto-accept instead of creating a redundant reverse
// row when the target already sent *you* a request.
export async function findRequestBetween(fromId: number, toId: number): Promise<{ id: number } | null> {
  const { rows } = await pool.query<{ id: number }>(
    "SELECT id FROM friend_requests WHERE from_character_id = $1 AND to_character_id = $2",
    [fromId, toId],
  );
  return rows[0] ?? null;
}

// May reject with a unique-violation (see client.ts's isUniqueViolation) if a request between
// this pair already exists - the DB's own unique index is the source of truth for "already
// pending", not a racy pre-check-then-insert.
export async function createFriendRequest(fromId: number, toId: number): Promise<{ id: number }> {
  const { rows } = await pool.query<{ id: number }>(
    "INSERT INTO friend_requests (from_character_id, to_character_id) VALUES ($1, $2) RETURNING id",
    [fromId, toId],
  );
  return rows[0];
}

export async function getFriendRequestById(
  id: number,
): Promise<{ id: number; from_character_id: number; to_character_id: number } | null> {
  const { rows } = await pool.query<{ id: number; from_character_id: number; to_character_id: number }>(
    "SELECT id, from_character_id, to_character_id FROM friend_requests WHERE id = $1",
    [id],
  );
  return rows[0] ?? null;
}

export async function deleteFriendRequest(id: number): Promise<void> {
  await pool.query("DELETE FROM friend_requests WHERE id = $1", [id]);
}

export async function areFriends(a: number, b: number): Promise<boolean> {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  const { rows } = await pool.query("SELECT 1 FROM friendships WHERE character_id_a = $1 AND character_id_b = $2", [lo, hi]);
  return rows.length > 0;
}

// Canonicalizes (min, max) internally - callers never need to know/care about ordering.
export async function addFriendship(a: number, b: number): Promise<void> {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  await pool.query("INSERT INTO friendships (character_id_a, character_id_b) VALUES ($1, $2)", [lo, hi]);
}

export async function removeFriendship(a: number, b: number): Promise<void> {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  await pool.query("DELETE FROM friendships WHERE character_id_a = $1 AND character_id_b = $2", [lo, hi]);
}
