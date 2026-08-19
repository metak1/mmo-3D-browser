import "../env.js";
import pg from "pg";

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Postgres returns COUNT(*) as a bigint (driver default: string, to avoid precision loss above
// 2^53) - every caller here just needs a plain number for a `> 0` check.
export async function countWhere(table: string, whereSql: string, params: unknown[]): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(`SELECT COUNT(*) FROM ${table} WHERE ${whereSql}`, params);
  return Number(rows[0].count);
}

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}
