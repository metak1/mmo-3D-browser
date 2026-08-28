-- Presence marks an NPC as a profession trainer - see shared's NpcDef.teachesProfessionId and
-- WorldRoom.handleLearnProfession's new NPC-gated learn flow.
ALTER TABLE "npcs" ADD COLUMN "teaches_profession_id" VARCHAR(16);
