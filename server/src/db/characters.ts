import { BASE_STATS, ClassId, MAIN_STAT_START_BONUS, PlayerStats } from "@mmo/shared";
import { pool } from "./client.js";

export function createInitialStats(): PlayerStats {
  return { ...BASE_STATS, mainStat: BASE_STATS.mainStat + MAIN_STAT_START_BONUS };
}

export interface CharacterRow {
  id: number;
  user_id: number;
  name: string;
  class_id: string;
  level: number;
  xp: number;
  main_stat: number;
  vitality: number;
  luck: number;
  armor: number;
  gold: number;
  talent_points: number;
  talent_ranks: unknown;
  quest_progress: unknown;
  quest_completed: unknown;
  created_at: Date;
}

export async function listCharacters(userId: number): Promise<CharacterRow[]> {
  const { rows } = await pool.query<CharacterRow>(
    "SELECT * FROM characters WHERE user_id = $1 ORDER BY created_at ASC",
    [userId],
  );
  return rows;
}

export async function getCharacterForUser(characterId: number, userId: number): Promise<CharacterRow | null> {
  const { rows } = await pool.query<CharacterRow>(
    "SELECT * FROM characters WHERE id = $1 AND user_id = $2",
    [characterId, userId],
  );
  return rows[0] ?? null;
}

export async function findCharacterByName(name: string): Promise<CharacterRow | null> {
  const { rows } = await pool.query<CharacterRow>("SELECT * FROM characters WHERE name = $1", [name]);
  return rows[0] ?? null;
}

// Unlike getCharacterForUser, deliberately not scoped to a userId - used by friend/guild flows
// (see db/friends.ts's/db/guilds.ts's own callers in WorldRoom) to resolve the OTHER side of an
// action from a bare character id, which by definition belongs to a different account.
export async function getCharacterById(characterId: number): Promise<CharacterRow | null> {
  const { rows } = await pool.query<CharacterRow>("SELECT * FROM characters WHERE id = $1", [characterId]);
  return rows[0] ?? null;
}

export async function createCharacter(userId: number, name: string, classId: ClassId): Promise<CharacterRow> {
  const stats = createInitialStats();
  const { rows } = await pool.query<CharacterRow>(
    `INSERT INTO characters (user_id, name, class_id, main_stat, vitality, luck, armor)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [userId, name, classId, stats.mainStat, stats.vitality, stats.luck, stats.armor],
  );
  return rows[0];
}

export async function saveCharacterProgress(
  characterId: number,
  progress: {
    level: number;
    xp: number;
    stats: PlayerStats;
    gold: number;
    talentPoints: number;
    talentRanks: Record<string, number>;
    questProgress: Record<string, number>;
    questCompleted: Record<string, number>;
  },
): Promise<void> {
  await pool.query(
    `UPDATE characters SET
       level = $1, xp = $2, main_stat = $3, vitality = $4, luck = $5, armor = $6, gold = $7,
       talent_points = $8, talent_ranks = $9, quest_progress = $10, quest_completed = $11
     WHERE id = $12`,
    [
      progress.level,
      progress.xp,
      progress.stats.mainStat,
      progress.stats.vitality,
      progress.stats.luck,
      progress.stats.armor,
      progress.gold,
      progress.talentPoints,
      JSON.stringify(progress.talentRanks),
      JSON.stringify(progress.questProgress),
      JSON.stringify(progress.questCompleted),
      characterId,
    ],
  );
}
