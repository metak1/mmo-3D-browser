import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { pool } from "./pool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function initDb() {
  const schema = readFileSync(join(__dirname, "schema.sql"), "utf-8");
  await pool.query(schema);
}
