import { Client } from "@colyseus/core";
import { ActionFailedMessage, ActionFailReason, RESPAWN_POINTS, SPAWN_POSITION } from "@mmo/shared";

// Sends an ActionFailedMessage back to just this one client - shared by both WorldRoom and
// DungeonRoom (every gated action: loot, friends, guilds, professions, gathering, crafting,
// quests, vendor).
export function rejectAction(client: Client, reason: ActionFailReason) {
  const failure: ActionFailedMessage = { reason };
  client.send("action_failed", failure);
}

// CombatEngine's onPlayerRespawn hook - DungeonRoom's own instance-run has no graveyard concept
// (see RESPAWN_POINTS's doc comment), so it still just respawns at the fixed origin.
export function respawnPlayerPosition(player: { x: number; y: number; z: number }) {
  player.x = 0;
  player.y = 0;
  player.z = 0;
}

// WorldRoom's onPlayerRespawn hook - picks whichever admin-placed RESPAWN_POINTS entry is
// closest to where the player actually died (player.x/z still hold the death position here;
// CombatEngine.damagePlayer resets hp/ailments/buffs before calling this, but never touches
// position), the classic MMO "graveyard run" mechanic. Falls back to SPAWN_POSITION - the same
// admin-editable spot a brand new character first spawns at (see WorldRoom.onJoin) - if no
// respawn point has been placed yet.
export function respawnPlayerAtClosestPoint(player: { x: number; y: number; z: number }) {
  let closest: { x: number; z: number } = SPAWN_POSITION;
  let bestDistance = Infinity;
  for (const point of RESPAWN_POINTS) {
    const distance = Math.hypot(point.x - player.x, point.z - player.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      closest = point;
    }
  }
  player.x = closest.x;
  player.y = 0;
  player.z = closest.z;
}
