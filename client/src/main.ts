import * as THREE from "three";
import type { Room, SeatReservation } from "colyseus.js";
import {
  AcceptQuestMessage,
  BOSS_PHASE_2_HP_FRACTION,
  BossStats,
  BUFFS,
  BuffKind,
  BuyItemMessage,
  CastMessage,
  CasterStats,
  CHAT_MAX_LENGTH,
  ChatBroadcast,
  ChatChannel,
  ChatMessage,
  CLASSES,
  ClassId,
  ClassRole,
  CombatTextEvent,
  ContentSnapshot,
  DUNGEON_COMPOSITION,
  DUNGEON_PARTY_SIZE,
  DungeonJoinListingMessage,
  ENEMY_TYPES,
  EnemyBehavior,
  EquipMessage,
  EquipSlot,
  FURNITURE,
  InputMessage,
  INVENTORY_SIZE,
  ITEMS,
  loadGameContent,
  LootTakeMessage,
  MAP_HALF_EXTENT,
  MainStat,
  NPCS,
  NPC_QUEST_IDS,
  NpcDef,
  PARTY_MAX_SIZE,
  PLAYER_SPEED,
  PORTAL_POSITION,
  PartyInviteMessage,
  PartyRespondMessage,
  PlayerStats,
  QUESTS,
  QuestDef,
  RARITY_COLOR,
  RARITY_MULTIPLIER,
  RefundTalentMessage,
  resolveStructureCollisions,
  SPAWN_POINTS,
  SPELLS,
  SellItemMessage,
  SpellId,
  SpendTalentMessage,
  STRUCTURES,
  TALENTS,
  TalentDef,
  TradeOfferMessage,
  TradeRequestMessage,
  TradeRespondMessage,
  TradeSnapshot,
  TurnInQuestMessage,
  UnequipMessage,
  VENDOR_SELL_FRACTION,
  WAYPOINTS,
  WAYPOINT_INTERACT_RADIUS,
  WaypointTravelMessage,
  decodeItemToken,
  encodeItemToken,
  findStructureLoops,
  getEffectiveStats,
  getSpellCharges,
  getTerrainHeight,
  isTalentUnlocked,
  xpForNextLevel,
} from "@mmo/shared";
import { GameScene } from "./game/Scene";
import { AoeCircle } from "./game/AoeCircle";
import { FloatingCombatText } from "./game/FloatingCombatText";
import { playHitSound, playHealSound } from "./game/sfx";
import { PlayerAvatar } from "./game/Player";
import { EnemyAvatar } from "./game/Enemy";
import { NpcAvatar, QuestIndicatorState } from "./game/Npc";
import { StructureAvatar, StructureEnclosureAvatar } from "./game/Structure";
import { WaypointAvatar } from "./game/Waypoint";
import { FurnitureAvatar } from "./game/Furniture";
import { Minimap, QuestAreaMarker } from "./game/Minimap";
import { PortalAvatar } from "./game/Portal";
import { ProjectileAvatar } from "./game/Projectile";
import { LootBagAvatar } from "./game/LootBagAvatar";
import { InputController } from "./game/InputController";
import { connectToWorld, consumeDungeonReservation } from "./network/connection";
import * as api from "./network/api";
import { makeDraggable, makeResizable } from "./ui/DraggablePanel";

const PLAYER_PROJECTILE_COLOR = 0xff9a3c;
const PLAYER_PROJECTILE_EMISSIVE = 0xb35a12;
const ENEMY_PROJECTILE_COLOR = 0xd15fe0;
const ENEMY_PROJECTILE_EMISSIVE = 0x8a2fb0;
const INPUT_SEND_INTERVAL_MS = 1000 / 20;
const SERVER_RECONCILE_LERP = 0.02;
const RECONCILE_SNAP_DISTANCE = 3; // large corrections (e.g. death/respawn teleport) snap instead of creeping
const HOTBAR_SLOT_COUNT = 3;
const AILMENT_LABELS: Record<string, string> = { weaken: "Weakened" };

const hud = document.getElementById("hud")!;
const container = document.getElementById("app")!;
const minimap = new Minimap(document.getElementById("minimap") as HTMLCanvasElement);
const bigMapPanel = document.getElementById("big-map-panel")!;
const bigMapCanvas = document.getElementById("big-map") as HTMLCanvasElement;
const bigMap = new Minimap(bigMapCanvas, true);

// The panel is natively resizable (CSS `resize: both` on #big-map-panel) - keep the canvas's
// backing resolution matched to its actual displayed size as the user drags the corner handle,
// same devicePixelRatio cap GameScene's renderer uses, so the map stays crisp instead of just
// stretching whatever resolution it happened to start at. Minimap.update() reads canvas.width/
// height fresh every call, so no other wiring is needed for a resize to take effect.
const bigMapResizeObserver = new ResizeObserver((entries) => {
  const entry = entries[0];
  if (!entry) return;
  const { width, height } = entry.contentRect;
  const pixelRatio = Math.min(window.devicePixelRatio, 2);
  bigMapCanvas.width = Math.max(1, Math.round(width * pixelRatio));
  bigMapCanvas.height = Math.max(1, Math.round(height * pixelRatio));
});
bigMapResizeObserver.observe(bigMapCanvas);

const playerHpFill = document.querySelector<HTMLElement>("[data-player-hp-fill]")!;
const playerHpLabel = document.querySelector<HTMLElement>("[data-player-hp-label]")!;
const playerAilmentsEl = document.querySelector<HTMLElement>("[data-player-ailments]")!;
const playerBuffsEl = document.querySelector<HTMLElement>("[data-player-buffs]")!;
const playerCastBarEl = document.querySelector<HTMLElement>("[data-player-cast-bar]")!;
const playerCastFill = document.querySelector<HTMLElement>("[data-player-cast-fill]")!;
const playerCastLabel = document.querySelector<HTMLElement>("[data-player-cast-label]")!;

const targetPanel = document.getElementById("target-panel")!;
const targetNameEl = document.querySelector<HTMLElement>("[data-target-name]")!;
const targetHpFill = document.querySelector<HTMLElement>("[data-target-hp-fill]")!;
const targetHpLabel = document.querySelector<HTMLElement>("[data-target-hp-label]")!;
const targetCastBarEl = document.querySelector<HTMLElement>("[data-target-cast-bar]")!;
const targetCastFill = document.querySelector<HTMLElement>("[data-target-cast-fill]")!;
const targetCastNameEl = document.querySelector<HTMLElement>("[data-target-cast-name]")!;
const targetEnrageEl = document.querySelector<HTMLElement>("[data-target-enrage]")!;

const partyPanel = document.getElementById("party-panel")!;
const partyMemberListEl = document.getElementById("party-member-list")!;
const partyInvitePromptEl = document.getElementById("party-invite-prompt")!;
const partyInviteTextEl = document.querySelector<HTMLElement>("[data-party-invite-text]")!;

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

const dungeonFinderPanel = document.getElementById("dungeon-finder-panel")!;
const dungeonYourGroupEl = document.getElementById("dungeon-your-group")!;
const dungeonRoleChecklistEl = document.getElementById("dungeon-role-checklist")!;
const dungeonListingListEl = document.getElementById("dungeon-listing-list")!;
const dungeonOpenListingBtn = document.querySelector<HTMLButtonElement>("[data-dungeon-open-listing]")!;
const dungeonStartBtn = document.querySelector<HTMLButtonElement>("[data-dungeon-start]")!;

const dungeonStatusPanel = document.getElementById("dungeon-status-panel")!;
const dungeonEncounterLabelEl = document.querySelector<HTMLElement>("[data-dungeon-encounter-label]")!;
const leaveDungeonBtn = document.querySelector<HTMLButtonElement>("[data-leave-dungeon]")!;

const chatPanel = document.getElementById("chat-panel")!;
const chatLogEl = document.getElementById("chat-log")!;
const chatInputEl = document.getElementById("chat-input") as HTMLInputElement;
const chatTabEls = [...document.querySelectorAll<HTMLButtonElement>("[data-chat-channel]")];

const playerLevelEl = document.querySelector<HTMLElement>("[data-player-level]")!;
const playerGoldEl = document.querySelector<HTMLElement>("[data-player-gold]")!;
const playerClassEl = document.querySelector<HTMLElement>("[data-player-class]")!;
const characterClassEl = document.querySelector<HTMLElement>("[data-character-class]")!;
const xpFill = document.querySelector<HTMLElement>("[data-xp-fill]")!;
const xpLabel = document.querySelector<HTMLElement>("[data-xp-label]")!;
const statEls = {
  mainStat: document.querySelector<HTMLElement>("[data-stat-main]")!,
  vitality: document.querySelector<HTMLElement>("[data-stat-vitality]")!,
  luck: document.querySelector<HTMLElement>("[data-stat-luck]")!,
  armor: document.querySelector<HTMLElement>("[data-stat-armor]")!,
};
const mainStatLabelEl = document.querySelector<HTMLElement>("[data-stat-main-label]")!;

const equipRowEls: Record<EquipSlot, HTMLElement> = {
  weapon: document.querySelector<HTMLElement>('[data-equip-row="weapon"]')!,
  armor: document.querySelector<HTMLElement>('[data-equip-row="armor"]')!,
  trinket: document.querySelector<HTMLElement>('[data-equip-row="trinket"]')!,
};

const inventoryPanel = document.getElementById("inventory-panel")!;
const inventoryListEl = document.getElementById("inventory-list")!;

const lootWindow = document.getElementById("loot-window")!;
const lootListEl = document.getElementById("loot-list")!;

const waypointPanel = document.getElementById("waypoint-panel")!;
const waypointListEl = document.getElementById("waypoint-list")!;

const talentPanel = document.getElementById("talent-panel")!;
const talentListEl = document.getElementById("talent-list")!;
const talentPointsEl = document.querySelector<HTMLElement>("[data-talent-points]")!;

const npcDialoguePanel = document.getElementById("npc-dialogue-panel")!;
const npcDialogueNameEl = document.querySelector<HTMLElement>("[data-npc-dialogue-name]")!;
const npcDialogueQuestsEl = document.getElementById("npc-dialogue-quests")!;
const npcDialogueBuyLabelEl = document.querySelector<HTMLElement>("[data-npc-dialogue-buy-label]")!;
const npcDialogueBuyListEl = document.getElementById("npc-dialogue-buy-list")!;
const npcDialogueSellLabelEl = document.querySelector<HTMLElement>("[data-npc-dialogue-sell-label]")!;
const npcDialogueSellListEl = document.getElementById("npc-dialogue-sell-list")!;
const questLogPanel = document.getElementById("quest-log-panel")!;
const questLogListEl = document.getElementById("quest-log-list")!;

const itemTooltipEl = document.getElementById("item-tooltip")!;
const itemTooltipNameEl = document.querySelector<HTMLElement>("[data-tooltip-name]")!;
const itemTooltipSlotEl = document.querySelector<HTMLElement>("[data-tooltip-slot]")!;
const itemTooltipStatsEl = document.querySelector<HTMLElement>("[data-tooltip-stats]")!;
const itemTooltipDescEl = document.querySelector<HTMLElement>("[data-tooltip-desc]")!;

const talentTooltipEl = document.getElementById("talent-tooltip")!;
const talentTooltipNameEl = document.querySelector<HTMLElement>("[data-talent-tooltip-name]")!;
const talentTooltipRankEl = document.querySelector<HTMLElement>("[data-talent-tooltip-rank]")!;
const talentTooltipDescEl = document.querySelector<HTMLElement>("[data-talent-tooltip-desc]")!;
const talentTooltipLockEl = document.querySelector<HTMLElement>("[data-talent-tooltip-lock]")!;
const talentTooltipHintEl = document.querySelector<HTMLElement>("[data-talent-tooltip-hint]")!;

const contextMenuEl = document.getElementById("context-menu")!;
const contextMenuListEl = document.getElementById("context-menu-list")!;

interface ContextMenuAction {
  label: string;
  onClick: () => void;
}

function closeContextMenu() {
  contextMenuEl.hidden = true;
  contextMenuListEl.innerHTML = "";
}

function openContextMenu(x: number, y: number, actions: ContextMenuAction[]) {
  contextMenuListEl.innerHTML = "";
  for (const action of actions) {
    const btn = document.createElement("button");
    btn.className = "context-menu-item";
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      action.onClick();
      closeContextMenu();
    });
    contextMenuListEl.appendChild(btn);
  }

  contextMenuEl.hidden = false;
  const maxLeft = window.innerWidth - contextMenuEl.offsetWidth - 8;
  const maxTop = window.innerHeight - contextMenuEl.offsetHeight - 8;
  contextMenuEl.style.left = `${Math.min(x, Math.max(8, maxLeft))}px`;
  contextMenuEl.style.top = `${Math.min(y, Math.max(8, maxTop))}px`;
}

// A regular left-click anywhere outside the menu dismisses it - a separate event from the
// right-click that opens it, so this never races with openContextMenu.
document.addEventListener("click", (event) => {
  if (!contextMenuEl.hidden && !contextMenuEl.contains(event.target as Node)) closeContextMenu();
});

const STAT_LABELS: Record<Exclude<keyof PlayerStats, "mainStat">, string> = {
  vitality: "Vitality",
  luck: "Luck",
  armor: "Armor",
};

const MAIN_STAT_NAME: Record<MainStat, string> = {
  strength: "Strength",
  dexterity: "Dexterity",
  intellect: "Intellect",
};

// showItemTooltip is module-scoped (outside main()) so it can't see main()'s local
// `localPlayerSchema` - this tracks the local player's class id at module scope instead,
// set once main() knows it, purely so item tooltips can label a mainStat bonus correctly
// (e.g. "+3 Intellect" for an Oracle looking at a weapon, regardless of that weapon's flavor).
let localClassId: ClassId | null = null;

function labelForStat(stat: keyof PlayerStats): string {
  if (stat === "mainStat") {
    const mainStat = localClassId ? CLASSES[localClassId].mainStat : null;
    return mainStat ? MAIN_STAT_NAME[mainStat] : "Main Stat";
  }
  return STAT_LABELS[stat];
}

function positionItemTooltip(event: MouseEvent) {
  const offset = 16;
  const maxLeft = window.innerWidth - itemTooltipEl.offsetWidth - 8;
  const maxTop = window.innerHeight - itemTooltipEl.offsetHeight - 8;
  itemTooltipEl.style.left = `${Math.min(event.clientX + offset, Math.max(8, maxLeft))}px`;
  itemTooltipEl.style.top = `${Math.min(event.clientY + offset, Math.max(8, maxTop))}px`;
}

function showItemTooltip(token: string, event: MouseEvent) {
  const { itemId, rarity } = decodeItemToken(token);
  const item = ITEMS[itemId];
  if (!item) return;

  const multiplier = RARITY_MULTIPLIER[rarity];
  itemTooltipNameEl.textContent = item.name;
  itemTooltipNameEl.style.color = RARITY_COLOR[rarity];
  itemTooltipSlotEl.textContent = capitalize(item.slot);
  itemTooltipStatsEl.innerHTML = Object.entries(item.bonuses)
    .map(([stat, value]) => `<span>+${Math.round((value ?? 0) * multiplier)} ${labelForStat(stat as keyof PlayerStats)}</span>`)
    .join("");
  itemTooltipDescEl.textContent = item.description;

  itemTooltipEl.hidden = false;
  positionItemTooltip(event);
}

function hideItemTooltip() {
  itemTooltipEl.hidden = true;
}

function positionTalentTooltip(event: MouseEvent) {
  const offset = 16;
  const maxLeft = window.innerWidth - talentTooltipEl.offsetWidth - 8;
  const maxTop = window.innerHeight - talentTooltipEl.offsetHeight - 8;
  talentTooltipEl.style.left = `${Math.min(event.clientX + offset, Math.max(8, maxLeft))}px`;
  talentTooltipEl.style.top = `${Math.min(event.clientY + offset, Math.max(8, maxTop))}px`;
}

function showTalentTooltip(def: TalentDef, rank: number, locked: boolean, event: MouseEvent) {
  talentTooltipNameEl.textContent = def.name;
  talentTooltipRankEl.textContent = `Rank ${rank} / ${def.maxRank}`;
  talentTooltipDescEl.textContent = def.description;
  const prereq = def.prerequisiteTalentId ? TALENTS[def.prerequisiteTalentId] : undefined;
  talentTooltipLockEl.textContent = locked && prereq ? `Requires 1 point in ${prereq.name}` : "";
  talentTooltipHintEl.textContent = rank > 0 ? "Right-click to remove a point" : "";

  talentTooltipEl.hidden = false;
  positionTalentTooltip(event);
}

function hideTalentTooltip() {
  talentTooltipEl.hidden = true;
}

// Inventory slots are rebuilt on every render, so a plain listener bound at creation
// is fine. Equip slots are static DOM nodes reused across renders, so their tooltip
// listeners are bound once (below) and read the item id from a data attribute that
// renderEquipment keeps up to date, rather than rebinding a listener every render.
function attachItemTooltip(el: HTMLElement, itemId: string) {
  el.addEventListener("mouseenter", (event) => showItemTooltip(itemId, event as MouseEvent));
  el.addEventListener("mousemove", (event) => positionItemTooltip(event as MouseEvent));
  el.addEventListener("mouseleave", hideItemTooltip);
}

function bindPersistentItemTooltip(el: HTMLElement) {
  el.addEventListener("mouseenter", (event) => {
    if (el.dataset.itemId) showItemTooltip(el.dataset.itemId, event as MouseEvent);
  });
  el.addEventListener("mousemove", (event) => {
    if (el.dataset.itemId) positionItemTooltip(event as MouseEvent);
  });
  el.addEventListener("mouseleave", hideItemTooltip);
}

makeDraggable(document.getElementById("minimap-panel")!, "minimap");
makeDraggable(document.getElementById("big-map-panel")!, "big-map");
makeResizable(
  document.getElementById("big-map-panel")!,
  document.getElementById("big-map-resize-handle")!,
  "big-map",
  380,
  280,
);
makeDraggable(document.getElementById("player-panel")!, "player");
makeDraggable(document.getElementById("target-panel")!, "target");
makeDraggable(document.getElementById("spell-panel")!, "spells");
makeDraggable(document.getElementById("character-panel")!, "character");
makeDraggable(document.getElementById("xp-panel")!, "xp");
makeDraggable(inventoryPanel, "inventory");
makeDraggable(lootWindow, "loot");
makeDraggable(waypointPanel, "waypoint");
makeDraggable(talentPanel, "talents");
makeDraggable(npcDialoguePanel, "npc-dialogue");
makeDraggable(questLogPanel, "quest-log");
makeDraggable(partyPanel, "party");
makeDraggable(dungeonFinderPanel, "dungeon-finder");
makeDraggable(dungeonStatusPanel, "dungeon-status");
makeDraggable(chatPanel, "chat");
makeDraggable(tradeWindowEl, "trade");

// Set once main() establishes a connection; the equip/unequip/inventory click handlers
// below are bound once at module scope (their DOM elements are static), so they read
// this rather than a `room` captured in a closure that only exists for one connection.
let activeRoom: Room | undefined;

for (const slot of Object.keys(equipRowEls) as EquipSlot[]) {
  equipRowEls[slot].addEventListener("click", () => {
    const message: UnequipMessage = { slot };
    activeRoom?.send("unequip", message);
  });
  bindPersistentItemTooltip(equipRowEls[slot]);
}

interface PlayerStatsSnapshot {
  classId: string;
  level: number;
  xp: number;
  mainStat: number;
  vitality: number;
  luck: number;
  armor: number;
  gold: number;
  equippedWeapon: string;
  equippedArmor: string;
  equippedTrinket: string;
  inventory: Iterable<string>;
  talentPoints: number;
  talentRanks: Iterable<[string, number]>;
  questProgress: Iterable<[string, number]>;
  questCompleted: Iterable<[string, number]>;
  partyId: string;
}

function renderEquipment(player: PlayerStatsSnapshot) {
  const equipped: Record<EquipSlot, string> = {
    weapon: player.equippedWeapon,
    armor: player.equippedArmor,
    trinket: player.equippedTrinket,
  };

  for (const slot of Object.keys(equipped) as EquipSlot[]) {
    const token = equipped[slot];
    const decoded = token ? decodeItemToken(token) : undefined;
    const item = decoded ? ITEMS[decoded.itemId] : undefined;
    const el = equipRowEls[slot];
    el.textContent = item ? item.icon : "";
    el.classList.toggle("empty", !item);
    el.style.borderColor = item && decoded ? RARITY_COLOR[decoded.rarity] : "";
    if (item) el.dataset.itemId = token;
    else delete el.dataset.itemId;
  }
}

function renderInventory(player: PlayerStatsSnapshot) {
  inventoryListEl.innerHTML = "";
  const tokens = [...player.inventory];
  for (let i = 0; i < INVENTORY_SIZE; i++) {
    const token = tokens[i];
    const decoded = token ? decodeItemToken(token) : undefined;
    const item = decoded ? ITEMS[decoded.itemId] : undefined;

    const slotEl = document.createElement("button");
    slotEl.className = item ? "item-slot" : "item-slot empty";
    slotEl.textContent = item ? item.icon : "";
    if (item && decoded) slotEl.style.borderColor = RARITY_COLOR[decoded.rarity];
    if (item && token) {
      slotEl.addEventListener("click", () => {
        const message: EquipMessage = { itemId: token };
        activeRoom?.send("equip", message);
      });
      attachItemTooltip(slotEl, token);
    }
    inventoryListEl.appendChild(slotEl);
  }
}

const SVG_NS = "http://www.w3.org/2000/svg";

// A real prerequisite tree (see shared/src/types.ts's isTalentUnlocked): nodes are grid-positioned
// by tier/column, locked ones are greyed out and unclickable until their prerequisite has a point
// in it, and an SVG overlay draws a connector from every node to its prerequisite. The overlay is
// rebuilt from scratch alongside the nodes every render, then measured against their actual laid-
// out positions (getBoundingClientRect, relative to talentListEl's own box) once they're in the
// DOM - simpler than hand-computing tier/column pixel math, and stays correct if the grid's sizing
// ever changes.
function renderTalents(player: PlayerStatsSnapshot) {
  talentPointsEl.textContent = `${player.talentPoints} point${player.talentPoints === 1 ? "" : "s"}`;

  const ranks = new Map(player.talentRanks);
  const defs = Object.values(TALENTS).filter((def) => def.classId === player.classId);

  talentListEl.innerHTML = "";
  const linesEl = document.createElementNS(SVG_NS, "svg");
  linesEl.setAttribute("class", "talent-tree-lines");
  talentListEl.appendChild(linesEl);

  for (const def of defs) {
    const rank = ranks.get(def.id) ?? 0;
    const maxed = rank >= def.maxRank;
    const unlocked = isTalentUnlocked(def.id, player.talentRanks);
    const locked = !unlocked && rank <= 0;

    const node = document.createElement("button");
    node.dataset.talentId = def.id;
    node.style.gridRow = String(def.tier);
    node.style.gridColumn = String(def.column + 1);
    node.className = "talent-node" + (locked ? " locked" : maxed ? " maxed" : rank > 0 ? " ranked" : "");
    node.innerHTML = `
      <span class="talent-node-name">${def.name}</span>
      <span class="talent-node-rank">${rank} / ${def.maxRank}</span>
    `;
    if (!locked && !maxed) {
      node.addEventListener("click", () => {
        const message: SpendTalentMessage = { talentId: def.id };
        activeRoom?.send("spend_talent", message);
      });
    }
    if (rank > 0) {
      node.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        const message: RefundTalentMessage = { talentId: def.id };
        activeRoom?.send("refund_talent", message);
      });
    }
    node.addEventListener("mouseenter", (event) => showTalentTooltip(def, rank, locked, event as MouseEvent));
    node.addEventListener("mousemove", (event) => positionTalentTooltip(event as MouseEvent));
    node.addEventListener("mouseleave", hideTalentTooltip);
    talentListEl.appendChild(node);
  }

  const containerRect = talentListEl.getBoundingClientRect();
  linesEl.setAttribute("width", String(containerRect.width));
  linesEl.setAttribute("height", String(containerRect.height));
  for (const def of defs) {
    if (!def.prerequisiteTalentId) continue;
    const parentEl = talentListEl.querySelector<HTMLElement>(`[data-talent-id="${def.prerequisiteTalentId}"]`);
    const childEl = talentListEl.querySelector<HTMLElement>(`[data-talent-id="${def.id}"]`);
    if (!parentEl || !childEl) continue;

    const p = parentEl.getBoundingClientRect();
    const c = childEl.getBoundingClientRect();
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(p.left + p.width / 2 - containerRect.left));
    line.setAttribute("y1", String(p.bottom - containerRect.top));
    line.setAttribute("x2", String(c.left + c.width / 2 - containerRect.left));
    line.setAttribute("y2", String(c.top - containerRect.top));
    line.setAttribute("class", (ranks.get(def.prerequisiteTalentId) ?? 0) > 0 ? "talent-tree-line unlocked" : "talent-tree-line");
    linesEl.appendChild(line);
  }
}

function updateCharacterPanel(player: PlayerStatsSnapshot) {
  const className = CLASSES[player.classId as ClassId]?.name ?? player.classId;
  playerClassEl.textContent = className;
  characterClassEl.textContent = className;
  playerLevelEl.textContent = `Lv. ${player.level}`;
  playerGoldEl.textContent = `💰 ${player.gold}`;

  const needed = xpForNextLevel(player.level);
  const fraction = needed > 0 ? Math.max(0, Math.min(1, player.xp / needed)) : 0;
  xpFill.style.width = `${fraction * 100}%`;
  xpLabel.textContent = `${player.xp} / ${needed} XP`;

  const effective = getEffectiveStats(
    {
      mainStat: player.mainStat,
      vitality: player.vitality,
      luck: player.luck,
      armor: player.armor,
    },
    { weapon: player.equippedWeapon, armor: player.equippedArmor, trinket: player.equippedTrinket },
  );

  const mainStat = CLASSES[player.classId as ClassId]?.mainStat;
  mainStatLabelEl.textContent = mainStat ? MAIN_STAT_NAME[mainStat] : "Main Stat";
  statEls.mainStat.textContent = `${effective.mainStat}`;
  statEls.vitality.textContent = `${effective.vitality}`;
  statEls.luck.textContent = `${effective.luck}`;
  statEls.armor.textContent = `${effective.armor}`;

  renderEquipment(player);
  renderInventory(player);
  renderTalents(player);
}

function hpColor(fraction: number): string {
  return fraction > 0.5 ? "#4fd166" : fraction > 0.25 ? "#e0b23c" : "#e0503c";
}

// True for an enemy type that auto-engages any player within its aggroRange (red hp bar); false
// (the default) for one that only fights back once actually attacked (yellow) - see
// MeleeStats/CasterStats.aggroRange and HealthBar.setTypeColor.
function isAggressiveEnemyType(enemyTypeId: string): boolean {
  const stats = ENEMY_TYPES[enemyTypeId]?.stats;
  return !!(stats && "aggroRange" in stats && stats.aggroRange);
}

// Same red/yellow already meaningful elsewhere (low HP / mid HP) - reused so the target-panel
// bar matches the in-world HealthBar's passive/aggressive cue (see HealthBar.setTypeColor).
function typeColor(aggressive: boolean): string {
  return aggressive ? "#e0503c" : "#e0b23c";
}

function updateHpBar(fillEl: HTMLElement, labelEl: HTMLElement, hp: number, maxHp: number, colorOverride?: string) {
  const fraction = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
  fillEl.style.width = `${fraction * 100}%`;
  fillEl.style.background = colorOverride ?? hpColor(fraction);
  labelEl.textContent = `${Math.ceil(hp)}/${Math.ceil(maxHp)}`;
}

type Connector = () => ReturnType<typeof connectToWorld>;

async function main(token: string, characterId: number, connectOverride?: Connector, restorePartyId?: string) {
  const isDungeon = !!connectOverride;
  const gameScene = new GameScene(container, isDungeon);
  const input = new InputController();

  const avatars = new Map<string, PlayerAvatar>();
  const enemies = new Map<string, EnemyAvatar>();
  const enemySchemaById = new Map<
    string,
    {
      enemyTypeId: string;
      behavior: string;
      hp: number;
      maxHp: number;
      isCasting: boolean;
      enragesAt: number;
      aggroTargetId: string;
      castAbilityName: string;
    }
  >();
  const playerSchemaById = new Map<
    string,
    {
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
  >();
  const projectiles = new Map<string, ProjectileAvatar>();
  const lootBags = new Map<string, LootBagAvatar>();
  const lootBagSchemaById = new Map<string, { x: number; z: number; items: Iterable<string> }>();
  const dungeonListingSchemaById = new Map<string, { partyId: string; leaderSessionId: string; createdAt: number }>();

  // NPCs are static shared data (no hp, no server-synced position), so they're spawned once
  // from NPCS rather than synced through room state like enemies/players/loot bags. One with
  // no quest and no vendor catalog has no reason for a player to seek it out by a fixed spot,
  // so it wanders a little near its authored position instead of just standing there - purely
  // cosmetic (see NpcAvatar's `wander` flag), the interact/vendor logic still keys off NPCS[id]'s
  // authored x/z, unaffected by wherever the avatar has currently wandered to.
  const npcs = new Map<string, NpcAvatar>();
  for (const def of Object.values(NPCS)) {
    const wander = !def.vendorItemIds?.length && !(NPC_QUEST_IDS[def.id]?.length);
    const avatar = new NpcAvatar(wander);
    avatar.group.userData.npcId = def.id;
    avatar.setPosition(def.x, def.z, def.yOffset);
    avatar.setVendorIndicator(!!def.vendorItemIds);
    avatar.addTo(gameScene.scene);
    npcs.set(def.id, avatar);
  }

  // Waypoints are static shared data too, same as NPCs - a fast-travel destination list, not
  // synced room state.
  const waypoints = new Map<string, WaypointAvatar>();
  for (const def of WAYPOINTS) {
    const avatar = new WaypointAvatar();
    avatar.group.userData.waypointId = def.id;
    avatar.setPosition(def.x, def.z);
    avatar.addTo(gameScene.scene);
    waypoints.set(def.id, avatar);
  }

  // Furniture is static shared data too - purely decorative, never clicked/interacted with, so
  // unlike npcs/waypoints there's no userData tag or click handling to wire up for it.
  for (const def of FURNITURE) {
    const avatar = new FurnitureAvatar(def);
    avatar.addTo(gameScene.scene);
  }

  // Structures are static shared data too (no state, never move) - spawned once at boot the
  // same way as NPCs. Kept in an array (unlike npcs' Map) since nothing ever looks one up by id
  // client-side - they only need per-frame update() calls for a room's walk-in roof fade.
  // findStructureLoops re-derives every enclosed room purely from the wall/door list (see
  // shared/src/types.ts) - there's nothing else to load, an admin never authors a "room" directly.
  const structures: (StructureAvatar | StructureEnclosureAvatar)[] = [];
  for (const def of STRUCTURES) {
    const avatar = new StructureAvatar(def);
    avatar.addTo(gameScene.scene);
    structures.push(avatar);
  }
  for (const loop of findStructureLoops()) {
    const enclosure = new StructureEnclosureAvatar(loop);
    enclosure.addTo(gameScene.scene);
    structures.push(enclosure);
  }

  // The portal only exists in the overworld - it's how a dungeon instance is entered in
  // the first place, so it has no reason to be present once already inside one.
  let portal: PortalAvatar | undefined;
  if (!isDungeon) {
    portal = new PortalAvatar();
    portal.group.userData.isPortal = true;
    portal.setPosition(PORTAL_POSITION.x, PORTAL_POSITION.z);
    portal.addTo(gameScene.scene);
  }

  // Follows the cursor while a ground-targeted spell (Explosive Trap, Blizzard) is pending
  // placement - see the "click" listener below for how pendingGroundTargetSpellId drives it.
  const groundTargetPreview = new AoeCircle();
  gameScene.scene.add(groundTargetPreview.mesh);

  const combatText = new FloatingCombatText(gameScene.scene);

  let room: Room | undefined;
  let localSessionId: string | null = null;
  let currentTargetId: string | null = null;
  let currentLootBagId: string | null = null;
  let currentNpcDialogueId: string | null = null;
  let currentWaypointId: string | null = null;
  let localPlayerSchema: PlayerStatsSnapshot | undefined;
  let pendingGroundTargetSpellId: SpellId | null = null;
  let pendingGroundTargetSlotIndex: number | null = null;
  let lastGroundCursorX = 0;
  let lastGroundCursorZ = 0;

  let localHp = 0;
  let localMaxHp = 0;
  let localCastSpellId = "";
  let localCastActive = false;
  let localCastStartRef = 0;

  let targetCastActive = false;
  let targetCastStartRef = 0;

  const localPredicted = new THREE.Vector3(0, 0, 0);
  const localServerPosition = new THREE.Vector3(0, 0, 0);
  const followTargetScratch = new THREE.Vector3(0, 0, 0); // localPredicted.y stays gameplay-0 always; this carries terrain height for the camera only
  let localRotationY = 0;
  let seq = 0;

  // Per spell, cast timestamps still within their cooldown window - purely a client-side
  // prediction for the hotbar's cooldown sweep/charge badge, same as before charges existed;
  // the server (CombatEngine's own identically-shaped lastCastAt) is still the sole authority
  // and silently ignores casts that violate its own gate.
  const lastClientCastAt = new Map<SpellId, number[]>();

  // Hotbar slots are keyed by position (0/1/2), not spell identity - the same DOM node
  // holds a different spell per class. slotSpellIds is populated once the local player's
  // class is known (setupHotbarForClass), since class never changes mid-session.
  const spellSlotEls: HTMLElement[] = [];
  const cooldownEls: HTMLElement[] = [];
  const nameEls: HTMLElement[] = [];
  const chargesEls: HTMLElement[] = [];
  for (let i = 0; i < HOTBAR_SLOT_COUNT; i++) {
    spellSlotEls.push(document.querySelector(`[data-slot="${i}"]`)!);
    cooldownEls.push(document.querySelector(`[data-cooldown="${i}"]`)!);
    nameEls.push(document.querySelector(`[data-name="${i}"]`)!);
    chargesEls.push(document.querySelector(`[data-charges="${i}"]`)!);
  }
  let slotSpellIds: SpellId[] = [];

  function setupHotbarForClass(classId: string) {
    slotSpellIds = Object.values(SPELLS)
      .filter((s) => s.classId === classId)
      .map((s) => s.id);
    for (let i = 0; i < spellSlotEls.length; i++) {
      const id = slotSpellIds[i];
      nameEls[i].textContent = id ? SPELLS[id].name : "";
    }
  }

  function updateHud() {
    if (!localSessionId) return;
    hud.textContent = `Connected as ${localSessionId}`;
  }

  function updateAilmentIndicator(player: { ailments: Iterable<[string, number]> }) {
    const now = Date.now();
    const active: string[] = [];
    for (const [kind, expiresAt] of player.ailments) {
      if (expiresAt > now) active.push(AILMENT_LABELS[kind] ?? kind);
    }
    playerAilmentsEl.textContent = active.join(", ");
    playerAilmentsEl.hidden = active.length === 0;
  }

  // Mirrors updateAilmentIndicator - same lazy expiresAt>now filter, same textContent-join
  // rendering - just for caster-beneficial buffs (see BuffKind/BUFFS) instead of enemy debuffs.
  function updateBuffIndicator(player: { buffs: Iterable<[string, number]> }) {
    const now = Date.now();
    const active: string[] = [];
    for (const [kind, expiresAt] of player.buffs) {
      if (expiresAt > now) active.push(BUFFS[kind as BuffKind]?.name ?? kind);
    }
    playerBuffsEl.textContent = active.join(", ");
    playerBuffsEl.hidden = active.length === 0;
  }

  function renderPartyPanel() {
    const local = localSessionId ? playerSchemaById.get(localSessionId) : undefined;
    const partyId = local?.partyId ?? "";
    if (!partyId) {
      partyPanel.hidden = true;
      return;
    }

    partyPanel.hidden = false;
    partyMemberListEl.innerHTML = "";
    for (const [sessionId, schema] of playerSchemaById) {
      if (schema.partyId !== partyId) continue;

      const className = CLASSES[schema.classId as ClassId]?.name ?? schema.classId;
      const label = sessionId === localSessionId ? `${schema.name} (You)` : schema.name;
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
      row.addEventListener("click", () => setTarget(sessionId));
      partyMemberListEl.appendChild(row);
    }
  }

  function renderPartyInvitePrompt(player: { pendingPartyInviteFrom: string }) {
    const inviterId = player.pendingPartyInviteFrom;
    if (!inviterId) {
      partyInvitePromptEl.hidden = true;
      return;
    }

    const inviter = playerSchemaById.get(inviterId);
    const inviterLabel = inviter?.name || (inviter ? (CLASSES[inviter.classId as ClassId]?.name ?? "Someone") : "Someone");
    partyInviteTextEl.textContent = `${inviterLabel} wants to group with you.`;
    partyInvitePromptEl.hidden = false;
  }

  // Guards mirror the server's own checks in handlePartyInvite, so an obviously-invalid
  // invite (self, already grouped, party full) never shows up as a menu option at all.
  function canInviteToParty(targetSessionId: string): boolean {
    if (!localSessionId || targetSessionId === localSessionId) return false;
    const local = playerSchemaById.get(localSessionId);
    const target = playerSchemaById.get(targetSessionId);
    if (!local || !target) return false;
    if (local.partyId && local.partyId === target.partyId) return false; // already grouped together
    if (
      local.partyId &&
      [...playerSchemaById.values()].filter((s) => s.partyId === local.partyId).length >= PARTY_MAX_SIZE
    ) {
      return false;
    }
    return true;
  }

  function sendPartyInvite(targetSessionId: string) {
    if (!canInviteToParty(targetSessionId)) return;
    const message: PartyInviteMessage = { targetSessionId };
    room?.send("party_invite", message);
  }

  function renderTradeInvitePrompt(player: { pendingTradeRequestFrom: string }) {
    const requesterId = player.pendingTradeRequestFrom;
    if (!requesterId) {
      tradeInvitePromptEl.hidden = true;
      return;
    }

    const requester = playerSchemaById.get(requesterId);
    const requesterLabel =
      requester?.name || (requester ? (CLASSES[requester.classId as ClassId]?.name ?? "Someone") : "Someone");
    tradeInviteTextEl.textContent = `${requesterLabel} wants to trade with you.`;
    tradeInvitePromptEl.hidden = false;
  }

  // No distance check here on purpose, mirroring canInviteToParty's precedent - the server is
  // the sole authority on TRADE_RANGE, checked at request time and continuously while trading.
  function canTrade(targetSessionId: string): boolean {
    if (!localSessionId || targetSessionId === localSessionId) return false;
    if (activeTradeSnapshot) return false; // already mid-trade
    return playerSchemaById.has(targetSessionId);
  }

  function sendTradeRequest(targetSessionId: string) {
    if (!canTrade(targetSessionId)) return;
    const message: TradeRequestMessage = { targetSessionId };
    room?.send("trade_request", message);
  }

  // Right-click (on the 3D avatar or the target panel) opens this menu - the single entry
  // point for player-targeted actions, always with Invite first per the established convention.
  function actionsForPlayerTarget(targetSessionId: string): ContextMenuAction[] {
    const actions: ContextMenuAction[] = [];
    if (canInviteToParty(targetSessionId)) {
      actions.push({ label: "Invite to Party", onClick: () => sendPartyInvite(targetSessionId) });
    }
    if (canTrade(targetSessionId)) {
      actions.push({ label: "Trade", onClick: () => sendTradeRequest(targetSessionId) });
    }
    return actions;
  }

  // Trade window state always mirrors the last server-pushed TradeSnapshot - there is no
  // separately-tracked local offer, so there is nothing that can drift out of sync with it.
  let activeTradeSnapshot: TradeSnapshot | null = null;

  function closeTradeWindow() {
    activeTradeSnapshot = null;
    tradeWindowEl.hidden = true;
  }

  function sendTradeOffer(items: string[], gold: number) {
    const message: TradeOfferMessage = { items, gold };
    room?.send("trade_offer", message);
  }

  function toggleTradeOfferItem(token: string) {
    if (!activeTradeSnapshot) return;
    const offer = [...activeTradeSnapshot.selfOffer];
    const index = offer.indexOf(token);
    if (index === -1) offer.push(token);
    else offer.splice(index, 1);
    sendTradeOffer(offer, activeTradeSnapshot.selfGold);
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

  function renderTradeAvailableInventory() {
    tradeInventoryListEl.innerHTML = "";
    if (!localPlayerSchema || !activeTradeSnapshot) return;

    // Duplicate tokens: skip exactly one occurrence per offered copy so a second identical
    // item still shows as available (mirrors trade.ts's hasAtLeast multiset check server-side).
    const offeredCounts = new Map<string, number>();
    for (const token of activeTradeSnapshot.selfOffer) offeredCounts.set(token, (offeredCounts.get(token) ?? 0) + 1);

    for (const token of localPlayerSchema.inventory) {
      const remaining = offeredCounts.get(token) ?? 0;
      if (remaining > 0) {
        offeredCounts.set(token, remaining - 1);
        continue;
      }
      tradeInventoryListEl.appendChild(renderTradeItemSlot(token, () => toggleTradeOfferItem(token)));
    }
  }

  function renderTradeWindow() {
    if (!activeTradeSnapshot) return;
    tradeWindowEl.hidden = false;
    tradePartnerNameEl.textContent = activeTradeSnapshot.partnerName;

    tradeSelfOfferEl.innerHTML = "";
    for (const token of activeTradeSnapshot.selfOffer) {
      tradeSelfOfferEl.appendChild(renderTradeItemSlot(token, () => toggleTradeOfferItem(token)));
    }

    tradePartnerOfferEl.innerHTML = "";
    for (const token of activeTradeSnapshot.partnerOffer) {
      tradePartnerOfferEl.appendChild(renderTradeItemSlot(token));
    }

    // Never overwrite the input while the player is actively typing in it (see the identical
    // guard pattern chat's own input avoids via blur-on-send).
    if (document.activeElement !== tradeSelfGoldInput) tradeSelfGoldInput.value = String(activeTradeSnapshot.selfGold);
    if (localPlayerSchema) tradeSelfGoldInput.max = String(localPlayerSchema.gold);
    tradePartnerGoldInput.value = String(activeTradeSnapshot.partnerGold);

    tradeSelfAcceptedEl.textContent = activeTradeSnapshot.selfAccepted ? "Accepted ✓" : "Not accepted";
    tradeSelfAcceptedEl.classList.toggle("accepted", activeTradeSnapshot.selfAccepted);
    tradePartnerAcceptedEl.textContent = activeTradeSnapshot.partnerAccepted ? "Accepted ✓" : "Not accepted";
    tradePartnerAcceptedEl.classList.toggle("accepted", activeTradeSnapshot.partnerAccepted);

    renderTradeAvailableInventory();
  }

  function setTarget(id: string | null) {
    if (currentTargetId) {
      enemies.get(currentTargetId)?.setSelected(false);
      avatars.get(currentTargetId)?.setSelected(false);
    }
    currentTargetId = id;
    targetCastActive = false;
    targetCastBarEl.hidden = true;

    if (!id) {
      targetPanel.hidden = true;
      return;
    }

    const enemySchema = enemySchemaById.get(id);
    if (enemySchema) {
      enemies.get(id)?.setSelected(true);
      targetPanel.hidden = false;
      targetNameEl.textContent = ENEMY_TYPES[enemySchema.enemyTypeId]?.name ?? enemySchema.enemyTypeId;
      // Bosses have no passive/aggressive type to show (see Enemy.ts's setHp) - omitting the
      // override falls back to updateHpBar's normal HP-fraction gradient for them.
      updateHpBar(
        targetHpFill,
        targetHpLabel,
        enemySchema.hp,
        enemySchema.maxHp,
        enemySchema.behavior === "boss" ? undefined : typeColor(isAggressiveEnemyType(enemySchema.enemyTypeId)),
      );
      if (enemySchema.isCasting) {
        targetCastActive = true;
        targetCastStartRef = performance.now();
        targetCastBarEl.hidden = false;
        targetCastNameEl.textContent = enemySchema.castAbilityName || "Casting…";
      }
      return;
    }

    const playerSchema = playerSchemaById.get(id);
    if (playerSchema) {
      avatars.get(id)?.setSelected(true);
      targetPanel.hidden = false;
      const className = CLASSES[playerSchema.classId as ClassId]?.name ?? playerSchema.classId;
      targetNameEl.textContent = id === localSessionId ? `${className} (You)` : className;
      updateHpBar(targetHpFill, targetHpLabel, playerSchema.hp, playerSchema.maxHp);
      if (playerSchema.castSpellId !== "") {
        targetCastActive = true;
        targetCastStartRef = performance.now();
        targetCastBarEl.hidden = false;
        targetCastNameEl.textContent = "Casting…";
      }
      return;
    }

    targetPanel.hidden = true;
  }

  // 1 base charge plus any spent extraCharges talents - identical shared helper to what
  // CombatEngine uses server-side, so this prediction stays in lockstep with the real gate.
  function maxChargesFor(spellId: SpellId): number {
    if (!localClassId || !localPlayerSchema) return 1;
    return 1 + getSpellCharges(localClassId, spellId, localPlayerSchema.talentRanks);
  }

  function activeCastsFor(spellId: SpellId, now: number): number[] {
    const cooldownMs = SPELLS[spellId].cooldownMs;
    return (lastClientCastAt.get(spellId) ?? []).filter((t) => now - t < cooldownMs);
  }

  function sendCast(spellId: SpellId, message: CastMessage) {
    const now = performance.now();
    const active = activeCastsFor(spellId, now);
    active.push(now);
    lastClientCastAt.set(spellId, active);
    room?.send("cast", message);
  }

  // Mirrors CombatEngine.RANGE_BUFFER (a small allowance for latency between this check and the
  // server's own) so an "in range" verdict here doesn't diverge from what the server will accept.
  const CLIENT_RANGE_BUFFER = 1;

  function isWithinSpellRange(spellId: SpellId, targetX: number, targetZ: number): boolean {
    const dist = Math.hypot(localPredicted.x - targetX, localPredicted.z - targetZ);
    return dist <= SPELLS[spellId].range + CLIENT_RANGE_BUFFER;
  }

  // Briefly flashes a hotbar slot red on top of whatever steady state it's already in - the extra
  // acknowledgment for a cast that was just refused for being out of range (see castSpell/the
  // ground-target click handler below). The steady "too-far" state itself is driven continuously
  // by isSpellOutOfRange, not by this.
  function flashOutOfRange(slotIndex: number) {
    const el = spellSlotEls[slotIndex];
    if (!el) return;
    el.classList.remove("out-of-range");
    void el.offsetWidth; // force reflow so re-adding the class restarts the CSS animation
    el.classList.add("out-of-range");
    el.addEventListener("animationend", () => el.classList.remove("out-of-range"), { once: true });
  }

  // Live (not cast-attempt-gated) check of whether a slot's spell would currently reach its
  // would-be target - drives the hotbar's steady red border every frame so it clears the instant
  // the player walks back into range, without needing another cast attempt. "ally" mirrors the
  // server's own fallback-to-self (see CombatEngine.resolveCastTarget), which is always in range,
  // so only an explicitly-selected other player counts; "ground" only applies while that spell's
  // placement is the one currently pending, checked against the last known cursor position.
  function isSpellOutOfRange(spellId: SpellId): boolean {
    const spell = SPELLS[spellId];
    if (spell.targetType === "enemy") {
      if (!currentTargetId || !enemySchemaById.has(currentTargetId)) return false;
      const pos = enemies.get(currentTargetId)?.group.position;
      return pos ? !isWithinSpellRange(spellId, pos.x, pos.z) : false;
    }
    if (spell.targetType === "ally") {
      if (!currentTargetId || currentTargetId === localSessionId || !playerSchemaById.has(currentTargetId)) return false;
      const pos = avatars.get(currentTargetId)?.group.position;
      return pos ? !isWithinSpellRange(spellId, pos.x, pos.z) : false;
    }
    if (spell.targetType === "ground") {
      if (pendingGroundTargetSpellId !== spellId) return false;
      return !isWithinSpellRange(spellId, lastGroundCursorX, lastGroundCursorZ);
    }
    return false;
  }

  // Range is checked here, client-side, purely so an out-of-range attempt never calls sendCast in
  // the first place - the server already refuses the cast for the same reason (see CombatEngine's
  // own dist check in handleCast, which runs before it consumes a charge), but by then the
  // hotbar's cooldown sweep has already started predicting a cast that will never land.
  function castSpell(slotIndex: number) {
    if (!room) return;
    const spellId = slotSpellIds[slotIndex];
    if (!spellId) return;

    const spell = SPELLS[spellId];
    const now = performance.now();
    if (activeCastsFor(spellId, now).length >= maxChargesFor(spellId)) return;

    if (spell.targetType === "ground") {
      pendingGroundTargetSpellId = spellId;
      pendingGroundTargetSlotIndex = slotIndex;
      container.classList.add("ground-target-pending");
      groundTargetPreview.setRadius(spell.aoeRadius ?? 0);
      groundTargetPreview.show();
      return;
    }

    if (spell.targetType === "enemy") {
      if (!currentTargetId || !enemySchemaById.has(currentTargetId)) return;
      const enemyPos = enemies.get(currentTargetId)?.group.position;
      if (enemyPos && !isWithinSpellRange(spellId, enemyPos.x, enemyPos.z)) {
        flashOutOfRange(slotIndex);
        return;
      }
      sendCast(spellId, { spellId, targetId: currentTargetId });
    } else if (spell.targetType === "ally") {
      const targetId = currentTargetId && playerSchemaById.has(currentTargetId) ? currentTargetId : localSessionId ?? undefined;
      if (targetId && targetId !== localSessionId) {
        const allyPos = avatars.get(targetId)?.group.position;
        if (allyPos && !isWithinSpellRange(spellId, allyPos.x, allyPos.z)) {
          flashOutOfRange(slotIndex);
          return;
        }
      }
      sendCast(spellId, { spellId, targetId });
    } else if (spell.targetType === "self") {
      sendCast(spellId, { spellId });
    }
  }

  function cancelPendingGroundTarget() {
    if (!pendingGroundTargetSpellId) return;
    pendingGroundTargetSpellId = null;
    pendingGroundTargetSlotIndex = null;
    container.classList.remove("ground-target-pending");
    groundTargetPreview.hide();
  }

  function renderLootWindow() {
    if (!currentLootBagId) return;
    const bag = lootBagSchemaById.get(currentLootBagId);
    if (!bag) {
      closeLootWindow();
      return;
    }

    lootListEl.innerHTML = "";
    for (const token of bag.items) {
      const { itemId, rarity } = decodeItemToken(token);
      const item = ITEMS[itemId];
      if (!item) continue;

      const row = document.createElement("button");
      row.className = "item-row";
      row.innerHTML = `<span style="color: ${RARITY_COLOR[rarity]}">${item.name}</span><span class="item-slot-tag">${capitalize(item.slot)}</span>`;
      row.addEventListener("click", () => {
        const message: LootTakeMessage = { bagId: currentLootBagId!, itemId: token };
        room?.send("loot_take", message);
      });
      lootListEl.appendChild(row);
    }
  }

  function openLootWindow(bagId: string) {
    currentLootBagId = bagId;
    lootWindow.hidden = false;
    renderLootWindow();
  }

  function closeLootWindow() {
    currentLootBagId = null;
    lootWindow.hidden = true;
  }

  document.querySelector("[data-loot-close]")!.addEventListener("click", () => closeLootWindow());
  document.querySelector("[data-loot-take-all]")!.addEventListener("click", () => {
    if (!currentLootBagId) return;
    const bag = lootBagSchemaById.get(currentLootBagId);
    if (!bag) return;
    for (const itemId of [...bag.items]) {
      const message: LootTakeMessage = { bagId: currentLootBagId, itemId };
      room?.send("loot_take", message);
    }
  });

  // Lists every OTHER waypoint on the map - the server independently re-validates that the
  // player is actually standing near some waypoint (see WorldRoom.handleWaypointTravel), this
  // just keeps the current one from pointlessly listing itself as a destination.
  function renderWaypointPanel() {
    if (!currentWaypointId) return;

    waypointListEl.innerHTML = "";
    for (const def of WAYPOINTS) {
      if (def.id === currentWaypointId) continue;

      const row = document.createElement("button");
      row.className = "item-row";
      row.textContent = def.name;
      row.addEventListener("click", () => {
        const message: WaypointTravelMessage = { targetWaypointId: def.id };
        room?.send("waypoint_travel", message);
        closeWaypointPanel();
      });
      waypointListEl.appendChild(row);
    }
  }

  function openWaypointPanel(waypointId: string) {
    currentWaypointId = waypointId;
    waypointPanel.hidden = false;
    renderWaypointPanel();
  }

  function closeWaypointPanel() {
    currentWaypointId = null;
    waypointPanel.hidden = true;
  }

  document.querySelector("[data-waypoint-close]")!.addEventListener("click", () => closeWaypointPanel());

  type QuestState = "available" | "active" | "ready" | "completed";

  function questStateFor(questId: string): QuestState {
    if (!localPlayerSchema) return "available";
    if (new Map(localPlayerSchema.questCompleted).has(questId)) return "completed";
    const progress = new Map(localPlayerSchema.questProgress).get(questId);
    if (progress === undefined) return "available";
    return progress >= QUESTS[questId].objectiveCount ? "ready" : "active";
  }

  function questObjectiveLabel(quest: QuestDef): string {
    const noun = quest.objectiveCount === 1 ? "Enemy" : "Enemies";
    const enemyName = ENEMY_TYPES[quest.objectiveEnemyTypeId]?.name ?? quest.objectiveEnemyTypeId;
    return `Kill ${quest.objectiveCount} ${enemyName} ${noun}`;
  }

  // Stable per-player numbering for every quest currently in the log (accepted, whether still
  // in progress or ready to turn in) - questProgress is a MapSchema, so iteration order matches
  // acceptance order, giving quest "3" the same meaning everywhere it's shown: the log, the
  // giver's dialogue, and its map area circle (see computeQuestAreaMarkers below).
  function activeQuestNumbers(): Map<string, number> {
    const numbers = new Map<string, number>();
    if (!localPlayerSchema) return numbers;
    let index = 1;
    for (const [questId] of localPlayerSchema.questProgress) numbers.set(questId, index++);
    return numbers;
  }

  // A quest has no location of its own - only an enemy type (QuestDef.objectiveEnemyTypeId) - so
  // "where do I go" is derived from wherever that type actually spawns (SPAWN_POINTS), the same
  // way an NPC's quest indicator is derived rather than authored. One circle per quest, centered
  // on and sized to bound every matching spawn point (plus a flat margin so even a single spawn -
  // e.g. the one-off world boss - still reads as a real area, not a pinpoint).
  const QUEST_AREA_PADDING = 12;

  function computeQuestAreaMarkers(): QuestAreaMarker[] {
    if (!localPlayerSchema) return [];
    const markers: QuestAreaMarker[] = [];
    let index = 1;
    for (const [questId] of localPlayerSchema.questProgress) {
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
  function npcQuestIndicatorState(npc: NpcDef): QuestIndicatorState {
    let anyAvailable = false;
    let anyActive = false;
    for (const questId of NPC_QUEST_IDS[npc.id] ?? []) {
      const state = questStateFor(questId);
      if (state === "ready") return "ready";
      if (state === "available") anyAvailable = true;
      if (state === "active") anyActive = true;
    }
    if (anyAvailable) return "available";
    if (anyActive) return "active";
    return "none";
  }

  function updateNpcQuestIndicators() {
    for (const [npcId, avatar] of npcs) {
      const npc = NPCS[npcId];
      if (!npc) continue;
      avatar.setQuestIndicator(npcQuestIndicatorState(npc));
    }
  }

  // Same per-NPC state as updateNpcQuestIndicators (the 3D in-world "!"/"?"), just handed to the
  // minimap/big map instead of an NpcAvatar - see Minimap.ts's questIcon.
  function computeNpcQuestStates(): Map<string, QuestIndicatorState> {
    const states = new Map<string, QuestIndicatorState>();
    for (const npc of Object.values(NPCS)) {
      states.set(npc.id, npcQuestIndicatorState(npc));
    }
    return states;
  }

  function renderNpcDialogue() {
    if (!currentNpcDialogueId) return;
    const npc = NPCS[currentNpcDialogueId];
    if (!npc) return;

    npcDialogueNameEl.textContent = npc.name;
    npcDialogueQuestsEl.innerHTML = "";
    const questNumbers = activeQuestNumbers();

    for (const questId of NPC_QUEST_IDS[npc.id] ?? []) {
      const quest = QUESTS[questId];
      const state = questStateFor(questId);
      const progress = localPlayerSchema ? (new Map(localPlayerSchema.questProgress).get(questId) ?? 0) : 0;
      const number = questNumbers.get(questId);
      const numberBadge = number !== undefined ? `<span class="quest-number">${number}</span>` : "";

      const card = document.createElement("div");
      card.className = "talent-card";
      card.innerHTML = `
        <div class="talent-card-top"><span>${numberBadge}${quest.name}</span></div>
        <span class="talent-desc">${quest.description}</span>
        <span class="quest-objective">${questObjectiveLabel(quest)}</span>
      `;

      if (state === "available") {
        const btn = document.createElement("button");
        btn.className = "overlay-button";
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
        btn.className = "overlay-button";
        btn.textContent = "Turn In";
        btn.addEventListener("click", () => {
          const message: TurnInQuestMessage = { questId };
          activeRoom?.send("turn_in_quest", message);
        });
        card.appendChild(btn);
      } else {
        const status = document.createElement("span");
        status.className = "talent-rank";
        status.textContent = "Completed";
        card.appendChild(status);
      }

      npcDialogueQuestsEl.appendChild(card);
    }

    if (npc.vendorItemIds) {
      npcDialogueBuyLabelEl.hidden = false;
      npcDialogueSellLabelEl.hidden = false;
      renderVendorShop(npc);
    } else {
      npcDialogueBuyLabelEl.hidden = true;
      npcDialogueSellLabelEl.hidden = true;
      npcDialogueBuyListEl.innerHTML = "";
      npcDialogueSellListEl.innerHTML = "";
    }
  }

  function buildShopSlot(
    icon: string,
    borderColor: string,
    tooltipToken: string,
    priceLabel: string,
    disabled: boolean,
    onClick: () => void,
  ): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "shop-slot-wrap";

    const slotEl = document.createElement("button");
    slotEl.className = "item-slot";
    slotEl.textContent = icon;
    slotEl.style.borderColor = borderColor;
    slotEl.disabled = disabled;
    if (!disabled) slotEl.addEventListener("click", onClick);
    attachItemTooltip(slotEl, tooltipToken);
    wrap.appendChild(slotEl);

    const caption = document.createElement("span");
    caption.className = "price-caption";
    caption.textContent = priceLabel;
    wrap.appendChild(caption);

    return wrap;
  }

  // Buy always previews at common rarity (that's what a purchase actually yields, see
  // WorldRoom.handleBuyItem); Sell lists the player's real inventory tokens at their real rarity.
  function renderVendorShop(npc: NpcDef) {
    npcDialogueBuyListEl.innerHTML = "";
    for (const itemId of npc.vendorItemIds ?? []) {
      const item = ITEMS[itemId];
      if (!item) continue;

      const gold = localPlayerSchema?.gold ?? 0;
      const inventoryFull = (localPlayerSchema ? [...localPlayerSchema.inventory].length : 0) >= INVENTORY_SIZE;
      const disabled = gold < item.basePrice || inventoryFull;

      npcDialogueBuyListEl.appendChild(
        buildShopSlot(item.icon, RARITY_COLOR.common, encodeItemToken(itemId, "common"), `💰${item.basePrice}`, disabled, () => {
          const message: BuyItemMessage = { npcId: npc.id, itemId };
          activeRoom?.send("buy_item", message);
        }),
      );
    }

    npcDialogueSellListEl.innerHTML = "";
    for (const token of localPlayerSchema ? [...localPlayerSchema.inventory] : []) {
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

  function openNpcDialogue(npcId: string) {
    currentNpcDialogueId = npcId;
    npcDialoguePanel.hidden = false;
    renderNpcDialogue();
  }

  function closeNpcDialogue() {
    currentNpcDialogueId = null;
    npcDialoguePanel.hidden = true;
  }

  function renderDungeonFinderPanel() {
    const local = localSessionId ? playerSchemaById.get(localSessionId) : undefined;
    const partyId = local?.partyId ?? "";

    // No party ("" partyId) just means "group of one, yourself" - mirrors
    // WorldRoom.handleDungeonStart, which allows the same solo/undersized entry.
    const members = partyId
      ? [...playerSchemaById.entries()].filter(([, schema]) => schema.partyId === partyId)
      : local
        ? [[localSessionId!, local] as [string, typeof local]]
        : [];

    dungeonYourGroupEl.innerHTML = "";
    const roleCounts: Record<ClassRole, number> = { tank: 0, healer: 0, dps: 0 };
    for (const [sessionId, schema] of members) {
      const className = CLASSES[schema.classId as ClassId]?.name ?? schema.classId;
      const role = CLASSES[schema.classId as ClassId]?.role;
      if (role) roleCounts[role]++;
      const label = sessionId === localSessionId ? `${schema.name} (You)` : schema.name;

      const row = document.createElement("div");
      row.className = "item-row";
      row.innerHTML = `<span>${label}</span><span class="item-slot-tag">${className}${role ? ` · ${capitalize(role)}` : ""}</span>`;
      dungeonYourGroupEl.appendChild(row);
    }

    // Shown as guidance ("this is the dungeon's designed composition"), not a hard gate -
    // see the Start button below.
    dungeonRoleChecklistEl.innerHTML = (Object.keys(DUNGEON_COMPOSITION) as ClassRole[])
      .map((role) => {
        const have = roleCounts[role];
        const need = DUNGEON_COMPOSITION[role];
        return `<span class="dungeon-role-tag ${have === need ? "filled" : "missing"}">${capitalize(role)} ${have}/${need}</span>`;
      })
      .join("");

    dungeonOpenListingBtn.hidden = !!partyId && dungeonListingSchemaById.has(partyId);

    // Composition is guidance, not a requirement - an over-leveled/geared group (down to
    // soloing) can still push Start rather than being blocked, matching the relaxed server-side
    // check in WorldRoom.handleDungeonStart. Only the group size cap is actually enforced.
    const groupSize = members.length;
    dungeonStartBtn.disabled = groupSize < 1 || groupSize > DUNGEON_PARTY_SIZE;

    dungeonListingListEl.innerHTML = "";
    for (const [listingPartyId, listing] of dungeonListingSchemaById) {
      const size = [...playerSchemaById.values()].filter((s) => s.partyId === listingPartyId).length;
      const isOwnGroup = listingPartyId === partyId;
      const wouldFit = !isOwnGroup && size + groupSize <= DUNGEON_PARTY_SIZE;
      const leaderLabel = playerSchemaById.get(listing.leaderSessionId)?.name ?? "Someone";

      const row = document.createElement("div");
      row.className = "talent-card";
      row.innerHTML = `
        <div class="talent-card-top">
          <span>${leaderLabel}'s Group</span>
          <span class="talent-rank">${size} / ${DUNGEON_PARTY_SIZE}</span>
        </div>
      `;

      if (isOwnGroup) {
        const tag = document.createElement("span");
        tag.className = "talent-desc";
        tag.textContent = "This is your group";
        row.appendChild(tag);
      } else {
        const btn = document.createElement("button");
        btn.className = "overlay-button";
        btn.textContent = "Join";
        btn.disabled = !wouldFit;
        btn.addEventListener("click", () => {
          const message: DungeonJoinListingMessage = { partyId: listingPartyId };
          activeRoom?.send("dungeon_join_listing", message);
        });
        row.appendChild(btn);
      }
      dungeonListingListEl.appendChild(row);
    }
  }

  function openDungeonFinder() {
    dungeonFinderPanel.hidden = false;
    renderDungeonFinderPanel();
  }

  function closeDungeonFinder() {
    dungeonFinderPanel.hidden = true;
  }

  function renderQuestLog() {
    questLogListEl.innerHTML = "";
    if (!localPlayerSchema) return;
    let index = 1;
    for (const [questId, progress] of localPlayerSchema.questProgress) {
      const number = index++;
      const quest = QUESTS[questId];
      if (!quest) continue;
      const row = document.createElement("div");
      row.className = "item-row";
      row.innerHTML = `
        <span><span class="quest-number">${number}</span>${quest.name}<span class="quest-objective">${questObjectiveLabel(quest)}</span></span>
        <span class="item-slot-tag">${progress} / ${quest.objectiveCount}</span>
      `;
      questLogListEl.appendChild(row);
    }
  }

  document.querySelector("[data-npc-dialogue-close]")!.addEventListener("click", () => closeNpcDialogue());

  document.querySelector("[data-party-leave]")!.addEventListener("click", () => {
    room?.send("party_leave");
  });
  document.querySelector("[data-party-invite-accept]")!.addEventListener("click", () => {
    const message: PartyRespondMessage = { accept: true };
    room?.send("party_respond", message);
  });
  document.querySelector("[data-party-invite-decline]")!.addEventListener("click", () => {
    const message: PartyRespondMessage = { accept: false };
    room?.send("party_respond", message);
  });

  document.querySelector("[data-trade-invite-accept]")!.addEventListener("click", () => {
    const message: TradeRespondMessage = { accept: true };
    room?.send("trade_respond", message);
  });
  document.querySelector("[data-trade-invite-decline]")!.addEventListener("click", () => {
    const message: TradeRespondMessage = { accept: false };
    room?.send("trade_respond", message);
  });
  document.querySelector("[data-trade-accept]")!.addEventListener("click", () => room?.send("trade_accept"));
  document.querySelector("[data-trade-cancel]")!.addEventListener("click", () => {
    room?.send("trade_cancel");
    closeTradeWindow(); // optimistic - a trade_cancelled echo will also arrive and no-op harmlessly
  });
  tradeSelfGoldInput.addEventListener("change", () => {
    if (!activeTradeSnapshot || !localPlayerSchema) return;
    const clamped = Math.max(0, Math.min(localPlayerSchema.gold, Math.floor(Number(tradeSelfGoldInput.value) || 0)));
    sendTradeOffer([...activeTradeSnapshot.selfOffer], clamped);
  });

  document.querySelector("[data-dungeon-finder-close]")!.addEventListener("click", () => closeDungeonFinder());
  dungeonOpenListingBtn.addEventListener("click", () => room?.send("dungeon_open_listing"));
  dungeonStartBtn.addEventListener("click", () => room?.send("dungeon_start"));
  leaveDungeonBtn.addEventListener("click", () => {
    // Carries the party (if any) through the return trip - see the matching restorePartyId
    // plumbing in main()'s connect call and WorldRoom.onJoin, and DungeonRoom.onJoin's
    // identical carry-through on the way in.
    const partyId = localPlayerSchema?.partyId || undefined;
    sessionStorage.setItem("mmo:pendingConnect", JSON.stringify({ mode: "world", token, characterId, partyId }));
    window.location.reload();
  });

  let activeChatChannel: ChatChannel = "say";
  for (const tab of chatTabEls) {
    tab.addEventListener("click", () => {
      activeChatChannel = tab.dataset.chatChannel as ChatChannel;
      for (const other of chatTabEls) other.classList.toggle("active", other === tab);
    });
  }

  chatInputEl.addEventListener("keydown", (e) => {
    if (e.code !== "Enter") return;
    const text = chatInputEl.value.trim();
    chatInputEl.value = "";
    chatInputEl.blur(); // hands movement/hotkeys back to the game immediately
    if (!text) return;
    const message: ChatMessage = { channel: activeChatChannel, text: text.slice(0, CHAT_MAX_LENGTH) };
    room?.send("chat", message);
  });

  const characterPanel = document.getElementById("character-panel")!;

  window.addEventListener("keydown", (e) => {
    if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) return;
    if (e.code === "Digit1") castSpell(0);
    else if (e.code === "Digit2") castSpell(1);
    else if (e.code === "Digit3") castSpell(2);
    else if (e.code === "Escape") {
      cancelPendingGroundTarget();
      closeContextMenu();
    }
    else if (e.code === "KeyP") characterPanel.hidden = !characterPanel.hidden;
    else if (e.code === "KeyI") inventoryPanel.hidden = !inventoryPanel.hidden;
    else if (e.code === "KeyK") {
      talentPanel.hidden = !talentPanel.hidden;
      // The tree's SVG connector lines are measured via getBoundingClientRect, which reads all
      // zeroes while the panel is display:none - re-render on open so lines drawn during any
      // earlier (hidden) pass get replaced with correctly-measured ones.
      if (!talentPanel.hidden && localPlayerSchema) renderTalents(localPlayerSchema);
    }
    else if (e.code === "KeyL") questLogPanel.hidden = !questLogPanel.hidden;
    else if (e.code === "KeyM") bigMapPanel.hidden = !bigMapPanel.hidden;
  });

  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  gameScene.renderer.domElement.addEventListener("click", (event) => {
    const rect = gameScene.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, gameScene.camera);

    if (pendingGroundTargetSpellId) {
      const spellId = pendingGroundTargetSpellId;
      const slotIndex = pendingGroundTargetSlotIndex;
      cancelPendingGroundTarget();
      const hitPoint = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
        const targetX = clamp(hitPoint.x, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
        const targetZ = clamp(hitPoint.z, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
        if (!isWithinSpellRange(spellId, targetX, targetZ)) {
          if (slotIndex !== null) flashOutOfRange(slotIndex);
          return;
        }
        sendCast(spellId, { spellId, targetX, targetZ });
      }
      return;
    }

    const clickable = [
      ...[...enemies.values()].map((avatar) => avatar.group),
      ...[...avatars.values()].map((avatar) => avatar.group),
      ...[...lootBags.values()].map((avatar) => avatar.group),
      ...[...npcs.values()].map((avatar) => avatar.group),
      ...[...waypoints.values()].map((avatar) => avatar.group),
      ...(portal ? [portal.group] : []),
    ];
    const hits = raycaster.intersectObjects(clickable, true);

    if (hits.length === 0) {
      setTarget(null);
      return;
    }

    let obj: THREE.Object3D | null = hits[0].object;
    while (
      obj &&
      !obj.userData.enemyId &&
      !obj.userData.bagId &&
      !obj.userData.sessionId &&
      !obj.userData.npcId &&
      !obj.userData.waypointId &&
      !obj.userData.isPortal
    ) {
      obj = obj.parent;
    }

    if (obj?.userData.bagId) {
      openLootWindow(obj.userData.bagId as string);
      return;
    }
    if (obj?.userData.npcId) {
      openNpcDialogue(obj.userData.npcId as string);
      return;
    }
    if (obj?.userData.waypointId) {
      openWaypointPanel(obj.userData.waypointId as string);
      return;
    }
    if (obj?.userData.isPortal) {
      openDungeonFinder();
      return;
    }

    setTarget((obj?.userData.enemyId as string) ?? (obj?.userData.sessionId as string) ?? null);
  });

  // Keeps groundTargetPreview under the cursor while a ground-targeted spell is pending
  // placement - same ray/plane/clamp already used by the click handler's own ground-target branch.
  gameScene.renderer.domElement.addEventListener("mousemove", (event) => {
    if (!pendingGroundTargetSpellId) return;

    const rect = gameScene.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, gameScene.camera);

    const hitPoint = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
      const x = clamp(hitPoint.x, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
      const z = clamp(hitPoint.z, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
      groundTargetPreview.setPosition(x, z);
      lastGroundCursorX = x;
      lastGroundCursorZ = z;
    }
  });

  // Right-click opens the player-actions menu (Invite to Party today, more later): right-click
  // a player's 3D avatar directly, or right-click the target panel while targeting a player.
  gameScene.renderer.domElement.addEventListener("contextmenu", (event) => {
    event.preventDefault();

    const rect = gameScene.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, gameScene.camera);

    const hits = raycaster.intersectObjects(
      [...avatars.values()].map((avatar) => avatar.group),
      true,
    );
    if (hits.length === 0) {
      closeContextMenu();
      return;
    }

    let obj: THREE.Object3D | null = hits[0].object;
    while (obj && !obj.userData.sessionId) obj = obj.parent;
    const sessionId = obj?.userData.sessionId as string | undefined;
    const actions = sessionId ? actionsForPlayerTarget(sessionId) : [];
    if (actions.length === 0) {
      closeContextMenu();
      return;
    }
    openContextMenu(event.clientX, event.clientY, actions);
  });

  targetPanel.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const actions = currentTargetId ? actionsForPlayerTarget(currentTargetId) : [];
    if (actions.length === 0) {
      closeContextMenu();
      return;
    }
    openContextMenu(event.clientX, event.clientY, actions);
  });

  try {
    const connection = connectOverride
      ? await connectOverride()
      : await connectToWorld(token, characterId, restorePartyId);
    room = connection.room;
    activeRoom = room;
    const $ = connection.$;
    localSessionId = room.sessionId;

    // Room transitions (overworld <-> dungeon) are a reservation + full page reload rather
    // than an in-place scene rebuild - main() only ever fully sets up one room connection
    // per page load, so switching rooms just stashes what's needed and reloads into it.
    room.onMessage("dungeon_ready", (reservation: SeatReservation) => {
      sessionStorage.setItem("mmo:pendingConnect", JSON.stringify({ mode: "dungeon", reservation, token, characterId }));
      window.location.reload();
    });

    // Works identically in the overworld and inside a dungeon instance - both room types
    // broadcast the same "chat" message shape (see server/src/rooms/chat.ts).
    room.onMessage("chat", (payload: ChatBroadcast) => {
      const row = document.createElement("div");
      row.className = `chat-message ${payload.channel}`;
      const sender = document.createElement("span");
      sender.className = "chat-sender";
      sender.textContent = `${payload.senderName}: `;
      row.appendChild(sender);
      row.appendChild(document.createTextNode(payload.text));

      const wasAtBottom = chatLogEl.scrollTop + chatLogEl.clientHeight >= chatLogEl.scrollHeight - 4;
      chatLogEl.appendChild(row);
      while (chatLogEl.children.length > 100) chatLogEl.removeChild(chatLogEl.firstChild!);
      if (wasAtBottom) chatLogEl.scrollTop = chatLogEl.scrollHeight;

      if (payload.channel === "say") {
        avatars.get(payload.senderSessionId)?.chatBubble.show(payload.text);
      }
    });

    // Trade is WorldRoom-only (see plan) but these handlers are harmless to register
    // unconditionally - a DungeonRoom connection simply never emits these message types.
    room.onMessage("trade_update", (snapshot: TradeSnapshot) => {
      activeTradeSnapshot = snapshot;
      renderTradeWindow();
    });
    room.onMessage("trade_complete", () => closeTradeWindow());
    room.onMessage("trade_cancelled", () => closeTradeWindow());

    // Transient, not synced schema state (see CombatTextEvent) - a target that's already
    // despawned by the time this arrives (killing blow, or a projectile landing after death)
    // just has nothing to spawn the number above.
    room.onMessage("combat_text", (event: CombatTextEvent) => {
      const position =
        event.targetKind === "player" ? avatars.get(event.targetId)?.group.position : enemies.get(event.targetId)?.group.position;
      if (!position) return;

      const text = `${event.kind === "heal" ? "+" : "-"}${Math.round(event.amount)}`;
      const color = event.kind === "heal" ? "#5fe089" : event.isCrit ? "#ffcf4a" : "#ff5a5a";
      combatText.spawn(position.x, position.y, position.z, text, color, event.isCrit);

      if (event.kind === "heal") playHealSound();
      else playHitSound(event.isCrit);
    });

    dungeonStatusPanel.hidden = !isDungeon;
    if (isDungeon) {
      const updateDungeonStatusPanel = () => {
        const dungeonState = room!.state as unknown as { cleared: boolean };
        dungeonEncounterLabelEl.textContent = dungeonState.cleared ? "Cleared!" : "Fight your way to the boss.";
        leaveDungeonBtn.hidden = !dungeonState.cleared;
      };
      $(room.state).onChange(updateDungeonStatusPanel);
      updateDungeonStatusPanel();
    } else {
      $(room.state).dungeonListings.onAdd((listing, partyId) => {
        dungeonListingSchemaById.set(partyId, listing);
        renderDungeonFinderPanel();
      });
      $(room.state).dungeonListings.onRemove((_listing, partyId) => {
        dungeonListingSchemaById.delete(partyId);
        renderDungeonFinderPanel();
      });
    }

    $(room.state).players.onAdd((player, sessionId) => {
      const avatar = new PlayerAvatar(player.classId);
      avatar.group.userData.sessionId = sessionId;
      avatar.setTarget(player.x, getTerrainHeight(player.x, player.z), player.z, player.rotationY);
      avatar.snapToTarget(0, false);
      avatar.setHp(player.hp, player.maxHp);
      avatar.addTo(gameScene.scene);
      avatars.set(sessionId, avatar);
      playerSchemaById.set(sessionId, player);

      if (sessionId === localSessionId) {
        localHp = player.hp;
        localMaxHp = player.maxHp;
        localPlayerSchema = player;
        localClassId = player.classId as ClassId;
        updateHud();
        updateHpBar(playerHpFill, playerHpLabel, localHp, localMaxHp);
        updateCharacterPanel(player);
        updateAilmentIndicator(player);
        updateBuffIndicator(player);
        setupHotbarForClass(player.classId);
        updateNpcQuestIndicators();
        renderPartyPanel();
        renderDungeonFinderPanel();
        renderPartyInvitePrompt(player);
        renderTradeInvitePrompt(player);

        // Mutating a nested MapSchema (questProgress/questCompleted/ailments) does not
        // reliably trigger the parent Player's own onChange callback below unless a sibling
        // scalar field also changes in the same tick. Ailment *application* happens to also
        // change hp in the same tick (so it already updated live), but accept/turn-in and
        // Cleanse's ailments.clear() touch nothing else - they need their own explicit
        // listeners to keep the dialogue/quest-log/ailment indicator/NPC head-icon live.
        const rerenderQuestUi = () => {
          renderNpcDialogue();
          renderQuestLog();
          updateNpcQuestIndicators();
        };
        $(player.questProgress).onAdd(rerenderQuestUi);
        $(player.questProgress).onChange(rerenderQuestUi);
        $(player.questProgress).onRemove(rerenderQuestUi);
        $(player.questCompleted).onAdd(rerenderQuestUi);
        $(player.ailments).onAdd(() => updateAilmentIndicator(player));
        $(player.ailments).onRemove(() => updateAilmentIndicator(player));
        $(player.buffs).onAdd(() => updateBuffIndicator(player));
        $(player.buffs).onRemove(() => updateBuffIndicator(player));
        // Same reasoning as above - a completed trade removes/adds inventory tokens (see
        // TradeManager.finalize) without necessarily touching gold (a trade can be items-only),
        // so the parent Player onChange below isn't guaranteed to fire and the inventory panel
        // was staying stale until something unrelated (equip, loot, reconnect) forced a re-render.
        $(player.inventory).onAdd(() => renderInventory(player));
        $(player.inventory).onRemove(() => renderInventory(player));
      }

      $(player).onChange(() => {
        // Called before the local-player branch's early `return` below, so a partyId/hp
        // change on ANY player (local or remote) always keeps the party frame list live.
        renderPartyPanel();
        renderDungeonFinderPanel();

        avatar.setHp(player.hp, player.maxHp);

        if (sessionId === currentTargetId) {
          updateHpBar(targetHpFill, targetHpLabel, player.hp, player.maxHp);
          if (player.castSpellId !== "" && !targetCastActive) {
            targetCastActive = true;
            targetCastStartRef = performance.now();
            targetCastBarEl.hidden = false;
            targetCastNameEl.textContent = "Casting…";
          } else if (player.castSpellId === "" && targetCastActive) {
            targetCastActive = false;
            targetCastBarEl.hidden = true;
          }
        }

        if (sessionId === localSessionId) {
          localServerPosition.set(player.x, player.y, player.z);
          localHp = player.hp;
          localMaxHp = player.maxHp;
          updateHpBar(playerHpFill, playerHpLabel, localHp, localMaxHp);
          updateCharacterPanel(player);
          updateAilmentIndicator(player);
          updateBuffIndicator(player);
          renderNpcDialogue();
          renderQuestLog();
          renderPartyInvitePrompt(player);
          renderTradeInvitePrompt(player);

          if (player.castSpellId !== localCastSpellId) {
            localCastSpellId = player.castSpellId;
            if (localCastSpellId !== "") {
              localCastActive = true;
              localCastStartRef = performance.now();
              playerCastLabel.textContent = SPELLS[localCastSpellId].name;
              playerCastBarEl.hidden = false;
            } else {
              localCastActive = false;
              playerCastBarEl.hidden = true;
            }
          }
          return;
        }
        avatar.setTarget(player.x, getTerrainHeight(player.x, player.z), player.z, player.rotationY);
      });
    });

    $(room.state).players.onRemove((_player, sessionId) => {
      const avatar = avatars.get(sessionId);
      if (avatar) {
        avatar.removeFrom(gameScene.scene);
        avatars.delete(sessionId);
      }
      playerSchemaById.delete(sessionId);
      if (currentTargetId === sessionId) setTarget(null);
      renderPartyPanel();
      renderDungeonFinderPanel();
    });

    $(room.state).enemies.onAdd((enemy, enemyId) => {
      const enemyType = ENEMY_TYPES[enemy.enemyTypeId];
      const enemyName = enemyType?.name ?? enemy.enemyTypeId;
      const aggressive = isAggressiveEnemyType(enemy.enemyTypeId);
      const avatar = new EnemyAvatar(enemy.behavior as EnemyBehavior, enemyName, aggressive);
      avatar.group.userData.enemyId = enemyId;
      avatar.setTarget(enemy.x, enemy.z);
      avatar.snapToTarget();
      avatar.setHp(enemy.hp, enemy.maxHp);
      avatar.addTo(gameScene.scene);
      enemies.set(enemyId, avatar);
      enemySchemaById.set(enemyId, enemy);

      $(enemy).onChange(() => {
        avatar.setTarget(enemy.x, enemy.z);
        avatar.setHp(enemy.hp, enemy.maxHp);
        if (enemy.behavior === "boss") avatar.setBossPhase(enemy.hp <= enemy.maxHp * BOSS_PHASE_2_HP_FRACTION);

        if (enemyId === currentTargetId) {
          updateHpBar(
            targetHpFill,
            targetHpLabel,
            enemy.hp,
            enemy.maxHp,
            enemy.behavior === "boss" ? undefined : typeColor(aggressive),
          );

          if (enemy.isCasting && !targetCastActive) {
            targetCastActive = true;
            targetCastStartRef = performance.now();
            targetCastBarEl.hidden = false;
            targetCastNameEl.textContent = enemy.castAbilityName || "Casting…";
          } else if (!enemy.isCasting && targetCastActive) {
            targetCastActive = false;
            targetCastBarEl.hidden = true;
          }
        }
      });
    });

    $(room.state).enemies.onRemove((_enemy, enemyId) => {
      const avatar = enemies.get(enemyId);
      if (avatar) {
        avatar.removeFrom(gameScene.scene);
        enemies.delete(enemyId);
      }
      enemySchemaById.delete(enemyId);
      if (currentTargetId === enemyId) setTarget(null);
    });

    $(room.state).projectiles.onAdd((projectile, projectileId) => {
      const isPlayerSourced = projectile.source === "player";
      const avatar = new ProjectileAvatar(
        isPlayerSourced ? PLAYER_PROJECTILE_COLOR : ENEMY_PROJECTILE_COLOR,
        isPlayerSourced ? PLAYER_PROJECTILE_EMISSIVE : ENEMY_PROJECTILE_EMISSIVE,
      );
      avatar.setTarget(projectile.x, projectile.z);
      avatar.snapToTarget();
      gameScene.scene.add(avatar.mesh);
      projectiles.set(projectileId, avatar);

      $(projectile).onChange(() => {
        avatar.setTarget(projectile.x, projectile.z);
      });
    });

    $(room.state).projectiles.onRemove((_projectile, projectileId) => {
      const avatar = projectiles.get(projectileId);
      if (avatar) {
        gameScene.scene.remove(avatar.mesh);
        projectiles.delete(projectileId);
      }
    });

    $(room.state).lootBags.onAdd((bag, bagId) => {
      const avatar = new LootBagAvatar();
      avatar.group.userData.bagId = bagId;
      avatar.setPosition(bag.x, bag.z);
      avatar.addTo(gameScene.scene);
      lootBags.set(bagId, avatar);
      lootBagSchemaById.set(bagId, bag);

      $(bag).onChange(() => {
        if (bagId === currentLootBagId) renderLootWindow();
      });
    });

    $(room.state).lootBags.onRemove((_bag, bagId) => {
      const avatar = lootBags.get(bagId);
      if (avatar) {
        avatar.removeFrom(gameScene.scene);
        lootBags.delete(bagId);
      }
      lootBagSchemaById.delete(bagId);
      if (currentLootBagId === bagId) closeLootWindow();
    });

    room.onLeave(() => {
      hud.textContent = "Disconnected from server";
    });

    setInterval(() => {
      const { moveX, moveZ } = input.getMovement();
      const message: InputMessage = { moveX, moveZ, seq: seq++ };
      room?.send("input", message);
    }, INPUT_SEND_INTERVAL_MS);
  } catch (err) {
    hud.textContent = "Failed to connect to server";
    console.error(err);
  }

  const clock = new THREE.Clock();

  // Drives each boss's AoE telegraph purely from already-loaded state (enemySchemaById +
  // ENEMY_TYPES content) - no extra synced fields needed beyond the existing isCasting/
  // castAbilityName/aggroTargetId. The phase-2 splash (unnamed cast) centers on the current
  // target's live position rather than the boss's own, which is why this can't just live inside
  // EnemyAvatar.update() - it needs to see other avatars, not just its own transform.
  function updateEnemyTelegraph(enemyId: string, avatar: EnemyAvatar) {
    const schema = enemySchemaById.get(enemyId);
    if (!schema?.isCasting || schema.behavior !== "boss") {
      avatar.setTelegraph(false, 0, 0, 0);
      return;
    }

    const stats = ENEMY_TYPES[schema.enemyTypeId]?.stats as BossStats | undefined;
    if (!stats) {
      avatar.setTelegraph(false, 0, 0, 0);
      return;
    }

    if (schema.castAbilityName) {
      const ability = stats.specialAbilities?.find((a) => a.name === schema.castAbilityName);
      if (ability?.kind === "raidNova") {
        avatar.setTelegraph(true, avatar.group.position.x, avatar.group.position.z, ability.radius);
        return;
      }
      avatar.setTelegraph(false, 0, 0, 0);
      return;
    }

    if (stats.aoeRadius && schema.aggroTargetId) {
      const targetAvatar = avatars.get(schema.aggroTargetId);
      if (targetAvatar) {
        avatar.setTelegraph(true, targetAvatar.group.position.x, targetAvatar.group.position.z, stats.aoeRadius);
        return;
      }
    }
    avatar.setTelegraph(false, 0, 0, 0);
  }

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1);

    if (localSessionId) {
      const { moveX, moveZ } = input.getMovement();
      if (moveX !== 0 || moveZ !== 0) {
        let nextX = clamp(localPredicted.x + moveX * PLAYER_SPEED * dt, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
        let nextZ = clamp(localPredicted.z + moveZ * PLAYER_SPEED * dt, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
        // Mirrors CombatEngine.tickPlayerMovement's server-authoritative collision exactly (same
        // shared function/data) so prediction never drifts from the server and rubber-bands at
        // walls - STRUCTURES is skipped in a dungeon since it always holds the overworld's rows.
        if (!isDungeon) {
          const resolved = resolveStructureCollisions(nextX, nextZ, STRUCTURES);
          nextX = clamp(resolved.x, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
          nextZ = clamp(resolved.z, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
        }
        localPredicted.x = nextX;
        localPredicted.z = nextZ;
        localRotationY = Math.atan2(moveX, moveZ);
      }

      // Small drift (rounding, tick timing) gets pulled in gently. Large corrections
      // (e.g. the server teleporting us home on death) snap instantly instead of
      // creeping across the map for seconds at SERVER_RECONCILE_LERP's pace.
      if (localPredicted.distanceTo(localServerPosition) > RECONCILE_SNAP_DISTANCE) {
        localPredicted.copy(localServerPosition);
      } else {
        localPredicted.lerp(localServerPosition, SERVER_RECONCILE_LERP);
      }

      const groundY = getTerrainHeight(localPredicted.x, localPredicted.z);

      const localAvatar = avatars.get(localSessionId);
      if (localAvatar) {
        localAvatar.setTarget(localPredicted.x, groundY, localPredicted.z, localRotationY);
        localAvatar.snapToTarget(dt, moveX !== 0 || moveZ !== 0);
      }

      followTargetScratch.set(localPredicted.x, groundY, localPredicted.z);
      gameScene.followTarget(followTargetScratch);
      for (const avatar of structures) avatar.update(localPredicted.x, localPredicted.z);
    }

    for (const [sessionId, avatar] of avatars) {
      if (sessionId === localSessionId) continue;
      avatar.update(dt);
    }

    for (const [enemyId, avatar] of enemies) {
      avatar.update(dt);
      updateEnemyTelegraph(enemyId, avatar);
    }
    for (const avatar of npcs.values()) avatar.update(dt);
    for (const avatar of waypoints.values()) avatar.update(dt);
    for (const avatar of projectiles.values()) avatar.update();
    portal?.update(dt);
    combatText.update(dt);

    if (localSessionId) {
      const others = [...avatars.entries()]
        .filter(([sessionId]) => sessionId !== localSessionId)
        .map(([, avatar]) => ({ x: avatar.group.position.x, z: avatar.group.position.z }));
      const enemyDots = [...enemies.entries()].map(([enemyId, avatar]) => ({
        x: avatar.group.position.x,
        z: avatar.group.position.z,
        isBoss: enemySchemaById.get(enemyId)?.behavior === "boss",
      }));
      const selfDot = { x: localPredicted.x, z: localPredicted.z, rotationY: localRotationY };
      const questAreas = computeQuestAreaMarkers();
      const npcQuestStates = computeNpcQuestStates();
      minimap.update(selfDot, others, enemyDots, !isDungeon, questAreas, npcQuestStates);
      // Same per-frame data, just at a bigger radius - skip the extra canvas work while the
      // panel is closed instead of redrawing a map nobody can see.
      if (!bigMapPanel.hidden) bigMap.update(selfDot, others, enemyDots, !isDungeon, questAreas, npcQuestStates);
    }

    if (localCastActive && localCastSpellId !== "") {
      const durationMs = SPELLS[localCastSpellId].castTimeMs;
      const fraction = Math.max(0, Math.min(1, (performance.now() - localCastStartRef) / durationMs));
      playerCastFill.style.width = `${fraction * 100}%`;
    }

    if (targetCastActive) {
      const targetEnemySchema = currentTargetId ? enemySchemaById.get(currentTargetId) : undefined;
      const targetEnemyType = targetEnemySchema ? ENEMY_TYPES[targetEnemySchema.enemyTypeId] : undefined;
      const castDurationMs =
        targetEnemySchema?.behavior === "boss"
          ? ((targetEnemyType?.stats as BossStats | undefined)?.aoeCastTimeMs ?? 0)
          : ((targetEnemyType?.stats as CasterStats | undefined)?.castTimeMs ?? 0);
      const fraction = Math.max(0, Math.min(1, (performance.now() - targetCastStartRef) / castDurationMs));
      targetCastFill.style.width = `${fraction * 100}%`;
    }

    if (currentTargetId) {
      const targetEnemySchema = enemySchemaById.get(currentTargetId);
      if (targetEnemySchema?.behavior === "boss" && targetEnemySchema.enragesAt > 0) {
        const remainingMs = targetEnemySchema.enragesAt - Date.now();
        targetEnrageEl.hidden = false;
        targetEnrageEl.textContent = remainingMs > 0 ? `Enrages in ${Math.ceil(remainingMs / 1000)}s` : "Enraged";
        targetEnrageEl.classList.toggle("enraged", remainingMs <= 0);
      } else {
        targetEnrageEl.hidden = true;
      }
    } else {
      targetEnrageEl.hidden = true;
    }

    for (let i = 0; i < slotSpellIds.length; i++) {
      const spellId = slotSpellIds[i];
      const cooldownEl = cooldownEls[i];
      const chargesEl = chargesEls[i];
      const slotEl = spellSlotEls[i];
      if (!cooldownEl || !spellId) continue;

      const now = performance.now();
      const active = activeCastsFor(spellId, now);
      const max = maxChargesFor(spellId);
      const available = max - active.length;

      // With charges available the slot reads fully "ready" (no sweep) even if the most
      // recent cast hasn't fully cooled down yet - only once every charge is spent does the
      // sweep reflect time remaining until the next one regenerates (active[0], the oldest
      // still-cooling cast, is the next to free up).
      const remaining = available > 0 ? 0 : Math.max(0, 1 - (now - active[0]) / SPELLS[spellId].cooldownMs);
      cooldownEl.style.height = `${remaining * 100}%`;

      if (chargesEl) {
        chargesEl.hidden = max <= 1;
        if (max > 1) chargesEl.textContent = `${available}/${max}`;
      }

      slotEl?.classList.toggle("too-far", isSpellOutOfRange(spellId));
    }

    gameScene.render();
  }

  animate();
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// --- Auth / character-select / character-create bootstrap flow ---

const TOKEN_STORAGE_KEY = "mmo:authToken";

const authScreen = document.getElementById("auth-screen")!;
const authTitle = document.querySelector<HTMLElement>("[data-auth-title]")!;
const authForm = document.querySelector<HTMLFormElement>("[data-auth-form]")!;
const authEmailField = document.querySelector<HTMLInputElement>("[data-auth-email-field]")!;
const authError = document.querySelector<HTMLElement>("[data-auth-error]")!;
const authSubmit = document.querySelector<HTMLButtonElement>("[data-auth-submit]")!;
const authToggle = document.querySelector<HTMLButtonElement>("[data-auth-toggle]")!;

const characterSelectScreen = document.getElementById("character-select-screen")!;
const characterListEl = document.getElementById("character-list")!;
const createCharacterBtn = document.querySelector<HTMLButtonElement>("[data-create-character-btn]")!;
const logoutBtn = document.querySelector<HTMLButtonElement>("[data-logout-btn]")!;

const characterCreateScreen = document.getElementById("character-create")!;
const classSelectOptionsEl = document.getElementById("class-select-options")!;
const characterNameInput = document.getElementById("character-name-input") as HTMLInputElement;
const createError = document.querySelector<HTMLElement>("[data-create-error]")!;
const createSubmit = document.querySelector<HTMLButtonElement>("[data-create-submit]")!;
const createCancel = document.querySelector<HTMLButtonElement>("[data-create-cancel]")!;

let authToken: string | null = null;
let authMode: "login" | "register" = "login";
let selectedClassId: ClassId | null = null;

function hideAllOverlays() {
  authScreen.hidden = true;
  characterSelectScreen.hidden = true;
  characterCreateScreen.hidden = true;
}

function showAuthScreen() {
  hideAllOverlays();
  authScreen.hidden = false;
  authError.textContent = "";
}

async function showCharacterSelect() {
  hideAllOverlays();
  characterSelectScreen.hidden = false;
  characterListEl.textContent = "Loading…";

  try {
    const { characters } = await api.listCharacters(authToken!);
    characterListEl.innerHTML = "";

    if (characters.length === 0) {
      characterListEl.textContent = "No characters yet — create one to get started.";
      return;
    }

    for (const character of characters) {
      const row = document.createElement("button");
      row.className = "character-row";
      row.innerHTML = `
        <span class="character-name">${character.name}</span>
        <span class="character-meta">${CLASSES[character.class_id].name} · Lv. ${character.level}</span>
      `;
      row.addEventListener("click", () => {
        hideAllOverlays();
        main(authToken!, character.id);
      });
      characterListEl.appendChild(row);
    }
  } catch (err) {
    characterListEl.textContent = err instanceof Error ? err.message : "Failed to load characters";
  }
}

function showCharacterCreate() {
  hideAllOverlays();
  characterCreateScreen.hidden = false;
  characterNameInput.value = "";
  createError.textContent = "";
  selectedClassId = null;
  for (const card of classSelectOptionsEl.querySelectorAll(".class-card")) {
    card.classList.remove("selected");
  }
}

// Content (classes/spells/items/talents/quests/NPCs/enemy types/maps/dungeons) is now
// database-backed and admin-editable - fetched once here, before any of the code below
// (starting with the class-select cards, immediately next) that reads it. See
// loadGameContent's contract in shared/src/types.ts for why this is a single population pass.
loadGameContent(await api.getContent());

for (const [classId, def] of Object.entries(CLASSES) as [ClassId, (typeof CLASSES)[ClassId]][]) {
  const card = document.createElement("button");
  card.className = "class-card";
  card.dataset.classId = classId;
  card.innerHTML = `<div class="class-name">${def.name}</div><div class="class-stat">${capitalize(def.mainStat)}</div>`;
  card.addEventListener("click", () => {
    selectedClassId = classId;
    for (const other of classSelectOptionsEl.querySelectorAll(".class-card")) {
      other.classList.remove("selected");
    }
    card.classList.add("selected");
  });
  classSelectOptionsEl.appendChild(card);
}

createSubmit.addEventListener("click", async () => {
  const name = characterNameInput.value.trim();
  if (!name) {
    createError.textContent = "Enter a character name";
    return;
  }
  if (!selectedClassId) {
    createError.textContent = "Choose a class";
    return;
  }

  createError.textContent = "";
  try {
    const { character } = await api.createCharacter(authToken!, name, selectedClassId);
    hideAllOverlays();
    main(authToken!, character.id);
  } catch (err) {
    createError.textContent = err instanceof Error ? err.message : "Failed to create character";
  }
});

createCancel.addEventListener("click", () => {
  showCharacterSelect();
});

createCharacterBtn.addEventListener("click", () => {
  showCharacterCreate();
});

logoutBtn.addEventListener("click", () => {
  authToken = null;
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  authMode = "login";
  applyAuthMode();
  showAuthScreen();
});

function applyAuthMode() {
  authTitle.textContent = authMode === "login" ? "Log in" : "Register";
  authSubmit.textContent = authMode === "login" ? "Log In" : "Register";
  authToggle.textContent = authMode === "login" ? "Need an account? Register" : "Already have an account? Log in";
  authEmailField.hidden = authMode === "login";
  authEmailField.required = authMode === "register";
}

authToggle.addEventListener("click", () => {
  authMode = authMode === "login" ? "register" : "login";
  authError.textContent = "";
  applyAuthMode();
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(authForm);
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const email = String(formData.get("email") ?? "").trim();

  authError.textContent = "";
  authSubmit.disabled = true;

  try {
    const response =
      authMode === "login" ? await api.login(username, password) : await api.register(username, email, password);
    authToken = response.token;
    localStorage.setItem(TOKEN_STORAGE_KEY, authToken);
    await showCharacterSelect();
  } catch (err) {
    authError.textContent = err instanceof Error ? err.message : "Something went wrong";
  } finally {
    authSubmit.disabled = false;
  }
});

// A pending room transition (see the "dungeon_ready" handler and the Leave Dungeon button
// in main()) takes priority over the normal auth/character-select boot flow - it means
// this load is a deliberate reload mid-session, not a fresh visit.
const PENDING_CONNECT_KEY = "mmo:pendingConnect";

interface PendingConnect {
  mode: "dungeon" | "world";
  token: string;
  characterId: number;
  reservation?: SeatReservation;
  partyId?: string;
}

function consumePendingConnect(): PendingConnect | null {
  const raw = sessionStorage.getItem(PENDING_CONNECT_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(PENDING_CONNECT_KEY);
  try {
    return JSON.parse(raw) as PendingConnect;
  } catch {
    return null;
  }
}

const pendingConnect = consumePendingConnect();
if (pendingConnect?.mode === "dungeon" && pendingConnect.reservation) {
  hideAllOverlays();
  main(pendingConnect.token, pendingConnect.characterId, () => consumeDungeonReservation(pendingConnect.reservation!));
} else if (pendingConnect?.mode === "world") {
  hideAllOverlays();
  main(pendingConnect.token, pendingConnect.characterId, undefined, pendingConnect.partyId);
} else {
  applyAuthMode();

  const storedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (storedToken) {
    api
      .me(storedToken)
      .then(() => {
        authToken = storedToken;
        return showCharacterSelect();
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        showAuthScreen();
      });
  } else {
    showAuthScreen();
  }
}
