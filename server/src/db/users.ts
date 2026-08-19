import { pool } from "./client.js";

export interface UserRow {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  role: string;
  created_at: Date;
}

export async function createUser(username: string, email: string, passwordHash: string): Promise<UserRow> {
  const { rows } = await pool.query<UserRow>(
    "INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING *",
    [username, email, passwordHash],
  );
  return rows[0];
}

export async function findUserByUsername(username: string): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>("SELECT * FROM users WHERE username = $1", [username]);
  return rows[0] ?? null;
}

export async function findUserById(id: number): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>("SELECT * FROM users WHERE id = $1", [id]);
  return rows[0] ?? null;
}

// A fresh DB lookup (not embedded in the JWT) so a role change takes effect on the very next
// request rather than waiting out the token's expiry - selects only `role`, since this runs on
// every /admin/* request and the caller doesn't need the rest of the row.
export async function findUserRoleById(id: number): Promise<string | null> {
  const { rows } = await pool.query<{ role: string }>("SELECT role FROM users WHERE id = $1", [id]);
  return rows[0]?.role ?? null;
}
