import { ChatChannel, GuildRosterSnapshot, TradeSnapshot } from "@mmo/shared";
import { PlayerAvatar } from "./game/Player";
import { NpcAvatar } from "./game/Npc";
import { PlayerStatsSnapshot } from "./clientState";

// The lightweight schema mirror main()'s players.onAdd/onChange keeps (see PlayerSchemaRef) -
// not the raw Colyseus Player class, just the handful of fields the social/party/dungeon-finder
// panels actually read off another player.
export interface PlayerSchemaRef {
  name: string;
  classId: string;
  level: number;
  hp: number;
  maxHp: number;
  castSpellId: string;
  ailments: Iterable<[string, number]>;
  partyId: string;
  pendingPartyInviteFrom: string;
  pendingTradeRequestFrom: string;
}

export interface DungeonListingRef {
  partyId: string;
  leaderSessionId: string;
  createdAt: number;
  dungeonId: string;
}

// The minimal shared-state bridge between main()'s closure (the room connection, spell casting/
// targeting, the schema listeners, and the animate() loop - none of that is moving) and the four
// panel-like sections split out into client/src/ui/*.ts (social panels, NPC dialogue + quests,
// dungeon finder, chat). Only the ~17 fields those four actually read/write live here - everything
// else (movement prediction, cast state, hotbar refs, world-object Maps the panels never touch)
// stays a genuine closure-local `let` in main.ts, untouched. `room` itself doesn't need a field -
// clientState.ts's `activeRoom` already solves "reach the room from outside the closure".
export interface GameSession {
  token: string;
  characterId: number;
  isDungeon: boolean;

  localSessionId: string | null;
  localPlayerSchema: PlayerStatsSnapshot | undefined;
  playerSchemaById: Map<string, PlayerSchemaRef>;
  avatars: Map<string, PlayerAvatar>;
  npcs: Map<string, NpcAvatar>;
  dungeonListingSchemaById: Map<string, DungeonListingRef>;

  currentNpcDialogueId: string | null;
  activeGuildRoster: GuildRosterSnapshot | null;
  activeTradeSnapshot: TradeSnapshot | null;
  activeChatChannel: ChatChannel;
  chatHistory: Record<ChatChannel, HTMLElement[]>;

  // Bridges into core logic the panels need but don't own - avoids a circular import between
  // main.ts and these new files (main.ts imports each panel's render fn; the panel would
  // otherwise need to import these back from main.ts, which doesn't export anything today).
  setTarget: (sessionId: string | null) => void;
  isNearWorldPoint: (x: number, z: number, radius: number) => boolean;
  showActionFeedback: (text: string) => void;
}
