import { Client } from "@colyseus/core";
import { ActionFailedMessage, ActionFailReason } from "@mmo/shared";

// Sends an ActionFailedMessage back to just this one client - shared by both WorldRoom and
// DungeonRoom (every gated action: loot, friends, guilds, professions, gathering, crafting,
// quests, vendor).
export function rejectAction(client: Client, reason: ActionFailReason) {
  const failure: ActionFailedMessage = { reason };
  client.send("action_failed", failure);
}

// CombatEngine's onPlayerRespawn hook, called after a dead player's hp/ailments/cast have already
// been reset - both WorldRoom and DungeonRoom respawn at the same fixed point.
export function respawnPlayerPosition(player: { x: number; y: number; z: number }) {
  player.x = 0;
  player.y = 0;
  player.z = 0;
}
