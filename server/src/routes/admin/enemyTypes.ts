import { z } from "zod";
import { prisma } from "../../db/client.js";
import { createCrudRouter } from "../../http/createCrudRouter.js";

const enemyTypeSchema = z.object({
  id: z.string().min(1).max(32),
  name: z.string().min(1).max(64),
  behavior: z.enum(["melee", "caster", "boss"]),
  xp_reward: z.number().int().nonnegative(),
  gold_reward: z.number().int().nonnegative(),
  // Shape depends on behavior (MeleeStats/CasterStats/BossStats in shared/src/types.ts) -
  // validated loosely here as a flat numeric record rather than a discriminated union per
  // behavior, to keep this one schema simple; CombatEngine casts to the specific shape it
  // expects based on the enemy's behavior at read time.
  stats: z.record(z.string(), z.number()),
});
const updateSchema = enemyTypeSchema.omit({ id: true }).partial();

export const enemyTypesRouter = createCrudRouter(prisma.enemyType, {
  createSchema: enemyTypeSchema,
  updateSchema,
  checkDeletable: async (id) => {
    const [spawnCount, questCount] = await Promise.all([
      prisma.enemySpawn.count({ where: { enemy_type_id: id } }),
      prisma.quest.count({ where: { objective_enemy_type_id: id } }),
    ]);
    if (spawnCount > 0) return `${spawnCount} spawn point(s) use this enemy type - delete or reassign them first`;
    if (questCount > 0) return `${questCount} quest(s) target this enemy type - reassign or delete them first`;
    return null;
  },
});
