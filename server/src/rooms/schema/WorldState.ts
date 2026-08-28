import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";
import { BASE_STATS, DEFAULT_CLASS_ID, VITALITY_TO_HP } from "@mmo/shared";

const BASE_MAX_HP = BASE_STATS.vitality * VITALITY_TO_HP;

// Unlike party (derived on demand from state.players, wiped on disconnect - see Player.partyId's
// own doc comment), friends/guild membership are real DB-persisted player data that must stay
// meaningful even when everyone relevant is offline - so these live as actual synced fields,
// hydrated from the DB at onJoin (see WorldRoom.onJoin), the same way inventory/questProgress
// already are, rather than computed from currently-connected sessions.
export class FriendEntry extends Schema {
  @type("number") characterId = 0;
  @type("string") name = "";
  @type("number") level = 1;
  @type("string") classId = "";
  @type("boolean") online = false;
}

// Pending requests/invites are lists, not a single "pendingXFrom" string field like party/trade
// use - unlike those (which only ever need to track one live in-room inviter at a time), these can
// legitimately queue: multiple people can friend-request you while you're offline, multiple
// guilds can invite the same guildless character.
export class FriendRequestEntry extends Schema {
  @type("number") requestId = 0;
  @type("number") fromCharacterId = 0;
  @type("string") fromName = "";
}

export class GuildInviteEntry extends Schema {
  @type("number") inviteId = 0;
  @type("number") guildId = 0;
  @type("string") guildName = "";
  @type("string") invitedByName = "";
}

// One stack of damage-over-time, from the composable EffectAction "dot" kind (see shared's
// EffectDef) - the first ticked/periodic effect in the codebase; everything else (AilmentKind/
// BuffKind) is a lazy multiplier read once at damage-calculation time, never applied on its own
// schedule. Lives on both Player and Enemy (unlike ailments/buffs, which are Player-only) since a
// player-cast DOT spell needs somewhere to write on an enemy target. See
// CombatEngine.addDot/tickDots for how these are written/swept.
export class DotStack extends Schema {
  @type("string") sourceId = ""; // sessionId or enemyId that applied it - kill credit/threat on each tick
  @type("number") damagePerTick = 0;
  @type("number") tickIntervalMs = 0;
  @type("number") nextTickAt = 0; // epoch ms
  @type("number") expiresAt = 0; // epoch ms
}

export class Player extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") z = 0;
  @type("number") rotationY = 0;
  @type("number") hp = BASE_MAX_HP;
  @type("number") maxHp = BASE_MAX_HP;
  @type("string") castSpellId = "";

  @type("string") name = "";
  @type("string") classId: string = DEFAULT_CLASS_ID;
  @type("number") level = 1;
  @type("number") xp = 0;
  @type("number") mainStat = BASE_STATS.mainStat;
  @type("number") vitality = BASE_STATS.vitality;
  @type("number") luck = BASE_STATS.luck;
  @type("number") armor = BASE_STATS.armor;
  @type("number") gold = 0;

  @type("string") equippedWeapon = "";
  @type("string") equippedOffHand = "";
  @type("string") equippedHead = "";
  @type("string") equippedNeck = "";
  @type("string") equippedShoulders = "";
  @type("string") equippedArmor = "";
  @type("string") equippedHands = "";
  @type("string") equippedWaist = "";
  @type("string") equippedLegs = "";
  @type("string") equippedFeet = "";
  @type("string") equippedRing = "";
  @type("string") equippedTrinket = "";
  @type(["string"]) inventory = new ArraySchema<string>();

  @type("number") talentPoints = 0;
  @type({ map: "number" }) talentRanks = new MapSchema<number>();

  @type({ map: "number" }) ailments = new MapSchema<number>(); // ailment kind -> expiresAt (epoch ms)
  @type({ map: "number" }) buffs = new MapSchema<number>(); // buff kind -> expiresAt (epoch ms) - mirrors ailments, but caster-beneficial (see BuffKind)
  @type([DotStack]) dots = new ArraySchema<DotStack>(); // see DotStack's own doc comment; capped at MAX_DOT_STACKS (CombatEngine.addDot)

  @type({ map: "number" }) questProgress = new MapSchema<number>(); // questId -> kill count
  @type({ map: "number" }) questCompleted = new MapSchema<number>(); // questId -> completedAt (epoch ms)

  // Professions (see shared's ProfessionId/MAX_LEARNED_PROFESSIONS) - presence of a key in
  // professionXp IS "learned" (same convention as talentRanks/questProgress above), capped at
  // MAX_LEARNED_PROFESSIONS entries server-side (WorldRoom.handleLearnProfession).
  @type({ map: "number" }) professionXp = new MapSchema<number>(); // professionId -> xp
  @type({ map: "number" }) professionLevel = new MapSchema<number>(); // professionId -> level (only set once learned)
  // Materials bag - separate from `inventory` above (which is equip-slot items only, rarity-
  // tagged, INVENTORY_SIZE-capped). itemId -> stack count, uncapped, no rarity.
  @type({ map: "number" }) materials = new MapSchema<number>();

  // partyId is the session id of whichever player anchored the group (first inviter);
  // two players are grouped iff both have the same non-empty partyId - no separate Party object.
  @type("string") partyId = "";
  @type("string") pendingPartyInviteFrom = ""; // sessionId of pending inviter, or ""
  @type("string") pendingTradeRequestFrom = ""; // sessionId of pending trade requester, or ""

  @type({ map: FriendEntry }) friends = new MapSchema<FriendEntry>(); // keyed by characterId (as string)
  @type([FriendRequestEntry]) pendingFriendRequests = new ArraySchema<FriendRequestEntry>();

  @type("number") guildId = 0; // 0 = no guild
  @type("string") guildName = "";
  @type("string") guildRole = ""; // "leader" | "member" | "" when guildId is 0
  @type([GuildInviteEntry]) pendingGuildInvites = new ArraySchema<GuildInviteEntry>();

  // hasMount is the permanent unlock (persisted, granted by a quest reward - see
  // handleTurnInQuest); mounted is the current on/off toggle (NOT persisted, always starts false
  // on join, same as castSpellId/combat state never surviving a reconnect).
  @type("boolean") hasMount = false;
  @type("boolean") mounted = false;
}

export class Enemy extends Schema {
  @type("string") enemyTypeId = ""; // admin-authored identity, e.g. "goblin_grunt" - see ENEMY_TYPES
  @type("string") behavior = "melee"; // fixed AI archetype ("melee"|"caster"|"boss"), copied from EnemyTypeDef at spawn
  @type("number") x = 0;
  @type("number") z = 0;
  @type("number") homeX = 0; // spawn position - the center an idle enemy wanders around and leashes back to
  @type("number") homeZ = 0;
  @type("number") wanderRadius = 0; // 0 = use the room's global ENEMY_WANDER_RADIUS; set from EnemySpawnZoneDef.wanderRadius for zone-spawned enemies
  @type("number") leashRange = 0; // 0 = use the room's global ENEMY_LEASH_RANGE; set from EnemySpawnZoneDef.leashRange for zone-spawned enemies
  @type("number") hp = 0;
  @type("number") maxHp = 0;
  @type("boolean") isCasting = false;
  @type("number") enragesAt = 0; // epoch ms; 0 = boss not yet engaged, set on first damage taken
  @type("string") aggroTargetId = ""; // sessionId of whoever this enemy is currently attacking, "" if not engaged yet
  @type("string") castAbilityName = ""; // display name while isCasting, only set for a named special-spell windup (see BossAbilityDef); "" for melee/the unnamed phase-2 attack
  @type([DotStack]) dots = new ArraySchema<DotStack>(); // see DotStack's own doc comment - a player-cast DOT spell writes here
}

export class Projectile extends Schema {
  @type("number") x = 0;
  @type("number") z = 0;
  @type("number") damage = 0;
  @type("number") speed = 0;
  @type("string") source = "enemy";
  @type("string") targetId = "";
  @type("string") ownerId = "";
  @type("boolean") isCrit = false; // only ever true for a player-sourced projectile - see CombatEngine.computePlayerDamage
}

export class LootBag extends Schema {
  @type("number") x = 0;
  @type("number") z = 0;
  @type(["string"]) items = new ArraySchema<string>();
}

// One instance per GatheringNodeDef placement, seeded at room init (mirrors LootBag's schema-
// sync-so-depletion-is-visible reasoning, unlike static Waypoint/Structure content) - `available`
// flips false on gather, then true again after the node type's respawnMs (WorldRoom.handleGatherNode).
export class GatheringNode extends Schema {
  @type("string") nodeTypeId = "";
  @type("number") x = 0;
  @type("number") z = 0;
  @type("boolean") available = true;
}

// A listing is just a party advertising itself for the dungeon finder - member list and
// composition are derived on demand from players filtered by partyId, never duplicated here.
export class DungeonListing extends Schema {
  @type("string") partyId = "";
  @type("string") leaderSessionId = "";
  @type("number") createdAt = 0;
}

export class WorldState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Enemy }) enemies = new MapSchema<Enemy>();
  @type({ map: Projectile }) projectiles = new MapSchema<Projectile>();
  @type({ map: LootBag }) lootBags = new MapSchema<LootBag>();
  @type({ map: DungeonListing }) dungeonListings = new MapSchema<DungeonListing>();
  @type({ map: GatheringNode }) gatheringNodes = new MapSchema<GatheringNode>();
}
