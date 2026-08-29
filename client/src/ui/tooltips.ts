import { CLASSES, EQUIP_SLOT_LABEL, ITEMS, PlayerStats, RARITY_COLOR, RARITY_MULTIPLIER, TALENTS, TalentDef, decodeItemToken } from "@mmo/shared";
import { localClassId, MAIN_STAT_NAME } from "../clientState";

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

const STAT_LABELS: Record<Exclude<keyof PlayerStats, "mainStat">, string> = {
  vitality: "Vitality",
  luck: "Luck",
  armor: "Armor",
};

function labelForStat(stat: keyof PlayerStats): string {
  if (stat === "mainStat") {
    const mainStat = localClassId ? CLASSES[localClassId].mainStat : null;
    return mainStat ? MAIN_STAT_NAME[mainStat] : "Main Stat";
  }
  return STAT_LABELS[stat];
}

export function positionItemTooltip(event: MouseEvent) {
  const offset = 16;
  const maxLeft = window.innerWidth - itemTooltipEl.offsetWidth - 8;
  const maxTop = window.innerHeight - itemTooltipEl.offsetHeight - 8;
  itemTooltipEl.style.left = `${Math.min(event.clientX + offset, Math.max(8, maxLeft))}px`;
  itemTooltipEl.style.top = `${Math.min(event.clientY + offset, Math.max(8, maxTop))}px`;
}

export function showItemTooltip(token: string, event: MouseEvent) {
  const { itemId, rarity } = decodeItemToken(token);
  const item = ITEMS[itemId];
  if (!item) return;

  const multiplier = RARITY_MULTIPLIER[rarity];
  itemTooltipNameEl.textContent = item.name;
  itemTooltipNameEl.style.color = RARITY_COLOR[rarity];
  itemTooltipSlotEl.textContent = item.slot ? EQUIP_SLOT_LABEL[item.slot] : "Material";
  itemTooltipStatsEl.innerHTML = Object.entries(item.bonuses)
    .map(([stat, value]) => `<span>+${Math.round((value ?? 0) * multiplier)} ${labelForStat(stat as keyof PlayerStats)}</span>`)
    .join("");
  itemTooltipDescEl.textContent = item.description;

  itemTooltipEl.hidden = false;
  positionItemTooltip(event);
}

export function hideItemTooltip() {
  itemTooltipEl.hidden = true;
}

export function positionTalentTooltip(event: MouseEvent) {
  const offset = 16;
  const maxLeft = window.innerWidth - talentTooltipEl.offsetWidth - 8;
  const maxTop = window.innerHeight - talentTooltipEl.offsetHeight - 8;
  talentTooltipEl.style.left = `${Math.min(event.clientX + offset, Math.max(8, maxLeft))}px`;
  talentTooltipEl.style.top = `${Math.min(event.clientY + offset, Math.max(8, maxTop))}px`;
}

export function showTalentTooltip(def: TalentDef, rank: number, locked: boolean, event: MouseEvent) {
  talentTooltipNameEl.textContent = def.name;
  talentTooltipRankEl.textContent = `Rank ${rank} / ${def.maxRank}`;
  talentTooltipDescEl.textContent = def.description;
  const prereq = def.prerequisiteTalentId ? TALENTS[def.prerequisiteTalentId] : undefined;
  talentTooltipLockEl.textContent = locked && prereq ? `Requires 1 point in ${prereq.name}` : "";
  talentTooltipHintEl.textContent = rank > 0 ? "Right-click to remove a point" : "";

  talentTooltipEl.hidden = false;
  positionTalentTooltip(event);
}

export function hideTalentTooltip() {
  talentTooltipEl.hidden = true;
}

// Inventory slots are rebuilt on every render, so a plain listener bound at creation
// is fine. Equip slots are static DOM nodes reused across renders, so their tooltip
// listeners are bound once (see ui/inventoryPanel.ts) and read the item id from a data
// attribute that renderEquipment keeps up to date, rather than rebinding a listener every render.
export function attachItemTooltip(el: HTMLElement, itemId: string) {
  el.addEventListener("mouseenter", (event) => showItemTooltip(itemId, event as MouseEvent));
  el.addEventListener("mousemove", (event) => positionItemTooltip(event as MouseEvent));
  el.addEventListener("mouseleave", hideItemTooltip);
}

export function bindPersistentItemTooltip(el: HTMLElement) {
  el.addEventListener("mouseenter", (event) => {
    if (el.dataset.itemId) showItemTooltip(el.dataset.itemId, event as MouseEvent);
  });
  el.addEventListener("mousemove", (event) => {
    if (el.dataset.itemId) positionItemTooltip(event as MouseEvent);
  });
  el.addEventListener("mouseleave", hideItemTooltip);
}
