import {
  ALL_PROFESSIONS,
  CRAFTING_PROFESSIONS,
  CraftRecipeMessage,
  ForgetProfessionMessage,
  ITEMS,
  MAX_LEARNED_PROFESSIONS,
  ProfessionId,
  PROFESSION_ICONS,
  PROFESSION_LABELS,
  professionXpForNextLevel,
  RECIPES,
} from "@mmo/shared";
import { activeRoom, PlayerStatsSnapshot } from "../clientState";
import { appendMaterialSlots, refreshMaterialsCache } from "./inventoryPanel";
import { makeDraggable } from "./DraggablePanel";

export const professionsPanel = document.getElementById("professions-panel")!;
const professionSummaryEl = document.querySelector<HTMLElement>("[data-profession-summary]")!;
const professionTabsEl = document.getElementById("profession-tabs")!;
const professionTabContentEl = document.getElementById("profession-tab-content")!;

makeDraggable(professionsPanel, "professions");

type ProfessionTabKey = ProfessionId | "materials";
// Persists across renders (module state, not panel-local) so a re-render (e.g. gaining xp) never
// silently bounces the player back to another tab - only reset when the currently-active tab
// itself stops existing (a forgotten profession's tab disappearing).
let activeProfessionTab: ProfessionTabKey = "materials";

// Rebuilds the whole panel from scratch every call (same "innerHTML from scratch" pattern
// renderInventory/renderTalents already use). One tab per LEARNED profession (status + Forget +
// that profession's own recipes if it's a crafting one) plus a shared Materials tab (materials
// aren't cleanly owned by one profession - a lumberjack's logs can feed an alchemist's recipe -
// so the bag stays one shared view rather than being split up). Learn only happens via a trainer
// NPC's dialogue now (see renderNpcTrainerSection) - an *unlearned* profession has no tab here at
// all, matching how a player actually discovers professions (visiting trainers, not browsing a menu).
export function renderProfessionsPanel(player: PlayerStatsSnapshot) {
  const professionXp = new Map(player.professionXp);
  const professionLevel = new Map(player.professionLevel);
  const materials = new Map(player.materials);

  professionSummaryEl.textContent =
    professionXp.size === 0
      ? "0 professions known - visit a trainer NPC to learn one!"
      : `${professionXp.size} / ${MAX_LEARNED_PROFESSIONS} professions known`;

  const learnedProfessions = ALL_PROFESSIONS.filter((p) => professionXp.has(p));
  const tabs: ProfessionTabKey[] = [...learnedProfessions, "materials"];
  if (!tabs.includes(activeProfessionTab)) activeProfessionTab = tabs[0];

  professionTabsEl.innerHTML = "";
  for (const tab of tabs) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = tab === activeProfessionTab ? "chat-tab active" : "chat-tab";
    btn.textContent = tab === "materials" ? "Materials" : `${PROFESSION_ICONS[tab]} ${PROFESSION_LABELS[tab]}`;
    btn.addEventListener("click", () => {
      activeProfessionTab = tab;
      renderProfessionsPanel(player);
    });
    professionTabsEl.appendChild(btn);
  }

  professionTabContentEl.innerHTML = "";
  if (activeProfessionTab === "materials") {
    renderMaterialsTab(materials);
  } else {
    renderProfessionTabContent(activeProfessionTab, professionXp, professionLevel, materials);
  }
}

// Shared by the Professions panel's Materials tab and the Inventory panel's own Materials
// section (see ui/inventoryPanel.ts's renderInventory) - a consumable (a material with
// useEffects, e.g. a crafted potion) needs to be visible/usable from the *inventory* too, not
// just tucked away under Professions, since that's the first place a player actually looks for
// "stuff I'm carrying".
function renderMaterialsGrid(container: HTMLElement, materials: Map<string, number>, emptyMessage: string) {
  container.innerHTML = "";
  const materialEntries = [...materials].filter(([, count]) => count > 0);
  if (materialEntries.length === 0) {
    container.innerHTML = `<p class="panel-empty-state">${emptyMessage}</p>`;
    refreshMaterialsCache(materials);
    return;
  }
  appendMaterialSlots(container, materials);
}

function renderMaterialsTab(materials: Map<string, number>) {
  const grid = document.createElement("div");
  grid.className = "item-grid";
  renderMaterialsGrid(grid, materials, "No materials yet - gather some from the world!");
  professionTabContentEl.appendChild(grid);
}

function renderProfessionTabContent(
  professionId: ProfessionId,
  professionXp: Map<string, number>,
  professionLevel: Map<string, number>,
  materials: Map<string, number>,
) {
  const level = professionLevel.get(professionId) ?? 1;
  const xp = professionXp.get(professionId) ?? 0;
  const next = professionXpForNextLevel(level);
  const fraction = next > 0 ? Math.min(1, xp / next) : 1;

  const header = document.createElement("div");
  header.className = "profession-row";
  header.innerHTML = `
    <div class="profession-row-main">
      <div>${PROFESSION_ICONS[professionId]} ${PROFESSION_LABELS[professionId]} <span class="level-tag">Lv ${level}</span></div>
      <div class="bar"><div class="bar-fill" style="width: ${fraction * 100}%"></div><span class="bar-label">${xp} / ${next} XP</span></div>
    </div>
  `;
  const forgetBtn = document.createElement("button");
  forgetBtn.className = "overlay-button";
  forgetBtn.textContent = "Forget";
  forgetBtn.addEventListener("click", () => {
    const message: ForgetProfessionMessage = { professionId };
    activeRoom?.send("forget_profession", message);
  });
  header.appendChild(forgetBtn);
  professionTabContentEl.appendChild(header);

  if (!CRAFTING_PROFESSIONS.includes(professionId)) {
    const hint = document.createElement("p");
    hint.className = "panel-empty-state";
    hint.textContent = "Gather nodes out in the world to collect materials for this profession.";
    professionTabContentEl.appendChild(hint);
    return;
  }

  const recipes = Object.values(RECIPES).filter((r) => r.profession === professionId);
  const recipeList = document.createElement("div");
  recipeList.className = "item-list";
  if (recipes.length === 0) {
    recipeList.innerHTML = `<p class="panel-empty-state">No recipes exist for this profession yet.</p>`;
  }
  for (const recipe of recipes) {
    const meetsLevel = level >= recipe.requiredLevel;
    const hasAll = recipe.ingredients.every((ing) => (materials.get(ing.itemId) ?? 0) >= ing.quantity);

    const row = document.createElement("div");
    row.className = "item-row recipe-row";
    const ingredientsHtml = recipe.ingredients
      .map((ing) => {
        const have = materials.get(ing.itemId) ?? 0;
        const ingItem = ITEMS[ing.itemId];
        return `<span class="${have < ing.quantity ? "insufficient" : ""}">${ingItem?.icon ?? ""} ${ingItem?.name ?? ing.itemId} ${have}/${ing.quantity}</span>`;
      })
      .join("");
    row.innerHTML = `
      <div class="recipe-row-header"><span>${recipe.name}${meetsLevel ? "" : ` (req. Lv ${recipe.requiredLevel})`}</span></div>
      <div class="recipe-ingredients">${ingredientsHtml}</div>
    `;
    const craftBtn = document.createElement("button");
    craftBtn.className = "overlay-button";
    craftBtn.textContent = "Craft";
    craftBtn.disabled = !meetsLevel || !hasAll;
    craftBtn.addEventListener("click", () => {
      const message: CraftRecipeMessage = { recipeId: recipe.id };
      activeRoom?.send("craft_recipe", message);
    });
    row.appendChild(craftBtn);
    recipeList.appendChild(row);
  }
  professionTabContentEl.appendChild(recipeList);
}
