import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";
import { BASE_STATS, DEFAULT_CLASS_ID, VITALITY_TO_HP } from "@mmo/shared";

const BASE_MAX_HP = BASE_STATS.vitality * VITALITY_TO_HP;

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
  @type("string") equippedArmor = "";
  @type("string") equippedTrinket = "";
  @type(["string"]) inventory = new ArraySchema<string>();

  @type("number") talentPoints = 0;
  @type({ map: "number" }) talentRanks = new MapSchema<number>();

  @type({ map: "number" }) ailments = new MapSchema<number>(); // ailment kind -> expiresAt (epoch ms)
  @type({ map: "number" }) buffs = new MapSchema<number>(); // buff kind -> expiresAt (epoch ms) - mirrors ailments, but caster-beneficial (see BuffKind)

  @type({ map: "number" }) questProgress = new MapSchema<number>(); // questId -> kill count
  @type({ map: "number" }) questCompleted = new MapSchema<number>(); // questId -> completedAt (epoch ms)

  // partyId is the session id of whichever player anchored the group (first inviter);
  // two players are grouped iff both have the same non-empty partyId - no separate Party object.
  @type("string") partyId = "";
  @type("string") pendingPartyInviteFrom = ""; // sessionId of pending inviter, or ""
  @type("string") pendingTradeRequestFrom = ""; // sessionId of pending trade requester, or ""
}

export class Enemy extends Schema {
  @type("string") enemyTypeId = ""; // admin-authored identity, e.g. "goblin_grunt" - see ENEMY_TYPES
  @type("string") behavior = "melee"; // fixed AI archetype ("melee"|"caster"|"boss"), copied from EnemyTypeDef at spawn
  @type("number") x = 0;
  @type("number") z = 0;
  @type("number") hp = 0;
  @type("number") maxHp = 0;
  @type("boolean") isCasting = false;
  @type("number") enragesAt = 0; // epoch ms; 0 = boss not yet engaged, set on first damage taken
  @type("string") aggroTargetId = ""; // sessionId of whoever this enemy is currently attacking, "" if not engaged yet
}

export class Projectile extends Schema {
  @type("number") x = 0;
  @type("number") z = 0;
  @type("number") damage = 0;
  @type("number") speed = 0;
  @type("string") source = "enemy";
  @type("string") targetId = "";
  @type("string") ownerId = "";
}

export class LootBag extends Schema {
  @type("number") x = 0;
  @type("number") z = 0;
  @type(["string"]) items = new ArraySchema<string>();
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
}
