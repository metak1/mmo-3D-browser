// One-off CLI to bootstrap the first admin - no self-service promotion path exists on
// purpose. Usage: node scripts/make-admin.mjs <username>
import pg from "pg";

try {
  process.loadEnvFile();
} catch {
  // no .env file present (e.g. production) - real environment variables are used instead
}

const username = process.argv[2];
if (!username) {
  console.error("Usage: node scripts/make-admin.mjs <username>");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const { rows } = await pool.query("SELECT id FROM users WHERE username = $1", [username]);
const user = rows[0];
if (!user) {
  console.error(`No user found with username "${username}"`);
  await pool.end();
  process.exit(1);
}

await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [user.id]);
console.log(`${username} is now an admin.`);
await pool.end();
