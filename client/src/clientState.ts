import type { Room } from "colyseus.js";
import { ClassId, MainStat } from "@mmo/shared";

// The two narrow bridge points between main.ts's top-level tier (equipment/inventory/hotbar/
// professions/talents/character-panel rendering - all self-contained, split into client/src/ui/*)
// and the big room-connection closure in main()'s own `main.ts` (which owns `room`,
// `localPlayerSchema`, and everything else that only exists per-connection). Both tiers need to
// read this state; only the closure ever writes it, through the setters below - ES module live
// bindings mean every importer sees updates the moment the closure calls a setter, the same as
// when all of this lived in one file as top-level `let`s.

export interface PlayerStatsSnapshot {
  classId: string;
  level: number;
  xp: number;
  mainStat: number;
  vitality: number;
  luck: number;
  armor: number;
  gold: number;
  equippedWeapon: string;
  equippedOffHand: string;
  equippedHead: string;
  equippedNeck: string;
  equippedShoulders: string;
  equippedArmor: string;
  equippedHands: string;
  equippedWaist: string;
  equippedLegs: string;
  equippedFeet: string;
  equippedRing: string;
  equippedTrinket: string;
  inventory: Iterable<string>;
  talentPoints: number;
  talentRanks: Iterable<[string, number]>;
  questProgress: Iterable<[string, number]>;
  questCompleted: Iterable<[string, number]>;
  professionXp: Iterable<[string, number]>;
  professionLevel: Iterable<[string, number]>;
  materials: Iterable<[string, number]>;
  partyId: string;
  friends: Iterable<[string, { characterId: number; name: string; level: number; classId: string; online: boolean }]>;
  pendingFriendRequests: Iterable<{ requestId: number; fromCharacterId: number; fromName: string }>;
  guildId: number;
  guildName: string;
  guildRole: string;
  pendingGuildInvites: Iterable<{ inviteId: number; guildId: number; guildName: string; invitedByName: string }>;
  hasMount: boolean;
  mounted: boolean;
}

export const MAIN_STAT_NAME: Record<MainStat, string> = {
  strength: "Strength",
  dexterity: "Dexterity",
  intellect: "Intellect",
};

// Set once main() establishes a connection; the equip/unequip/inventory click handlers in
// ui/inventoryPanel.ts (and other top-level panel code) are bound once at module scope (their DOM
// elements are static), so they read this rather than a `room` captured in a closure that only
// exists for one connection.
export let activeRoom: Room | undefined;
export function setActiveRoom(room: Room | undefined) {
  activeRoom = room;
}

// The spell-slot override system (hotbar slots 1-3) lives inside main()'s closure - it needs
// closure-scoped DOM refs the class's spells share. This lets top-level code (which owns the
// item hotbar's own lastKnownMaterials/lastKnownInventoryTokens, the data an override's
// "unusable" state depends on) ask it to refresh without reaching into the closure.
export let refreshSpellSlotOverrides: (() => void) | null = null;
export function setRefreshSpellSlotOverrides(fn: (() => void) | null) {
  refreshSpellSlotOverrides = fn;
}

// showItemTooltip (ui/tooltips.ts) is module-scoped so it can't see main()'s local
// `localPlayerSchema` - this tracks the local player's class id at module scope instead, set
// once main() knows it, purely so item tooltips can label a mainStat bonus correctly (e.g.
// "+3 Intellect" for an Oracle looking at a weapon, regardless of that weapon's flavor).
export let localClassId: ClassId | null = null;
export function setLocalClassId(id: ClassId | null) {
  localClassId = id;
}
