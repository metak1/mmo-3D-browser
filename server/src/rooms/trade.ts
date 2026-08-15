import { Client } from "@colyseus/core";
import { ArraySchema, MapSchema } from "@colyseus/schema";
import {
  INVENTORY_SIZE,
  TRADE_RANGE,
  TradeCancelReason,
  TradeCancelledMessage,
  TradeOfferMessage,
  TradeRequestMessage,
  TradeRespondMessage,
  TradeSnapshot,
} from "@mmo/shared";
import { Player } from "./schema/WorldState.js";

// WorldRoom-only for v1 (see plan) - kept behind a small structural interface anyway, the
// same shape chat.ts uses, so adding DungeonRoom support later is a small diff, not a rewrite.
interface TradeCapableRoom {
  state: { players: MapSchema<Player> };
  clients: { getById(sessionId: string): Client | undefined };
  persistItems(sessionId: string): Promise<void>;
  saveCharacter(sessionId: string): Promise<void>;
}

interface TradeSide {
  sessionId: string;
  offer: string[];
  gold: number;
  accepted: boolean;
}

interface TradeSession {
  a: TradeSide;
  b: TradeSide;
}

function ownSide(session: TradeSession, sessionId: string): TradeSide {
  return session.a.sessionId === sessionId ? session.a : session.b;
}

// Counts each distinct token so duplicate items (two identical potions) are handled correctly -
// a plain "every token is in inventory" check would let one real item satisfy two offered copies.
function hasAtLeast(inventory: Iterable<string>, offer: string[]): boolean {
  const counts = new Map<string, number>();
  for (const token of inventory) counts.set(token, (counts.get(token) ?? 0) + 1);
  for (const token of offer) {
    const remaining = (counts.get(token) ?? 0) - 1;
    if (remaining < 0) return false;
    counts.set(token, remaining);
  }
  return true;
}

function removeTokens(inventory: ArraySchema<string>, tokens: string[]) {
  for (const token of tokens) {
    const index = inventory.indexOf(token);
    if (index !== -1) inventory.splice(index, 1);
  }
}

// Both participants' sessionIds key into the same TradeSession object below - lookup, cancel,
// and cleanup all work identically from either side with no tradeId plumbing anywhere.
export class TradeManager {
  private sessions = new Map<string, TradeSession>();

  constructor(private room: TradeCapableRoom) {}

  private inRange(a: Player, b: Player): boolean {
    return Math.hypot(a.x - b.x, a.z - b.z) <= TRADE_RANGE;
  }

  handleRequest(client: Client, message: TradeRequestMessage) {
    const requester = this.room.state.players.get(client.sessionId);
    const target = this.room.state.players.get(message.targetSessionId);
    if (!requester || !target || target === requester) return;
    if (this.sessions.has(client.sessionId) || this.sessions.has(message.targetSessionId)) return;
    if (!this.inRange(requester, target)) return;

    target.pendingTradeRequestFrom = client.sessionId;
  }

  handleRespond(client: Client, message: TradeRespondMessage) {
    const player = this.room.state.players.get(client.sessionId);
    if (!player) return;

    const requesterSessionId = player.pendingTradeRequestFrom;
    if (!requesterSessionId) return;
    player.pendingTradeRequestFrom = "";

    if (!message.accept) {
      this.send(requesterSessionId, "trade_cancelled", { reason: "declined" });
      return;
    }

    // Re-validate everything from handleRequest again - time has passed since the request was
    // sent, so either side may have gone busy, disconnected, or wandered out of range since.
    const requester = this.room.state.players.get(requesterSessionId);
    if (!requester) return;
    if (this.sessions.has(client.sessionId) || this.sessions.has(requesterSessionId)) return;
    if (!this.inRange(requester, player)) return;

    const session: TradeSession = {
      a: { sessionId: requesterSessionId, offer: [], gold: 0, accepted: false },
      b: { sessionId: client.sessionId, offer: [], gold: 0, accepted: false },
    };
    this.sessions.set(requesterSessionId, session);
    this.sessions.set(client.sessionId, session);
    this.pushSnapshot(session);
  }

  handleOffer(client: Client, message: TradeOfferMessage) {
    const session = this.sessions.get(client.sessionId);
    if (!session) return;
    const player = this.room.state.players.get(client.sessionId);
    if (!player) return;

    if (!Number.isInteger(message.gold) || message.gold < 0 || message.gold > player.gold) return;
    if (!hasAtLeast(player.inventory, message.items)) return;

    const side = ownSide(session, client.sessionId);
    side.offer = [...message.items];
    side.gold = message.gold;
    side.accepted = false; // editing your own offer un-checks only your own acceptance, not the partner's
    this.pushSnapshot(session);
  }

  handleAccept(client: Client) {
    const session = this.sessions.get(client.sessionId);
    if (!session) return;

    ownSide(session, client.sessionId).accepted = true;
    this.pushSnapshot(session);

    if (session.a.accepted && session.b.accepted) this.finalize(session);
  }

  handleCancel(client: Client) {
    const session = this.sessions.get(client.sessionId);
    if (!session) return;
    this.cancel(session, "cancelled");
  }

  handleLeave(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session) this.cancel(session, "disconnected");

    // A requester who disconnects before their target responds would otherwise leave the
    // target staring at a stuck "X wants to trade" prompt forever.
    for (const player of this.room.state.players.values()) {
      if (player.pendingTradeRequestFrom === sessionId) player.pendingTradeRequestFrom = "";
    }
  }

  checkRanges() {
    const seen = new Set<TradeSession>();
    for (const session of this.sessions.values()) {
      if (seen.has(session)) continue;
      seen.add(session);

      const playerA = this.room.state.players.get(session.a.sessionId);
      const playerB = this.room.state.players.get(session.b.sessionId);
      if (!playerA || !playerB || !this.inRange(playerA, playerB)) {
        this.cancel(session, "left_range");
      }
    }
  }

  private async finalize(session: TradeSession) {
    const playerA = this.room.state.players.get(session.a.sessionId);
    const playerB = this.room.state.players.get(session.b.sessionId);
    if (!playerA || !playerB || !this.revalidate(playerA, session.a, playerB, session.b)) {
      this.cancel(session, "trade_failed");
      return;
    }

    removeTokens(playerA.inventory, session.a.offer);
    removeTokens(playerB.inventory, session.b.offer);
    for (const token of session.b.offer) playerA.inventory.push(token);
    for (const token of session.a.offer) playerB.inventory.push(token);
    playerA.gold += session.b.gold - session.a.gold;
    playerB.gold += session.a.gold - session.b.gold;

    // Delete before the first await below - a message resent for either session during the
    // persistence window must find no active trade, not one that's already (logically) done.
    this.sessions.delete(session.a.sessionId);
    this.sessions.delete(session.b.sessionId);

    await Promise.all([
      this.room.persistItems(session.a.sessionId),
      this.room.persistItems(session.b.sessionId),
      this.room.saveCharacter(session.a.sessionId),
      this.room.saveCharacter(session.b.sessionId),
    ]);

    this.send(session.a.sessionId, "trade_complete", {});
    this.send(session.b.sessionId, "trade_complete", {});
  }

  // Re-checked from scratch at finalize time (not just trusting the last handleOffer) since a
  // player can still equip/unequip or pick up loot while a trade window is open.
  private revalidate(playerA: Player, sideA: TradeSide, playerB: Player, sideB: TradeSide): boolean {
    if (sideA.gold < 0 || sideA.gold > playerA.gold) return false;
    if (sideB.gold < 0 || sideB.gold > playerB.gold) return false;
    if (!hasAtLeast(playerA.inventory, sideA.offer)) return false;
    if (!hasAtLeast(playerB.inventory, sideB.offer)) return false;

    const resultingA = playerA.inventory.length - sideA.offer.length + sideB.offer.length;
    const resultingB = playerB.inventory.length - sideB.offer.length + sideA.offer.length;
    return resultingA <= INVENTORY_SIZE && resultingB <= INVENTORY_SIZE;
  }

  private cancel(session: TradeSession, reason: TradeCancelReason) {
    this.sessions.delete(session.a.sessionId);
    this.sessions.delete(session.b.sessionId);
    this.send(session.a.sessionId, "trade_cancelled", { reason } satisfies TradeCancelledMessage);
    this.send(session.b.sessionId, "trade_cancelled", { reason } satisfies TradeCancelledMessage);
  }

  private pushSnapshot(session: TradeSession) {
    this.sendSnapshot(session.a, session.b);
    this.sendSnapshot(session.b, session.a);
  }

  private sendSnapshot(self: TradeSide, partner: TradeSide) {
    const partnerPlayer = this.room.state.players.get(partner.sessionId);
    const snapshot: TradeSnapshot = {
      partnerSessionId: partner.sessionId,
      partnerName: partnerPlayer?.name ?? "",
      selfOffer: [...self.offer],
      selfGold: self.gold,
      partnerOffer: [...partner.offer],
      partnerGold: partner.gold,
      selfAccepted: self.accepted,
      partnerAccepted: partner.accepted,
    };
    this.send(self.sessionId, "trade_update", snapshot);
  }

  private send(sessionId: string, type: string, payload: unknown) {
    this.room.clients.getById(sessionId)?.send(type, payload);
  }
}
