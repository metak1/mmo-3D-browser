-- CreateTable
-- One canonical row per friendship, never two mirrored rows - character_id_a is always the
-- smaller id (enforced by the CHECK below and by db/friends.ts's own canonicalization on write,
-- never left to the caller), so unfriending is a single atomic DELETE and there's no way for a
-- pair of rows to drift out of sync.
CREATE TABLE "friendships" (
    "character_id_a" INTEGER NOT NULL,
    "character_id_b" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "friendships_pkey" PRIMARY KEY ("character_id_a","character_id_b"),
    CONSTRAINT "friendships_canonical_order" CHECK ("character_id_a" < "character_id_b")
);

-- CreateTable
CREATE TABLE "friend_requests" (
    "id" SERIAL NOT NULL,
    "from_character_id" INTEGER NOT NULL,
    "to_character_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "friend_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- Deliberately no leader_character_id column here - leadership lives solely in
-- guild_members.role, enforced by a partial unique index below so a guild can never end up with
-- zero or two leaders (a separate column here would be a second, potentially disagreeing source
-- of truth).
CREATE TABLE "guilds" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "guilds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- character_id is the actual primary key (not part of a composite key) - this single choice is
-- what enforces "one guild per character" at the DB level, the same way friendships' CHECK
-- constraint enforces its own invariant structurally rather than in application code.
CREATE TABLE "guild_members" (
    "character_id" INTEGER NOT NULL,
    "guild_id" INTEGER NOT NULL,
    "role" VARCHAR(16) NOT NULL DEFAULT 'member',
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "guild_members_pkey" PRIMARY KEY ("character_id")
);

-- CreateTable
CREATE TABLE "guild_invites" (
    "id" SERIAL NOT NULL,
    "guild_id" INTEGER NOT NULL,
    "character_id" INTEGER NOT NULL,
    "invited_by_character_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "guild_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "friendships_character_id_b_idx" ON "friendships"("character_id_b");

-- CreateIndex
CREATE UNIQUE INDEX "friend_requests_from_to_key" ON "friend_requests"("from_character_id", "to_character_id");

-- CreateIndex
CREATE INDEX "friend_requests_to_character_id_idx" ON "friend_requests"("to_character_id");

-- CreateIndex
CREATE UNIQUE INDEX "guilds_name_key" ON "guilds"("name");

-- CreateIndex
CREATE UNIQUE INDEX "guild_members_one_leader_idx" ON "guild_members"("guild_id") WHERE "role" = 'leader';

-- CreateIndex
CREATE INDEX "guild_members_guild_id_idx" ON "guild_members"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "guild_invites_guild_character_key" ON "guild_invites"("guild_id", "character_id");

-- CreateIndex
CREATE INDEX "guild_invites_character_id_idx" ON "guild_invites"("character_id");

-- AddForeignKey
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_character_id_a_fkey" FOREIGN KEY ("character_id_a") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_character_id_b_fkey" FOREIGN KEY ("character_id_b") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friend_requests" ADD CONSTRAINT "friend_requests_from_character_id_fkey" FOREIGN KEY ("from_character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friend_requests" ADD CONSTRAINT "friend_requests_to_character_id_fkey" FOREIGN KEY ("to_character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guild_members" ADD CONSTRAINT "guild_members_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guild_members" ADD CONSTRAINT "guild_members_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guild_invites" ADD CONSTRAINT "guild_invites_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guild_invites" ADD CONSTRAINT "guild_invites_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guild_invites" ADD CONSTRAINT "guild_invites_invited_by_character_id_fkey" FOREIGN KEY ("invited_by_character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
