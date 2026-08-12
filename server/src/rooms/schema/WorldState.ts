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
  @type("number") castSpellId = 0;

  @type("string") classId: string = DEFAULT_CLASS_ID;
  @type("number") level = 1;
  @type("number") xp = 0;
  @type("number") strength = BASE_STATS.strength;
  @type("number") dexterity = BASE_STATS.dexterity;
  @type("number") intellect = BASE_STATS.intellect;
  @type("number") vitality = BASE_STATS.vitality;
  @type("number") luck = BASE_STATS.luck;
  @type("number") armor = BASE_STATS.armor;

  @type("string") equippedWeapon = "";
  @type("string") equippedArmor = "";
  @type("string") equippedTrinket = "";
  @type(["string"]) inventory = new ArraySchema<string>();
}

export class Enemy extends Schema {
  @type("string") kind = "melee";
  @type("number") x = 0;
  @type("number") z = 0;
  @type("number") hp = 0;
  @type("number") maxHp = 0;
  @type("boolean") isCasting = false;
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

export class WorldState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Enemy }) enemies = new MapSchema<Enemy>();
  @type({ map: Projectile }) projectiles = new MapSchema<Projectile>();
  @type({ map: LootBag }) lootBags = new MapSchema<LootBag>();
}
