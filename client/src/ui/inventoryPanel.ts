import { EquipMessage, EquipSlot, INVENTORY_SIZE, ITEMS, RARITY_COLOR, SwapInventorySlotsMessage, UnequipMessage, UseItemMessage, decodeItemToken } from "@mmo/shared";
import { activeRoom, PlayerStatsSnapshot, refreshSpellSlotOverrides } from "../clientState";
import { attachItemTooltip, bindPersistentItemTooltip } from "./tooltips";
import { makeDraggable } from "./DraggablePanel";

export const inventoryPanel = document.getElementById("inventory-panel")!;
const inventoryListEl = document.getElementById("inventory-list")!;
const inventoryCountEl = document.querySelector<HTMLElement>("[data-inventory-count]")!;

const equipRowEls: Record<EquipSlot, HTMLElement> = {
  weapon: document.querySelector<HTMLElement>('[data-equip-row="weapon"]')!,
  offHand: document.querySelector<HTMLElement>('[data-equip-row="offHand"]')!,
  head: document.querySelector<HTMLElement>('[data-equip-row="head"]')!,
  neck: document.querySelector<HTMLElement>('[data-equip-row="neck"]')!,
  shoulders: document.querySelector<HTMLElement>('[data-equip-row="shoulders"]')!,
  armor: document.querySelector<HTMLElement>('[data-equip-row="armor"]')!,
  hands: document.querySelector<HTMLElement>('[data-equip-row="hands"]')!,
  waist: document.querySelector<HTMLElement>('[data-equip-row="waist"]')!,
  legs: document.querySelector<HTMLElement>('[data-equip-row="legs"]')!,
  feet: document.querySelector<HTMLElement>('[data-equip-row="feet"]')!,
  ring: document.querySelector<HTMLElement>('[data-equip-row="ring"]')!,
  trinket: document.querySelector<HTMLElement>('[data-equip-row="trinket"]')!,
};

makeDraggable(inventoryPanel, "inventory", inventoryPanel.querySelector<HTMLElement>(".unit-name")!);

for (const slot of Object.keys(equipRowEls) as EquipSlot[]) {
  equipRowEls[slot].addEventListener("click", () => {
    const message: UnequipMessage = { slot };
    activeRoom?.send("unequip", message);
  });
  bindPersistentItemTooltip(equipRowEls[slot]);
}

export function renderEquipment(player: PlayerStatsSnapshot) {
  const equipped: Record<EquipSlot, string> = {
    weapon: player.equippedWeapon,
    offHand: player.equippedOffHand,
    head: player.equippedHead,
    neck: player.equippedNeck,
    shoulders: player.equippedShoulders,
    armor: player.equippedArmor,
    hands: player.equippedHands,
    waist: player.equippedWaist,
    legs: player.equippedLegs,
    feet: player.equippedFeet,
    ring: player.equippedRing,
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

// Refreshed every time real inventory data flows through renderInventory - lets other top-level
// code (the action-bar override system) know whether an equip token dragged onto a hotbar slot is
// still actually owned, the same role lastKnownMaterials plays for materials.
export let lastKnownInventoryTokens = new Set<string>();

export function renderInventory(player: PlayerStatsSnapshot) {
  inventoryListEl.innerHTML = "";
  const tokens = [...player.inventory];
  lastKnownInventoryTokens = new Set(tokens);
  const materials = new Map(player.materials);
  // Materials share the same 20-slot pool as equipment now (one material type = one slot,
  // regardless of stack size) - see hasInventorySpaceFor server-side. The count/grid below
  // reflect that shared total rather than treating materials as unlimited extras.
  const usedSlots = tokens.length + materials.size;
  inventoryCountEl.textContent = `(${usedSlots} / ${INVENTORY_SIZE})`;

  tokens.forEach((token, index) => {
    const decoded = decodeItemToken(token);
    const item = ITEMS[decoded.itemId];

    const slotEl = document.createElement("button");
    slotEl.className = "item-slot";
    slotEl.textContent = item ? item.icon : "";
    if (item) slotEl.style.borderColor = RARITY_COLOR[decoded.rarity];
    slotEl.addEventListener("click", () => {
      const message: EquipMessage = { itemId: token };
      activeRoom?.send("equip", message);
    });
    attachItemTooltip(slotEl, token);

    // Draggable two ways: onto another bag slot to swap positions (application/x-inventory-index,
    // read by the drop handler below), or onto an action-bar slot to assign it there (text/plain,
    // the same contract materials already use - see buildShopSlot/appendMaterialSlots).
    slotEl.draggable = true;
    slotEl.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("text/plain", token);
      event.dataTransfer?.setData("application/x-inventory-index", String(index));
    });
    slotEl.addEventListener("dragover", (event) => event.preventDefault());
    slotEl.addEventListener("dragenter", () => slotEl.classList.add("drag-over"));
    slotEl.addEventListener("dragleave", () => slotEl.classList.remove("drag-over"));
    slotEl.addEventListener("drop", (event) => {
      event.preventDefault();
      slotEl.classList.remove("drag-over");
      const fromIndexRaw = event.dataTransfer?.getData("application/x-inventory-index");
      if (!fromIndexRaw) return;
      const fromIndex = Number(fromIndexRaw);
      if (Number.isNaN(fromIndex) || fromIndex === index) return;
      const message: SwapInventorySlotsMessage = { fromIndex, toIndex: index };
      activeRoom?.send("swap_inventory_slots", message);
    });

    inventoryListEl.appendChild(slotEl);
  });

  // Consumables/materials land in the same grid, right after the equip slots - not a visually
  // separate section, so the panel reads as one continuous "everything you're carrying" list.
  appendMaterialSlots(inventoryListEl, materials);

  for (let i = usedSlots; i < INVENTORY_SIZE; i++) {
    const emptyEl = document.createElement("button");
    emptyEl.className = "item-slot empty";
    inventoryListEl.appendChild(emptyEl);
  }
}

// Also used by ui/professionsPanel.ts's Materials tab and the vendor shop rendered inside
// main()'s closure - not nested in that closure since it has no dependencies beyond top-level
// state (activeRoom, tooltips), and a plain function declaration is visible from every direction
// once it lives here.
// stackCount switches the slot from the vendor-style icon+price-caption layout to a plain square
// with the count as a small badge in the corner of the icon itself (materials/consumables) -
// matches how equipment slots in the same grid look (see appendMaterialSlots), instead of an
// extra text line underneath that made mixed grids read inconsistently.
export function buildShopSlot(
  icon: string,
  borderColor: string,
  tooltipToken: string,
  priceLabel: string,
  disabled: boolean,
  onClick: () => void,
  draggableItemId?: string,
  stackCount?: number,
): HTMLElement {
  const slotEl = document.createElement("button");
  slotEl.className = "item-slot";
  slotEl.textContent = icon;
  slotEl.style.borderColor = borderColor;
  slotEl.disabled = disabled;
  if (!disabled) {
    slotEl.addEventListener("click", onClick);
    // Right-click also uses it - a quick-use gesture, same as left-click, not a menu. Assigning
    // to an action-bar slot is drag-and-drop instead (see draggableItemId below), not a
    // right-click menu - the two gestures don't compete for the same click.
    slotEl.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      onClick();
    });
  }
  if (draggableItemId) {
    slotEl.draggable = true;
    slotEl.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("text/plain", draggableItemId);
    });
  }
  attachItemTooltip(slotEl, tooltipToken);

  if (stackCount !== undefined) {
    const badge = document.createElement("span");
    badge.className = "item-slot-stack";
    badge.textContent = `${stackCount}`;
    slotEl.appendChild(badge);
    return slotEl;
  }

  const wrap = document.createElement("div");
  wrap.className = "shop-slot-wrap";
  wrap.appendChild(slotEl);

  const caption = document.createElement("span");
  caption.className = "price-caption";
  caption.textContent = priceLabel;
  wrap.appendChild(caption);

  return wrap;
}

// A dedicated 7th hotbar button (alongside the 3 spell + 3 item slots) for mounting/dismounting
// with a click, not just the "H" keybind - same message either gesture sends.
const mountToggleBtn = document.querySelector<HTMLButtonElement>("[data-mount-toggle]")!;
const mountToggleNameEl = document.querySelector<HTMLElement>("[data-mount-name]")!;
mountToggleBtn.addEventListener("click", () => activeRoom?.send("toggle_mount"));

export function updateMountButton(player: PlayerStatsSnapshot) {
  mountToggleBtn.disabled = !player.hasMount;
  mountToggleBtn.classList.toggle("mounted", player.mounted);
  mountToggleNameEl.textContent = player.mounted ? "Dismount" : "Mount";
}

// A small always-visible action bar extension (see index.html's #hotbar - slots 4-6, alongside
// the 3 class-spell slots) so a consumable material can sit at a numbered quick-access slot the
// same way a spell does, not just be click-to-use buried in the inventory grid. Assignment is
// per-browser (not per-character) via localStorage - a deliberately simple scope for what's a
// convenience shortcut, not game state; losing it on a fresh browser/profile just means
// reassigning once.
const ITEM_SLOT_COUNT = 3;
const ITEM_SLOT_STORAGE_KEY = "mmo:itemHotbar";

function loadItemSlotAssignments(): (string | null)[] {
  try {
    const raw = localStorage.getItem(ITEM_SLOT_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.from({ length: ITEM_SLOT_COUNT }, (_, i) =>
      Array.isArray(parsed) && typeof parsed[i] === "string" ? (parsed[i] as string) : null,
    );
  } catch {
    return Array.from({ length: ITEM_SLOT_COUNT }, () => null);
  }
}

let itemSlotAssignments: (string | null)[] = loadItemSlotAssignments();
// Refreshed every time real materials data flows through renderInventory/renderMaterialsGrid -
// setItemSlot needs *some* current count to render against even though assigning a slot doesn't
// itself carry fresh player data with it (it's a context-menu click, not a schema update).
export let lastKnownMaterials = new Map<string, number>();

const itemSlotEls: HTMLElement[] = [];
const itemSlotNameEls: HTMLElement[] = [];
for (let i = 0; i < ITEM_SLOT_COUNT; i++) {
  const el = document.querySelector<HTMLElement>(`[data-item-slot="${i}"]`)!;
  itemSlotEls.push(el);
  itemSlotNameEls.push(document.querySelector(`[data-item-name="${i}"]`)!);
  // Right-click an assigned slot to clear it - mirrors the talent tree's own right-click-to-
  // refund convention (also the only other "right-click a small persistent UI element" gesture
  // in this game), rather than inventing a new one just for this.
  const index = i;
  el.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    if (!itemSlotAssignments[index]) return;
    setItemSlot(index, null);
  });
  // A material's slot (see appendMaterialSlots) is draggable with its itemId as the payload -
  // dropping it here assigns this slot, dragover must preventDefault or the browser refuses the
  // drop entirely (native HTML5 drag-and-drop's own contract, not something we can skip).
  el.addEventListener("dragover", (event) => event.preventDefault());
  el.addEventListener("dragenter", () => el.classList.add("drag-over"));
  el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
  el.addEventListener("drop", (event) => {
    event.preventDefault();
    el.classList.remove("drag-over");
    const itemId = event.dataTransfer?.getData("text/plain");
    if (itemId) setItemSlot(index, itemId);
  });
}

// An assigned slot (see setItemSlot/setSpellSlotOverride) holds either a bare material itemId or
// a full equip token ("itemId@rarity") - decodeItemToken handles both (a bare id falls back to
// "common"), and ITEMS[itemId].slot tells them apart (only equipment has an equip slot).
export function isEquipAssignment(id: string): boolean {
  return !!ITEMS[decodeItemToken(id).itemId]?.slot;
}

function renderItemHotbar() {
  for (let i = 0; i < ITEM_SLOT_COUNT; i++) {
    const assigned = itemSlotAssignments[i];
    const el = itemSlotEls[i];
    const nameEl = itemSlotNameEls[i];
    if (!assigned) {
      el.classList.add("empty");
      el.classList.remove("unusable");
      nameEl.textContent = "—";
      continue;
    }
    const decoded = decodeItemToken(assigned);
    const item = ITEMS[decoded.itemId];
    const depleted = isEquipAssignment(assigned) ? !lastKnownInventoryTokens.has(assigned) : (lastKnownMaterials.get(assigned) ?? 0) <= 0;
    el.classList.remove("empty");
    el.classList.toggle("unusable", depleted);
    nameEl.textContent = item ? `${item.icon} ${item.name}` : assigned;
  }
  refreshSpellSlotOverrides?.();
}

function setItemSlot(index: number, itemId: string | null) {
  itemSlotAssignments[index] = itemId;
  try {
    localStorage.setItem(ITEM_SLOT_STORAGE_KEY, JSON.stringify(itemSlotAssignments));
  } catch {
    // best-effort - a private/blocked storage context just means the assignment doesn't survive reload
  }
  renderItemHotbar();
}

// Shared trigger for any action-bar slot assigned to an item/equip token - used by the item
// slots (4-6) directly, and by the spell slots (1-3) when overridden with an item (see
// spellSlotOverrides in main.ts). Equipment equips itself; a material/consumable uses itself.
export function useOverrideItem(id: string) {
  if (isEquipAssignment(id)) {
    if (!lastKnownInventoryTokens.has(id)) return;
    const message: EquipMessage = { itemId: id };
    activeRoom?.send("equip", message);
  } else {
    if ((lastKnownMaterials.get(id) ?? 0) <= 0) return;
    const message: UseItemMessage = { itemId: id };
    activeRoom?.send("use_item", message);
  }
}

export function useItemSlot(index: number) {
  const itemId = itemSlotAssignments[index];
  if (!itemId) return;
  useOverrideItem(itemId);
}

// Shared by the Inventory panel's own grid and the Professions panel's Materials tab - a
// consumable/material sits in the *same* grid as equipment items now, not a visually separate
// section, so "everything you're carrying" reads as one continuous list. A usable one (has
// useEffects) is draggable onto an action-bar item slot to assign it there (see the drop
// handlers on itemSlotEls above) - left/right click both use it immediately either way.
export function appendMaterialSlots(container: HTMLElement, materials: Map<string, number>) {
  lastKnownMaterials = materials;
  for (const [itemId, count] of materials) {
    if (count <= 0) continue;
    const item = ITEMS[itemId];
    if (!item) continue;
    const usable = !!item.useEffects?.length;
    container.appendChild(
      buildShopSlot(
        item.icon,
        RARITY_COLOR.common,
        itemId,
        "",
        !usable,
        () => {
          const message: UseItemMessage = { itemId };
          activeRoom?.send("use_item", message);
        },
        usable ? itemId : undefined,
        count,
      ),
    );
  }
  renderItemHotbar();
}

// Used by ui/professionsPanel.ts's Materials tab for its empty-bag case, which still needs to
// update the item-hotbar depleted-check cache even though there's nothing to render into a grid.
export function refreshMaterialsCache(materials: Map<string, number>) {
  lastKnownMaterials = materials;
  renderItemHotbar();
}
