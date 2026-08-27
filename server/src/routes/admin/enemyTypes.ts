import { z } from "zod";
import { countWhere } from "../../db/client.js";
import { createCrudRouter } from "../../http/createCrudRouter.js";

const enemyTypeSchema = z.object({
  id: z.string().min(1).max(32),
  name: z.string().min(1).max(64),
  behavior: z.enum(["melee", "caster", "boss"]),
  xp_reward: z.number().int().nonnegative(),
  gold_reward: z.number().int().nonnegative(),
  // Shape depends on behavior (MeleeStats/CasterStats/BossStats in shared/src/types.ts) -
  // validated loosely here as a plain record rather than a discriminated union per behavior,
  // to keep this one schema simple; CombatEngine casts to the specific shape it expects based
  // on the enemy's behavior at read time. Values aren't all numbers - BossStats nests arrays
  // (specialAbilities, addSpawns), so z.unknown() is required, not z.number().
  stats: z.record(z.string(), z.unknown()),
  // Picks a character model (see client/src/game/Enemy.ts's MODEL_CONFIG) - unset/unrecognized
  // falls back to the original shared goblin, same optionality as structures' model_id.
  model_id: z.string().max(64).nullable().optional(),
});
const updateSchema = enemyTypeSchema.omit({ id: true }).partial();

export const enemyTypesRouter = createCrudRouter("enemy_types", {
  createSchema: enemyTypeSchema,
  updateSchema,
  jsonColumns: ["stats"],
  checkDeletable: async (id) => {
    const [spawnCount, zoneCount, questCount] = await Promise.all([
      countWhere("enemy_spawns", "enemy_type_id = $1", [id]),
      countWhere("enemy_spawn_zone_types", "enemy_type_id = $1", [id]),
      countWhere("quests", "objective_enemy_type_id = $1", [id]),
    ]);
    if (spawnCount > 0) return `${spawnCount} spawn point(s) use this enemy type - delete or reassign them first`;
    if (zoneCount > 0) return `${zoneCount} spawn zone(s) include this enemy type - remove it from their pool first`;
    if (questCount > 0) return `${questCount} quest(s) target this enemy type - reassign or delete them first`;
    return null;
  },
});
