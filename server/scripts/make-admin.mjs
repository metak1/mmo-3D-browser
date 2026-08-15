// One-off CLI to bootstrap the first admin - no self-service promotion path exists on
// purpose. Usage: node scripts/make-admin.mjs <username>
import { PrismaClient } from "@prisma/client";

const username = process.argv[2];
if (!username) {
  console.error("Usage: node scripts/make-admin.mjs <username>");
  process.exit(1);
}

const prisma = new PrismaClient();

const user = await prisma.user.findUnique({ where: { username } });
if (!user) {
  console.error(`No user found with username "${username}"`);
  await prisma.$disconnect();
  process.exit(1);
}

await prisma.user.update({ where: { id: user.id }, data: { role: "admin" } });
console.log(`${username} is now an admin.`);
await prisma.$disconnect();
