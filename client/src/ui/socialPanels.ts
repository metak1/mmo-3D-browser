import {
  CLASSES,
  ClassId,
  FriendRemoveMessage,
  FriendRequestMessage,
  FriendRespondMessage,
  GUILD_NAME_MAX_LENGTH,
  GuildCreateMessage,
  GuildInviteMessage,
  GuildKickMessage,
  GuildPromoteMessage,
  GuildRespondMessage,
  GuildRosterSnapshot,
  ITEMS,
  PARTY_MAX_SIZE,
  PartyInviteMessage,
  PartyRespondMessage,
  RARITY_COLOR,
  TradeOfferMessage,
  TradeRequestMessage,
  TradeRespondMessage,
  TradeSnapshot,
  decodeItemToken,
} from "@mmo/shared";
import { activeRoom } from "../clientState";
import { GameSession } from "../GameSession";
import { attachItemTooltip } from "./tooltips";
import { ContextMenuAction } from "./contextMenu";
import { hpColor } from "./characterPanel";
import { makeDraggable } from "./DraggablePanel";

const partyPanel = document.getElementById("party-panel")!;
const partyCountEl = document.querySelector<HTMLElement>("[data-party-count]")!;
const partyMemberListEl = document.getElementById("party-member-list")!;
const partyInvitePromptEl = document.getElementById("party-invite-prompt")!;
const partyInviteTextEl = document.querySelector<HTMLElement>("[data-party-invite-text]")!;

export const friendsPanel = document.getElementById("friends-panel")!;
const friendRequestListEl = document.getElementById("friend-request-list")!;
const friendListEl = document.getElementById("friend-list")!;
const friendAddInput = document.getElementById("friend-add-input") as HTMLInputElement;

export const guildPanel = document.getElementById("guild-panel")!;
const guildNoGuildSectionEl = document.getElementById("guild-no-guild-section")!;
const guildRosterSectionEl = document.getElementById("guild-roster-section")!;
const guildInvitesSectionEl = document.getElementById("guild-invites-section")!;
const guildEmptyStateEl = document.getElementById("guild-empty-state")!;
const guildInviteListEl = document.getElementById("guild-invite-list")!;
const guildNameInput = document.getElementById("guild-name-input") as HTMLInputElement;
const guildNameLabelEl = document.querySelector<HTMLElement>("[data-guild-name-label]")!;
const guildMemberCountEl = document.querySelector<HTMLElement>("[data-guild-member-count]")!;
const guildInviteSectionEl = document.getElementById("guild-invite-section")!;
const guildInviteInput = document.getElementById("guild-invite-input") as HTMLInputElement;
const guildMemberListEl = document.getElementById("guild-member-list")!;
const guildDisbandBtn = document.querySelector<HTMLButtonElement>("[data-guild-disband]")!;

const tradeInvitePromptEl = document.getElementById("trade-invite-prompt")!;
const tradeInviteTextEl = document.querySelector<HTMLElement>("[data-trade-invite-text]")!;
const tradeWindowEl = document.getElementById("trade-window")!;
const tradePartnerNameEl = document.querySelector<HTMLElement>("[data-trade-partner-name]")!;
const tradeSelfOfferEl = document.getElementById("trade-self-offer")!;
const tradePartnerOfferEl = document.getElementById("trade-partner-offer")!;
const tradeSelfGoldInput = document.getElementById("trade-self-gold") as HTMLInputElement;
const tradePartnerGoldInput = document.getElementById("trade-partner-gold") as HTMLInputElement;
const tradeSelfAcceptedEl = document.querySelector<HTMLElement>("[data-trade-self-accepted]")!;
const tradePartnerAcceptedEl = document.querySelector<HTMLElement>("[data-trade-partner-accepted]")!;
const tradeInventoryListEl = document.getElementById("trade-inventory-list")!;

makeDraggable(partyPanel, "party");
makeDraggable(friendsPanel, "friends");
makeDraggable(guildPanel, "guild");
makeDraggable(tradeWindowEl, "trade");

export function renderPartyPanel(session: GameSession) {
  const local = session.localSessionId ? session.playerSchemaById.get(session.localSessionId) : undefined;
  const partyId = local?.partyId ?? "";
  if (!partyId) {
    partyPanel.hidden = true;
    return;
  }

  partyPanel.hidden = false;
  const members = [...session.playerSchemaById].filter(([, schema]) => schema.partyId === partyId);
  partyCountEl.textContent = `${members.length} / ${PARTY_MAX_SIZE} members`;

  partyMemberListEl.innerHTML = "";
  for (const [sessionId, schema] of members) {
    const className = CLASSES[schema.classId as ClassId]?.name ?? schema.classId;
    const label = sessionId === session.localSessionId ? `${schema.name} (You)` : schema.name;
    const fraction = schema.maxHp > 0 ? Math.max(0, Math.min(1, schema.hp / schema.maxHp)) : 0;

    const row = document.createElement("button");
    row.type = "button";
    row.className = "party-member-row";
    row.innerHTML = `
      <div class="party-member-top">
        <span>${label}</span>
        <span class="item-slot-tag">Lv.${schema.level} ${className}</span>
      </div>
      <div class="bar party-member-bar"><div class="bar-fill" style="width: ${fraction * 100}%; background: ${hpColor(fraction)}"></div></div>
    `;
    row.addEventListener("click", () => session.setTarget(sessionId));
    partyMemberListEl.appendChild(row);
  }
}

export function renderPartyInvitePrompt(session: GameSession, player: { pendingPartyInviteFrom: string }) {
  const inviterId = player.pendingPartyInviteFrom;
  if (!inviterId) {
    partyInvitePromptEl.hidden = true;
    return;
  }

  const inviter = session.playerSchemaById.get(inviterId);
  const inviterLabel = inviter?.name || (inviter ? (CLASSES[inviter.classId as ClassId]?.name ?? "Someone") : "Someone");
  partyInviteTextEl.textContent = `${inviterLabel} wants to group with you.`;
  partyInvitePromptEl.hidden = false;
}

function statusDotHtml(online: boolean): string {
  return `<span class="status-dot ${online ? "online" : "offline"}" title="${online ? "Online" : "Offline"}"></span>`;
}

// The name itself is wrapped in its own inner span so text-overflow:ellipsis has a single text
// node to truncate - applying it directly to the outer flex container (name + optional status
// dot) doesn't reliably ellipsis in a flex layout, it just hard-clips with no "…".
function socialRowNameHtml(text: string, online?: boolean): string {
  const dot = online === undefined ? "" : statusDotHtml(online);
  return `<span class="social-row-name">${dot}<span class="social-row-name-text">${text}</span></span>`;
}

export function renderFriendsPanel(session: GameSession) {
  if (!session.localPlayerSchema) return;

  friendRequestListEl.innerHTML = "";
  for (const request of session.localPlayerSchema.pendingFriendRequests) {
    const row = document.createElement("div");
    row.className = "social-row";
    row.innerHTML = `<div class="social-row-top">${socialRowNameHtml(request.fromName)}</div>`;
    const actions = document.createElement("div");
    actions.className = "social-row-actions";
    const acceptBtn = document.createElement("button");
    acceptBtn.type = "button";
    acceptBtn.className = "overlay-button accent";
    acceptBtn.textContent = "Accept";
    acceptBtn.addEventListener("click", () => {
      const message: FriendRespondMessage = { requestId: request.requestId, accept: true };
      activeRoom?.send("friend_respond", message);
    });
    const declineBtn = document.createElement("button");
    declineBtn.type = "button";
    declineBtn.className = "overlay-button danger";
    declineBtn.textContent = "Decline";
    declineBtn.addEventListener("click", () => {
      const message: FriendRespondMessage = { requestId: request.requestId, accept: false };
      activeRoom?.send("friend_respond", message);
    });
    actions.appendChild(acceptBtn);
    actions.appendChild(declineBtn);
    row.appendChild(actions);
    friendRequestListEl.appendChild(row);
  }

  friendListEl.innerHTML = "";
  for (const [, friend] of session.localPlayerSchema.friends) {
    const row = document.createElement("div");
    row.className = "social-row";
    row.innerHTML = `
      <div class="social-row-top">
        ${socialRowNameHtml(friend.name, friend.online)}
        <span class="item-slot-tag">Lv.${friend.level}</span>
      </div>
    `;
    const actions = document.createElement("div");
    actions.className = "social-row-actions";
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "overlay-button danger";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      const message: FriendRemoveMessage = { characterId: friend.characterId };
      activeRoom?.send("friend_remove", message);
    });
    actions.appendChild(removeBtn);
    row.appendChild(actions);
    friendListEl.appendChild(row);
  }
}

export function renderGuildPanel(session: GameSession) {
  if (!session.localPlayerSchema) return;

  if (session.localPlayerSchema.guildId === 0) {
    guildNoGuildSectionEl.hidden = false;
    guildRosterSectionEl.hidden = true;

    const invites = session.localPlayerSchema.pendingGuildInvites;
    const inviteCount = [...invites].length;
    guildInvitesSectionEl.hidden = inviteCount === 0;
    guildEmptyStateEl.hidden = inviteCount > 0;

    guildInviteListEl.innerHTML = "";
    for (const invite of invites) {
      const row = document.createElement("div");
      row.className = "social-row";
      row.innerHTML = `
        <div class="social-row-top">
          ${socialRowNameHtml(`🛡️ ${invite.guildName}`)}
          <span class="item-slot-tag">from ${invite.invitedByName}</span>
        </div>
      `;
      const actions = document.createElement("div");
      actions.className = "social-row-actions";
      const acceptBtn = document.createElement("button");
      acceptBtn.type = "button";
      acceptBtn.className = "overlay-button accent";
      acceptBtn.textContent = "Accept";
      acceptBtn.addEventListener("click", () => {
        const message: GuildRespondMessage = { inviteId: invite.inviteId, accept: true };
        activeRoom?.send("guild_respond", message);
      });
      const declineBtn = document.createElement("button");
      declineBtn.type = "button";
      declineBtn.className = "overlay-button danger";
      declineBtn.textContent = "Decline";
      declineBtn.addEventListener("click", () => {
        const message: GuildRespondMessage = { inviteId: invite.inviteId, accept: false };
        activeRoom?.send("guild_respond", message);
      });
      actions.appendChild(acceptBtn);
      actions.appendChild(declineBtn);
      row.appendChild(actions);
      guildInviteListEl.appendChild(row);
    }
    return;
  }

  guildNoGuildSectionEl.hidden = true;
  guildRosterSectionEl.hidden = false;
  guildNameLabelEl.textContent = session.localPlayerSchema.guildName;
  const isLeader = session.localPlayerSchema.guildRole === "leader";
  guildDisbandBtn.hidden = !isLeader;
  guildInviteSectionEl.hidden = !isLeader; // only a leader can invite - see handleGuildInvite's own leader-only check

  guildMemberListEl.innerHTML = "";
  const members = session.activeGuildRoster?.guildId === session.localPlayerSchema.guildId ? session.activeGuildRoster.members : [];
  const onlineCount = members.filter((m) => m.online).length;
  guildMemberCountEl.textContent = members.length
    ? `${members.length} member${members.length === 1 ? "" : "s"} · ${onlineCount} online`
    : "Loading members…";

  for (const member of members) {
    const row = document.createElement("div");
    row.className = member.role === "leader" ? "social-row leader-row" : "social-row";
    const selfTag = member.characterId === session.characterId ? " (You)" : "";
    const roleBadge = `<span class="role-badge ${member.role}">${member.role === "leader" ? "👑 Leader" : "Member"}</span>`;
    row.innerHTML = `
      <div class="social-row-top">
        ${socialRowNameHtml(`${member.name}${selfTag}`, member.online)}
        <span class="social-row-badges">
          <span class="item-slot-tag">Lv.${member.level}</span>
          ${roleBadge}
        </span>
      </div>
    `;

    if (isLeader && member.characterId !== session.characterId) {
      const actions = document.createElement("div");
      actions.className = "social-row-actions";
      const promoteBtn = document.createElement("button");
      promoteBtn.type = "button";
      promoteBtn.className = "overlay-button";
      promoteBtn.textContent = "Promote";
      promoteBtn.addEventListener("click", () => {
        const message: GuildPromoteMessage = { characterId: member.characterId };
        activeRoom?.send("guild_promote", message);
      });
      const kickBtn = document.createElement("button");
      kickBtn.type = "button";
      kickBtn.className = "overlay-button danger";
      kickBtn.textContent = "Kick";
      kickBtn.addEventListener("click", () => {
        const message: GuildKickMessage = { characterId: member.characterId };
        activeRoom?.send("guild_kick", message);
        activeRoom?.send("guild_roster_request");
      });
      actions.appendChild(promoteBtn);
      actions.appendChild(kickBtn);
      row.appendChild(actions);
    }
    guildMemberListEl.appendChild(row);
  }
}

function sendFriendRequestByName(targetName: string) {
  const name = targetName.trim();
  if (!name) return;
  const message: FriendRequestMessage = { targetName: name };
  activeRoom?.send("friend_request", message);
}

function sendGuildInviteByName(targetName: string) {
  const name = targetName.trim();
  if (!name) return;
  const message: GuildInviteMessage = { targetName: name };
  activeRoom?.send("guild_invite", message);
}

// Guards mirror the server's own checks in handlePartyInvite, so an obviously-invalid
// invite (self, already grouped, party full) never shows up as a menu option at all.
function canInviteToParty(session: GameSession, targetSessionId: string): boolean {
  if (!session.localSessionId || targetSessionId === session.localSessionId) return false;
  const local = session.playerSchemaById.get(session.localSessionId);
  const target = session.playerSchemaById.get(targetSessionId);
  if (!local || !target) return false;
  if (local.partyId && local.partyId === target.partyId) return false; // already grouped together
  if (
    local.partyId &&
    [...session.playerSchemaById.values()].filter((s) => s.partyId === local.partyId).length >= PARTY_MAX_SIZE
  ) {
    return false;
  }
  return true;
}

function sendPartyInvite(session: GameSession, targetSessionId: string) {
  if (!canInviteToParty(session, targetSessionId)) return;
  const message: PartyInviteMessage = { targetSessionId };
  activeRoom?.send("party_invite", message);
}

export function renderTradeInvitePrompt(session: GameSession, player: { pendingTradeRequestFrom: string }) {
  const requesterId = player.pendingTradeRequestFrom;
  if (!requesterId) {
    tradeInvitePromptEl.hidden = true;
    return;
  }

  const requester = session.playerSchemaById.get(requesterId);
  const requesterLabel =
    requester?.name || (requester ? (CLASSES[requester.classId as ClassId]?.name ?? "Someone") : "Someone");
  tradeInviteTextEl.textContent = `${requesterLabel} wants to trade with you.`;
  tradeInvitePromptEl.hidden = false;
}

// No distance check here on purpose, mirroring canInviteToParty's precedent - the server is
// the sole authority on TRADE_RANGE, checked at request time and continuously while trading.
function canTrade(session: GameSession, targetSessionId: string): boolean {
  if (!session.localSessionId || targetSessionId === session.localSessionId) return false;
  if (session.activeTradeSnapshot) return false; // already mid-trade
  return session.playerSchemaById.has(targetSessionId);
}

function sendTradeRequest(session: GameSession, targetSessionId: string) {
  if (!canTrade(session, targetSessionId)) return;
  const message: TradeRequestMessage = { targetSessionId };
  activeRoom?.send("trade_request", message);
}

// Best-effort client-side guard (mirrors handleFriendRequest's own already_friends check by
// name) - purely to keep an obviously-redundant option off the menu; the server remains the
// sole authority and still rejects a request that slips through (e.g. a stale player list).
function canAddFriend(session: GameSession, targetSessionId: string): boolean {
  if (!session.localSessionId || targetSessionId === session.localSessionId || !session.localPlayerSchema) return false;
  const target = session.playerSchemaById.get(targetSessionId);
  if (!target) return false;
  for (const [, friend] of session.localPlayerSchema.friends) {
    if (friend.name === target.name) return false;
  }
  return true;
}

// Guard mirrors handleGuildInvite's own leader-only check.
function canInviteToGuild(session: GameSession, targetSessionId: string): boolean {
  if (!session.localSessionId || targetSessionId === session.localSessionId || !session.localPlayerSchema) return false;
  if (session.localPlayerSchema.guildId === 0 || session.localPlayerSchema.guildRole !== "leader") return false;
  return session.playerSchemaById.has(targetSessionId);
}

// Right-click (on the 3D avatar or the target panel) opens this menu - the single entry
// point for player-targeted actions, always with Invite first per the established convention.
export function actionsForPlayerTarget(session: GameSession, targetSessionId: string): ContextMenuAction[] {
  const actions: ContextMenuAction[] = [];
  if (canInviteToParty(session, targetSessionId)) {
    actions.push({ label: "Invite to Party", onClick: () => sendPartyInvite(session, targetSessionId) });
  }
  if (canTrade(session, targetSessionId)) {
    actions.push({ label: "Trade", onClick: () => sendTradeRequest(session, targetSessionId) });
  }
  if (canAddFriend(session, targetSessionId)) {
    actions.push({
      label: "Add Friend",
      onClick: () => sendFriendRequestByName(session.playerSchemaById.get(targetSessionId)!.name),
    });
  }
  if (canInviteToGuild(session, targetSessionId)) {
    actions.push({
      label: "Invite to Guild",
      onClick: () => sendGuildInviteByName(session.playerSchemaById.get(targetSessionId)!.name),
    });
  }
  return actions;
}

export function closeTradeWindow(session: GameSession) {
  session.activeTradeSnapshot = null;
  tradeWindowEl.hidden = true;
}

function sendTradeOffer(items: string[], gold: number) {
  const message: TradeOfferMessage = { items, gold };
  activeRoom?.send("trade_offer", message);
}

function toggleTradeOfferItem(session: GameSession, token: string) {
  if (!session.activeTradeSnapshot) return;
  const offer = [...session.activeTradeSnapshot.selfOffer];
  const index = offer.indexOf(token);
  if (index === -1) offer.push(token);
  else offer.splice(index, 1);
  sendTradeOffer(offer, session.activeTradeSnapshot.selfGold);
}

function renderTradeItemSlot(token: string, onClick?: () => void): HTMLButtonElement {
  const decoded = decodeItemToken(token);
  const item = ITEMS[decoded.itemId];
  const slotEl = document.createElement("button");
  slotEl.className = "item-slot";
  slotEl.textContent = item ? item.icon : "";
  slotEl.style.borderColor = RARITY_COLOR[decoded.rarity];
  if (onClick) slotEl.addEventListener("click", onClick);
  else slotEl.disabled = true;
  attachItemTooltip(slotEl, token);
  return slotEl;
}

function renderTradeAvailableInventory(session: GameSession) {
  tradeInventoryListEl.innerHTML = "";
  if (!session.localPlayerSchema || !session.activeTradeSnapshot) return;

  // Duplicate tokens: skip exactly one occurrence per offered copy so a second identical
  // item still shows as available (mirrors trade.ts's hasAtLeast multiset check server-side).
  const offeredCounts = new Map<string, number>();
  for (const token of session.activeTradeSnapshot.selfOffer) offeredCounts.set(token, (offeredCounts.get(token) ?? 0) + 1);

  for (const token of session.localPlayerSchema.inventory) {
    const remaining = offeredCounts.get(token) ?? 0;
    if (remaining > 0) {
      offeredCounts.set(token, remaining - 1);
      continue;
    }
    tradeInventoryListEl.appendChild(renderTradeItemSlot(token, () => toggleTradeOfferItem(session, token)));
  }
}

export function renderTradeWindow(session: GameSession) {
  if (!session.activeTradeSnapshot) return;
  tradeWindowEl.hidden = false;
  tradePartnerNameEl.textContent = session.activeTradeSnapshot.partnerName;

  tradeSelfOfferEl.innerHTML = "";
  for (const token of session.activeTradeSnapshot.selfOffer) {
    tradeSelfOfferEl.appendChild(renderTradeItemSlot(token, () => toggleTradeOfferItem(session, token)));
  }

  tradePartnerOfferEl.innerHTML = "";
  for (const token of session.activeTradeSnapshot.partnerOffer) {
    tradePartnerOfferEl.appendChild(renderTradeItemSlot(token));
  }

  // Never overwrite the input while the player is actively typing in it (see the identical
  // guard pattern chat's own input avoids via blur-on-send).
  if (document.activeElement !== tradeSelfGoldInput) tradeSelfGoldInput.value = String(session.activeTradeSnapshot.selfGold);
  if (session.localPlayerSchema) tradeSelfGoldInput.max = String(session.localPlayerSchema.gold);
  tradePartnerGoldInput.value = String(session.activeTradeSnapshot.partnerGold);

  tradeSelfAcceptedEl.textContent = session.activeTradeSnapshot.selfAccepted ? "Accepted ✓" : "Not accepted";
  tradeSelfAcceptedEl.classList.toggle("accepted", session.activeTradeSnapshot.selfAccepted);
  tradePartnerAcceptedEl.textContent = session.activeTradeSnapshot.partnerAccepted ? "Accepted ✓" : "Not accepted";
  tradePartnerAcceptedEl.classList.toggle("accepted", session.activeTradeSnapshot.partnerAccepted);

  renderTradeAvailableInventory(session);
}

// The room.onMessage registrations themselves stay in main.ts (connection setup); these are the
// actual per-message handlers they delegate to.
export function handleTradeUpdate(session: GameSession, snapshot: TradeSnapshot) {
  session.activeTradeSnapshot = snapshot;
  renderTradeWindow(session);
}

export function handleGuildRoster(session: GameSession, snapshot: GuildRosterSnapshot) {
  session.activeGuildRoster = snapshot;
  renderGuildPanel(session);
}

export function setupSocialPanels(session: GameSession) {
  document.querySelector("[data-party-leave]")!.addEventListener("click", () => {
    activeRoom?.send("party_leave");
  });
  document.querySelector("[data-party-invite-accept]")!.addEventListener("click", () => {
    const message: PartyRespondMessage = { accept: true };
    activeRoom?.send("party_respond", message);
  });
  document.querySelector("[data-party-invite-decline]")!.addEventListener("click", () => {
    const message: PartyRespondMessage = { accept: false };
    activeRoom?.send("party_respond", message);
  });

  document.querySelector("[data-trade-invite-accept]")!.addEventListener("click", () => {
    const message: TradeRespondMessage = { accept: true };
    activeRoom?.send("trade_respond", message);
  });
  document.querySelector("[data-trade-invite-decline]")!.addEventListener("click", () => {
    const message: TradeRespondMessage = { accept: false };
    activeRoom?.send("trade_respond", message);
  });
  document.querySelector("[data-trade-accept]")!.addEventListener("click", () => activeRoom?.send("trade_accept"));
  document.querySelector("[data-trade-cancel]")!.addEventListener("click", () => {
    activeRoom?.send("trade_cancel");
    closeTradeWindow(session); // optimistic - a trade_cancelled echo will also arrive and no-op harmlessly
  });
  tradeSelfGoldInput.addEventListener("change", () => {
    if (!session.activeTradeSnapshot || !session.localPlayerSchema) return;
    const clamped = Math.max(0, Math.min(session.localPlayerSchema.gold, Math.floor(Number(tradeSelfGoldInput.value) || 0)));
    sendTradeOffer([...session.activeTradeSnapshot.selfOffer], clamped);
  });

  document.querySelector("[data-friend-add]")!.addEventListener("click", () => {
    sendFriendRequestByName(friendAddInput.value);
    friendAddInput.value = "";
  });
  friendAddInput.addEventListener("keydown", (e) => {
    if (e.code !== "Enter") return;
    sendFriendRequestByName(friendAddInput.value);
    friendAddInput.value = "";
  });

  document.querySelector("[data-guild-create]")!.addEventListener("click", () => {
    const name = guildNameInput.value.trim().slice(0, GUILD_NAME_MAX_LENGTH);
    if (!name) return;
    const message: GuildCreateMessage = { name };
    activeRoom?.send("guild_create", message);
    guildNameInput.value = "";
  });
  document.querySelector("[data-guild-invite]")!.addEventListener("click", () => {
    sendGuildInviteByName(guildInviteInput.value);
    guildInviteInput.value = "";
  });
  guildInviteInput.addEventListener("keydown", (e) => {
    if (e.code !== "Enter") return;
    sendGuildInviteByName(guildInviteInput.value);
    guildInviteInput.value = "";
  });
  document.querySelector("[data-guild-leave]")!.addEventListener("click", () => activeRoom?.send("guild_leave"));
  document.querySelector("[data-guild-disband]")!.addEventListener("click", () => activeRoom?.send("guild_disband"));
}
