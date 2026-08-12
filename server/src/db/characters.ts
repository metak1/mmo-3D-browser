import { BASE_STATS, ClassId, MAIN_STAT_START_BONUS, PlayerStats } from "@mmo/shared";
import { prisma } from "./client.js";

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
  talent_points: number;
  talent_ranks: unknown;
  quest_progress: unknown;
  quest_completed: unknown;
  created_at: Date;
}

export async function listCharacters(userId: number): Promise<CharacterRow[]> {
  return prisma.character.findMany({
    where: { user_id: userId },
    orderBy: { created_at: "asc" },
  });
}

export async function getCharacterForUser(characterId: number, userId: number): Promise<CharacterRow | null> {
  return prisma.character.findFirst({ where: { id: characterId, user_id: userId } });
}

export async function findCharacterByName(name: string): Promise<CharacterRow | null> {
  return prisma.character.findUnique({ where: { name } });
}

export async function createCharacter(userId: number, name: string, classId: ClassId): Promise<CharacterRow> {
  const stats = createInitialStats();
  return prisma.character.create({
    data: {
      user_id: userId,
      name,
      class_id: classId,
      main_stat: stats.mainStat,
      vitality: stats.vitality,
      luck: stats.luck,
      armor: stats.armor,
    },
  });
}

export async function saveCharacterProgress(
  characterId: number,
  progress: {
    level: number;
    xp: number;
    stats: PlayerStats;
    talentPoints: number;
    talentRanks: Record<string, number>;
    questProgress: Record<string, number>;
    questCompleted: Record<string, number>;
  },
): Promise<void> {
  await prisma.character.update({
    where: { id: characterId },
    data: {
      level: progress.level,
      xp: progress.xp,
      main_stat: progress.stats.mainStat,
      vitality: progress.stats.vitality,
      luck: progress.stats.luck,
      armor: progress.stats.armor,
      talent_points: progress.talentPoints,
      talent_ranks: progress.talentRanks,
      quest_progress: progress.questProgress,
      quest_completed: progress.questCompleted,
    },
  });
}
