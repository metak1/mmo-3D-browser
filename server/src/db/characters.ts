import { BASE_STATS, CLASSES, ClassId, MAIN_STAT_START_BONUS, PlayerStats } from "@mmo/shared";
import { pool } from "./pool.js";

export function createInitialStats(classId: ClassId): PlayerStats {
  const stats: PlayerStats = { ...BASE_STATS };
  const mainStat = CLASSES[classId].mainStat;
  stats[mainStat] += MAIN_STAT_START_BONUS;
  return stats;
}

export interface CharacterRow {
  id: number;
  user_id: number;
  name: string;
  class_id: string;
  level: number;
  xp: number;
  strength: number;
  dexterity: number;
  intellect: number;
  vitality: number;
  luck: number;
  armor: number;
  created_at: string;
}

export async function listCharacters(userId: number): Promise<CharacterRow[]> {
  const result = await pool.query<CharacterRow>(
    `SELECT * FROM characters WHERE user_id = $1 ORDER BY created_at ASC`,
    [userId],
  );
  return result.rows;
}

export async function getCharacterForUser(characterId: number, userId: number): Promise<CharacterRow | null> {
  const result = await pool.query<CharacterRow>(`SELECT * FROM characters WHERE id = $1 AND user_id = $2`, [
    characterId,
    userId,
  ]);
  return result.rows[0] ?? null;
}

export async function findCharacterByName(name: string): Promise<CharacterRow | null> {
  const result = await pool.query<CharacterRow>(`SELECT * FROM characters WHERE name = $1`, [name]);
  return result.rows[0] ?? null;
}

export async function createCharacter(userId: number, name: string, classId: ClassId): Promise<CharacterRow> {
  const stats = createInitialStats(classId);
  const result = await pool.query<CharacterRow>(
    `INSERT INTO characters (user_id, name, class_id, strength, dexterity, intellect, vitality, luck, armor)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [userId, name, classId, stats.strength, stats.dexterity, stats.intellect, stats.vitality, stats.luck, stats.armor],
  );
  return result.rows[0];
}

export async function saveCharacterProgress(
  characterId: number,
  progress: { level: number; xp: number; stats: PlayerStats },
): Promise<void> {
  await pool.query(
    `UPDATE characters
     SET level = $2, xp = $3, strength = $4, dexterity = $5, intellect = $6, vitality = $7, luck = $8, armor = $9
     WHERE id = $1`,
    [
      characterId,
      progress.level,
      progress.xp,
      progress.stats.strength,
      progress.stats.dexterity,
      progress.stats.intellect,
      progress.stats.vitality,
      progress.stats.luck,
      progress.stats.armor,
    ],
  );
}
