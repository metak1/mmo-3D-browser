import { MapSchema, Schema, type } from "@colyseus/schema";
import { Enemy, LootBag, Player, Projectile } from "./WorldState.js";

export { Enemy, LootBag, Player, Projectile };

export class DungeonState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Enemy }) enemies = new MapSchema<Enemy>();
  @type({ map: Projectile }) projectiles = new MapSchema<Projectile>();
  @type({ map: LootBag }) lootBags = new MapSchema<LootBag>();
  @type("boolean") cleared = false; // true once the dungeon's boss (see DungeonSpawnDef) has been killed
}
