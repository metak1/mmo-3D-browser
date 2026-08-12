import { pool } from "./pool.js";

export interface UserRow {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  created_at: string;
}

export async function createUser(username: string, email: string, passwordHash: string): Promise<UserRow> {
  const result = await pool.query<UserRow>(
    `INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING *`,
    [username, email, passwordHash],
  );
  return result.rows[0];
}

export async function findUserByUsername(username: string): Promise<UserRow | null> {
  const result = await pool.query<UserRow>(`SELECT * FROM users WHERE username = $1`, [username]);
  return result.rows[0] ?? null;
}

export async function findUserById(id: number): Promise<UserRow | null> {
  const result = await pool.query<UserRow>(`SELECT * FROM users WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}
