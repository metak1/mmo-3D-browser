-- hasMount is the permanent unlock (see WorldRoom.handleTurnInQuest granting it on
-- QuestDef.rewardGrantsMount); the on/off toggle itself is runtime-only, never persisted.
ALTER TABLE "characters" ADD COLUMN "has_mount" BOOLEAN NOT NULL DEFAULT false;

-- Presence marks a quest as one that grants the mount unlock on turn-in.
ALTER TABLE "quests" ADD COLUMN "reward_grants_mount" BOOLEAN NOT NULL DEFAULT false;
