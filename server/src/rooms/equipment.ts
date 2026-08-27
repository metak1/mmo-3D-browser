import { EquipSlot } from "@mmo/shared";
import { Player } from "./schema/WorldState.js";

// Player's equippedX fields are individual @type("string") Colyseus schema properties (one per
// slot) rather than a MapSchema<string>, so reading/writing "whichever slot an EquipSlot value
// names" needs this switch - shared between WorldRoom and DungeonRoom (DungeonState.ts's own
// Player is WorldState's, re-exported - see its own import) rather than duplicated per room.
export function getEquippedItemId(player: Player, slot: EquipSlot): string {
  switch (slot) {
    case "weapon":
      return player.equippedWeapon;
    case "offHand":
      return player.equippedOffHand;
    case "head":
      return player.equippedHead;
    case "neck":
      return player.equippedNeck;
    case "shoulders":
      return player.equippedShoulders;
    case "armor":
      return player.equippedArmor;
    case "hands":
      return player.equippedHands;
    case "waist":
      return player.equippedWaist;
    case "legs":
      return player.equippedLegs;
    case "feet":
      return player.equippedFeet;
    case "ring":
      return player.equippedRing;
    case "trinket":
      return player.equippedTrinket;
  }
}

export function setEquippedItemId(player: Player, slot: EquipSlot, itemId: string) {
  switch (slot) {
    case "weapon":
      player.equippedWeapon = itemId;
      break;
    case "offHand":
      player.equippedOffHand = itemId;
      break;
    case "head":
      player.equippedHead = itemId;
      break;
    case "neck":
      player.equippedNeck = itemId;
      break;
    case "shoulders":
      player.equippedShoulders = itemId;
      break;
    case "armor":
      player.equippedArmor = itemId;
      break;
    case "hands":
      player.equippedHands = itemId;
      break;
    case "waist":
      player.equippedWaist = itemId;
      break;
    case "legs":
      player.equippedLegs = itemId;
      break;
    case "feet":
      player.equippedFeet = itemId;
      break;
    case "ring":
      player.equippedRing = itemId;
      break;
    case "trinket":
      player.equippedTrinket = itemId;
      break;
  }
}
