import { prisma } from "./client.js";

export interface UserRow {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  role: string;
  created_at: Date;
}

export async function createUser(username: string, email: string, passwordHash: string): Promise<UserRow> {
  return prisma.user.create({
    data: { username, email, password_hash: passwordHash },
  });
}

export async function findUserByUsername(username: string): Promise<UserRow | null> {
  return prisma.user.findUnique({ where: { username } });
}

export async function findUserById(id: number): Promise<UserRow | null> {
  return prisma.user.findUnique({ where: { id } });
}

// A fresh DB lookup (not embedded in the JWT) so a role change takes effect on the very next
// request rather than waiting out the token's expiry - selects only `role`, since this runs on
// every /admin/* request and the caller doesn't need the rest of the row.
export async function findUserRoleById(id: number): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  return user?.role ?? null;
}
