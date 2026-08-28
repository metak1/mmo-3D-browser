import bcrypt from "bcryptjs";
import { ClassId } from "@mmo/shared";
import { signToken } from "../src/auth/jwt.js";
import { createCharacter } from "../src/db/characters.js";
import { createUser } from "../src/db/users.js";
import { pool } from "../src/db/client.js";

// Integration tests run against the real dev Postgres (same DATABASE_URL the dev server uses) -
// it's already migrated and holds realistic seeded content (items/quests/NPCs) that a meaningful
// integration test needs anyway. Each test creates its own throwaway user+character here and
// deletes them via cleanupTestUser afterward - the same discipline used manually via SQL
// throughout this project's development, now codified as repeatable tests instead of one-off
// scripts.
const TEST_USERNAME_PREFIX = "vitest_";

export interface TestAccount {
  userId: number;
  characterId: number;
  token: string;
}

// The password hash is never actually checked by anything an integration test exercises (tests
// mint a JWT directly via signToken, bypassing the real /auth/login route entirely) - a fixed
// throwaway hash is fine, no need to bcrypt.hash a real random password per test.
let cachedPasswordHash: string | null = null;
async function throwawayPasswordHash(): Promise<string> {
  cachedPasswordHash ??= await bcrypt.hash("vitest-throwaway", 4);
  return cachedPasswordHash;
}

export async function createTestUserAndCharacter(classId: ClassId = "warrior"): Promise<TestAccount> {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const username = `${TEST_USERNAME_PREFIX}${suffix}`;
  const user = await createUser(username, `${username}@test.local`, await throwawayPasswordHash());
  const character = await createCharacter(user.id, `T${suffix.slice(-12)}`, classId);
  const token = signToken({ userId: user.id, username: user.username });
  return { userId: user.id, characterId: character.id, token };
}

// Cascades to the character row (and its items) the same way this project's manual cleanup did
// all session via `DELETE FROM users WHERE username LIKE 'prefix%'`.
export async function cleanupTestUser(userId: number): Promise<void> {
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
}
