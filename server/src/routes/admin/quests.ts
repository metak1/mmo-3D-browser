import { z } from "zod";
import { createCrudRouter } from "../../http/createCrudRouter.js";

const questSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(255),
  giver_npc_id: z.string().min(1).max(32),
  objective_enemy_type_id: z.string().min(1).max(32),
  objective_count: z.number().int().positive(),
  reward_xp: z.number().int().nonnegative(),
  reward_item_id: z.string().max(32).nullable().optional(),
});
const updateSchema = questSchema.omit({ id: true }).partial();

// No checkDeletable - Character.quest_progress/quest_completed are JSON maps keyed by quest
// id; a stale entry for a deleted quest is simply never matched again, same graceful-orphan
// pattern as talents.
export const questsRouter = createCrudRouter("quests", { createSchema: questSchema, updateSchema });
