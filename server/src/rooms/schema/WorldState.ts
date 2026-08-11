import { Schema, MapSchema, type } from "@colyseus/schema";
import { PLAYER_MAX_HP } from "@mmo/shared";

export class Player extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") z = 0;
  @type("number") rotationY = 0;
  @type("number") hp = PLAYER_MAX_HP;
  @type("number") maxHp = PLAYER_MAX_HP;
  @type("number") castSpellId = 0;
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
}

export class WorldState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Enemy }) enemies = new MapSchema<Enemy>();
  @type({ map: Projectile }) projectiles = new MapSchema<Projectile>();
}
