import { prisma } from "./client.js";

export interface UserRow {
  id: number;
  username: string;
  email: string;
  password_hash: string;
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
