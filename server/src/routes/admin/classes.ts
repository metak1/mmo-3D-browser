import { z } from "zod";
import { prisma } from "../../db/client.js";
import { createCrudRouter } from "../../http/createCrudRouter.js";

const classSchema = z.object({
  id: z.string().min(1).max(32),
  name: z.string().min(1).max(64),
  main_stat: z.enum(["strength", "dexterity", "intellect"]),
  role: z.enum(["tank", "healer", "dps"]),
});
const updateSchema = classSchema.omit({ id: true }).partial();

export const classesRouter = createCrudRouter(prisma.gameClass, {
  createSchema: classSchema,
  updateSchema,
  checkDeletable: async (id) => {
    const [characterCount, spellCount, talentCount] = await Promise.all([
      prisma.character.count({ where: { class_id: id } }),
      prisma.spell.count({ where: { class_id: id } }),
      prisma.talent.count({ where: { class_id: id } }),
    ]);
    if (characterCount > 0) return `${characterCount} character(s) use this class`;
    if (spellCount > 0) return `${spellCount} spell(s) belong to this class - delete or reassign them first`;
    if (talentCount > 0) return `${talentCount} talent(s) belong to this class - delete or reassign them first`;
    return null;
  },
});
