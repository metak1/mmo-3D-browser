-- Crafting should grant profession xp the same way gathering does (gathering_node_types already
-- has xp_award) - missed on the initial recipes table.
ALTER TABLE "recipes" ADD COLUMN "xp_award" INTEGER NOT NULL DEFAULT 20;
