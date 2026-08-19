// Applies every migrations/<name>/migration.sql not yet recorded in _migrations, in directory
// order, each inside its own transaction. Run via `npm run db:migrate` (or db:deploy - same
// script, there's no separate shadow-database dev-mode step without Prisma).
import "../src/env.js";
import { readdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "..", "migrations");

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(
      "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    const { rows } = await pool.query<{ name: string }>("SELECT name FROM _migrations");
    const applied = new Set(rows.map((r) => r.name));

    const names = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    for (const name of names) {
      if (applied.has(name)) continue;
      const sql = readFileSync(join(migrationsDir, name, "migration.sql"), "utf8");
      console.log(`Applying migration ${name}`);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO _migrations (name) VALUES ($1)", [name]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }
    console.log("Database is up to date.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
