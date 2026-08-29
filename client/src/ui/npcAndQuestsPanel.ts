import {
  AcceptQuestMessage,
  BuyItemMessage,
  ENEMY_TYPES,
  INVENTORY_SIZE,
  ITEMS,
  LearnProfessionMessage,
  MAX_LEARNED_PROFESSIONS,
  NPCS,
  NPC_INTERACT_RADIUS,
  NPC_QUEST_IDS,
  NpcDef,
  ProfessionId,
  PROFESSION_ICONS,
  PROFESSION_LABELS,
  QUESTS,
  QuestDef,
  RARITY_COLOR,
  RARITY_MULTIPLIER,
  SellItemMessage,
  SPAWN_POINTS,
  TurnInQuestMessage,
  VENDOR_SELL_FRACTION,
  decodeItemToken,
  encodeItemToken,
} from "@mmo/shared";
import { QuestAreaMarker } from "../game/Minimap";
import { QuestIndicatorState } from "../game/Npc";
import { activeRoom } from "../clientState";
import { GameSession } from "../GameSession";
import { buildShopSlot } from "./inventoryPanel";
import { makeDraggable } from "./DraggablePanel";

export const npcDialoguePanel = document.getElementById("npc-dialogue-panel")!;
const npcDialogueNameEl = document.querySelector<HTMLElement>("[data-npc-dialogue-name]")!;
const npcDialogueQuestsEl = document.getElementById("npc-dialogue-quests")!;
const npcDialogueBuyLabelEl = document.querySelector<HTMLElement>("[data-npc-dialogue-buy-label]")!;
const npcDialogueBuyListEl = document.getElementById("npc-dialogue-buy-list")!;
const npcDialogueSellLabelEl = document.querySelector<HTMLElement>("[data-npc-dialogue-sell-label]")!;
const npcDialogueSellListEl = document.getElementById("npc-dialogue-sell-list")!;
const npcDialogueTrainerLabelEl = document.querySelector<HTMLElement>("[data-npc-dialogue-trainer-label]")!;
const npcDialogueTrainerEl = document.getElementById("npc-dialogue-trainer")!;
export const questLogPanel = document.getElementById("quest-log-panel")!;
const questLogListEl = document.getElementById("quest-log-list")!;

makeDraggable(npcDialoguePanel, "npc-dialogue");
makeDraggable(questLogPanel, "quest-log");

type QuestState = "available" | "active" | "ready" | "completed";

export function questStateFor(session: GameSession, questId: string): QuestState {
  if (!session.localPlayerSchema) return "available";
  if (new Map(session.localPlayerSchema.questCompleted).has(questId)) return "completed";
  const progress = new Map(session.localPlayerSchema.questProgress).get(questId);
  if (progress === undefined) return "available";
  return progress >= QUESTS[questId].objectiveCount ? "ready" : "active";
}

function questObjectiveLabel(quest: QuestDef): string {
  const noun = quest.objectiveCount === 1 ? "Enemy" : "Enemies";
  const enemyName = ENEMY_TYPES[quest.objectiveEnemyTypeId]?.name ?? quest.objectiveEnemyTypeId;
  return `Kill ${quest.objectiveCount} ${enemyName} ${noun}`;
}

// Every reward a quest grants, shown wherever a quest itself is shown (the log and an NPC's
// dialogue) - not just XP, which used to be the only one never actually surfaced anywhere.
function questRewardLabel(quest: QuestDef): string {
  const parts = [`${quest.rewardXp} XP`];
  if (quest.rewardItemId) {
    const item = ITEMS[quest.rewardItemId];
    if (item) parts.push(`${item.icon} ${item.name}`);
  }
  if (quest.rewardGrantsMount) parts.push("🐴 Mount");
  return parts.join("  ·  ");
}

// Stable per-player numbering for every quest currently in the log (accepted, whether still
// in progress or ready to turn in) - questProgress is a MapSchema, so iteration order matches
// acceptance order, giving quest "3" the same meaning everywhere it's shown: the log, the
// giver's dialogue, and its map area circle (see computeQuestAreaMarkers below).
function activeQuestNumbers(session: GameSession): Map<string, number> {
  const numbers = new Map<string, number>();
  if (!session.localPlayerSchema) return numbers;
  let index = 1;
  for (const [questId] of session.localPlayerSchema.questProgress) numbers.set(questId, index++);
  return numbers;
}

// A quest has no location of its own - only an enemy type (QuestDef.objectiveEnemyTypeId) - so
// "where do I go" is derived from wherever that type actually spawns (SPAWN_POINTS), the same
// way an NPC's quest indicator is derived rather than authored. One circle per quest, centered
// on and sized to bound every matching spawn point (plus a flat margin so even a single spawn -
// e.g. the one-off world boss - still reads as a real area, not a pinpoint).
const QUEST_AREA_PADDING = 12;

export function computeQuestAreaMarkers(session: GameSession): QuestAreaMarker[] {
  if (!session.localPlayerSchema) return [];
  const markers: QuestAreaMarker[] = [];
  let index = 1;
  for (const [questId] of session.localPlayerSchema.questProgress) {
    const number = index++;
    const quest = QUESTS[questId];
    if (!quest) continue;
    const spawns = SPAWN_POINTS.filter((s) => s.enemyTypeId === quest.objectiveEnemyTypeId);
    if (spawns.length === 0) continue;

    const x = spawns.reduce((sum, s) => sum + s.x, 0) / spawns.length;
    const z = spawns.reduce((sum, s) => sum + s.z, 0) / spawns.length;
    const radius = Math.max(...spawns.map((s) => Math.hypot(s.x - x, s.z - z))) + QUEST_AREA_PADDING;
    markers.push({ x, z, radius, number });
  }
  return markers;
}

// Ready-to-turn-in takes priority (most actionable), then a new quest to offer, then a
// plain in-progress indicator - matches the classic "!"/"?" MMO convention.
function npcQuestIndicatorState(session: GameSession, npc: NpcDef): QuestIndicatorState {
  let anyAvailable = false;
  let anyActive = false;
  for (const questId of NPC_QUEST_IDS[npc.id] ?? []) {
    const state = questStateFor(session, questId);
    if (state === "ready") return "ready";
    if (state === "available") anyAvailable = true;
    if (state === "active") anyActive = true;
  }
  if (anyAvailable) return "available";
  if (anyActive) return "active";
  return "none";
}

export function updateNpcQuestIndicators(session: GameSession) {
  for (const [npcId, avatar] of session.npcs) {
    const npc = NPCS[npcId];
    if (!npc) continue;
    avatar.setQuestIndicator(npcQuestIndicatorState(session, npc));
  }
}

// Same per-NPC state as updateNpcQuestIndicators (the 3D in-world "!"/"?"), just handed to the
// minimap/big map instead of an NpcAvatar - see Minimap.ts's questIcon.
export function computeNpcQuestStates(session: GameSession): Map<string, QuestIndicatorState> {
  const states = new Map<string, QuestIndicatorState>();
  for (const npc of Object.values(NPCS)) {
    states.set(npc.id, npcQuestIndicatorState(session, npc));
  }
  return states;
}

export function renderNpcDialogue(session: GameSession) {
  if (!session.currentNpcDialogueId) return;
  const npc = NPCS[session.currentNpcDialogueId];
  if (!npc) return;

  npcDialogueNameEl.textContent = npc.name;
  npcDialogueQuestsEl.innerHTML = "";
  const questNumbers = activeQuestNumbers(session);

  for (const questId of NPC_QUEST_IDS[npc.id] ?? []) {
    const quest = QUESTS[questId];
    const state = questStateFor(session, questId);
    const progress = session.localPlayerSchema ? (new Map(session.localPlayerSchema.questProgress).get(questId) ?? 0) : 0;
    const number = questNumbers.get(questId);
    const numberBadge = number !== undefined ? `<span class="quest-number">${number}</span>` : "";

    const card = document.createElement("div");
    card.className = "talent-card";
    card.innerHTML = `
      <div class="talent-card-top"><span>${numberBadge}${quest.name}</span></div>
      <span class="talent-desc">${quest.description}</span>
      <span class="quest-objective">${questObjectiveLabel(quest)}</span>
      <span class="quest-reward">${questRewardLabel(quest)}</span>
    `;

    if (state === "available") {
      const btn = document.createElement("button");
      btn.className = "overlay-button accent";
      btn.textContent = "Accept";
      btn.addEventListener("click", () => {
        const message: AcceptQuestMessage = { questId };
        activeRoom?.send("accept_quest", message);
      });
      card.appendChild(btn);
    } else if (state === "active") {
      const status = document.createElement("span");
      status.className = "talent-rank";
      status.textContent = `${progress} / ${quest.objectiveCount}`;
      card.appendChild(status);
    } else if (state === "ready") {
      const btn = document.createElement("button");
      btn.className = "overlay-button accent";
      btn.textContent = "Turn In";
      btn.addEventListener("click", () => {
        const message: TurnInQuestMessage = { questId };
        activeRoom?.send("turn_in_quest", message);
      });
      card.appendChild(btn);
    } else {
      const status = document.createElement("span");
      status.className = "role-badge complete";
      status.textContent = "✓ Completed";
      card.appendChild(status);
    }

    npcDialogueQuestsEl.appendChild(card);
  }

  if (npc.vendorItemIds) {
    npcDialogueBuyLabelEl.hidden = false;
    npcDialogueSellLabelEl.hidden = false;
    renderVendorShop(session, npc);
  } else {
    npcDialogueBuyLabelEl.hidden = true;
    npcDialogueSellLabelEl.hidden = true;
    npcDialogueBuyListEl.innerHTML = "";
    npcDialogueSellListEl.innerHTML = "";
  }

  if (npc.teachesProfessionId) {
    npcDialogueTrainerLabelEl.hidden = false;
    renderNpcTrainerSection(session, npc.teachesProfessionId, npc.id);
  } else {
    npcDialogueTrainerLabelEl.hidden = true;
    npcDialogueTrainerEl.innerHTML = "";
  }
}

// A trainer NPC's whole offer is one profession - mirrors the quest card's own shape/status
// states (Accept/in-progress/Turn In/Completed) but simpler, since there's only ever one of
// these per trainer and no in-between progress state, just known-or-not.
function renderNpcTrainerSection(session: GameSession, professionId: ProfessionId, npcId: string) {
  npcDialogueTrainerEl.innerHTML = "";
  const professionXp = session.localPlayerSchema ? new Map(session.localPlayerSchema.professionXp) : new Map<string, number>();
  const learned = professionXp.has(professionId);
  const slotsFull = professionXp.size >= MAX_LEARNED_PROFESSIONS;

  const card = document.createElement("div");
  card.className = "talent-card";
  card.innerHTML = `<div class="talent-card-top"><span>${PROFESSION_ICONS[professionId]} ${PROFESSION_LABELS[professionId]}</span></div>`;

  if (learned) {
    const status = document.createElement("span");
    status.className = "role-badge complete";
    status.textContent = "✓ Learned";
    card.appendChild(status);
  } else {
    const btn = document.createElement("button");
    btn.className = "overlay-button accent";
    btn.textContent = "Learn";
    btn.disabled = slotsFull;
    btn.addEventListener("click", () => {
      const message: LearnProfessionMessage = { professionId, npcId };
      activeRoom?.send("learn_profession", message);
    });
    card.appendChild(btn);
    if (slotsFull) {
      const hint = document.createElement("span");
      hint.className = "talent-desc";
      hint.textContent = "Forget a profession first to learn a new one.";
      card.appendChild(hint);
    }
  }
  npcDialogueTrainerEl.appendChild(card);
}

// Buy always previews at common rarity (that's what a purchase actually yields, see
// WorldRoom.handleBuyItem); Sell lists the player's real inventory tokens at their real rarity.
function renderVendorShop(session: GameSession, npc: NpcDef) {
  npcDialogueBuyListEl.innerHTML = "";
  for (const itemId of npc.vendorItemIds ?? []) {
    const item = ITEMS[itemId];
    if (!item) continue;

    const gold = session.localPlayerSchema?.gold ?? 0;
    const inventoryFull = (session.localPlayerSchema ? [...session.localPlayerSchema.inventory].length : 0) >= INVENTORY_SIZE;
    const disabled = gold < item.basePrice || inventoryFull;

    npcDialogueBuyListEl.appendChild(
      buildShopSlot(item.icon, RARITY_COLOR.common, encodeItemToken(itemId, "common"), `💰${item.basePrice}`, disabled, () => {
        const message: BuyItemMessage = { npcId: npc.id, itemId };
        activeRoom?.send("buy_item", message);
      }),
    );
  }

  npcDialogueSellListEl.innerHTML = "";
  for (const token of session.localPlayerSchema ? [...session.localPlayerSchema.inventory] : []) {
    const decoded = decodeItemToken(token);
    const item = ITEMS[decoded.itemId];
    if (!item) continue;

    const sellPrice = Math.floor(item.basePrice * RARITY_MULTIPLIER[decoded.rarity] * VENDOR_SELL_FRACTION);
    npcDialogueSellListEl.appendChild(
      buildShopSlot(item.icon, RARITY_COLOR[decoded.rarity], token, `💰${sellPrice}`, false, () => {
        const message: SellItemMessage = { npcId: npc.id, token };
        activeRoom?.send("sell_item", message);
      }),
    );
  }
}

export function openNpcDialogue(session: GameSession, npcId: string) {
  const npc = NPCS[npcId];
  if (npc && !session.isNearWorldPoint(npc.x, npc.z, NPC_INTERACT_RADIUS)) {
    session.showActionFeedback("Too Far Away");
    return;
  }
  session.currentNpcDialogueId = npcId;
  npcDialoguePanel.hidden = false;
  renderNpcDialogue(session);
}

export function closeNpcDialogue(session: GameSession) {
  session.currentNpcDialogueId = null;
  npcDialoguePanel.hidden = true;
}

export function renderQuestLog(session: GameSession) {
  questLogListEl.innerHTML = "";
  if (!session.localPlayerSchema) return;
  let index = 1;
  for (const [questId, progress] of session.localPlayerSchema.questProgress) {
    const number = index++;
    const quest = QUESTS[questId];
    if (!quest) continue;
    const fraction = quest.objectiveCount > 0 ? Math.max(0, Math.min(1, progress / quest.objectiveCount)) : 0;
    const row = document.createElement("div");
    row.className = "item-row";
    row.style.flexDirection = "column";
    row.style.alignItems = "stretch";
    row.innerHTML = `
      <div style="display: flex; justify-content: space-between; width: 100%">
        <span><span class="quest-number">${number}</span>${quest.name}<span class="quest-objective">${questObjectiveLabel(quest)}</span><span class="quest-reward">${questRewardLabel(quest)}</span></span>
        <span class="item-slot-tag">${progress} / ${quest.objectiveCount}</span>
      </div>
      <div class="bar thin"><div class="bar-fill" style="width: ${fraction * 100}%; background: #c9a63c"></div></div>
    `;
    questLogListEl.appendChild(row);
  }
}

export function setupNpcAndQuestsPanel(session: GameSession) {
  document.querySelector("[data-npc-dialogue-close]")!.addEventListener("click", () => closeNpcDialogue(session));
}
