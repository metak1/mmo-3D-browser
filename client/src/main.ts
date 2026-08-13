import * as THREE from "three";
import type { Room, SeatReservation } from "colyseus.js";
import {
  AcceptQuestMessage,
  BOSS_PHASE_2_HP_FRACTION,
  CastMessage,
  CLASSES,
  ClassId,
  ClassRole,
  DUNGEON_COMPOSITION,
  DUNGEON_PARTY_SIZE,
  DungeonJoinListingMessage,
  ENEMY_STATS,
  EnemyKind,
  EquipMessage,
  EquipSlot,
  InputMessage,
  INVENTORY_SIZE,
  ITEMS,
  LootTakeMessage,
  MAP_HALF_EXTENT,
  MainStat,
  NPCS,
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
  SPELLS,
  SpellId,
  SpendTalentMessage,
  TALENTS,
  TurnInQuestMessage,
  UnequipMessage,
  decodeItemToken,
  getEffectiveStats,
  xpForNextLevel,
} from "@mmo/shared";
import { GameScene } from "./game/Scene";
import { PlayerAvatar } from "./game/Player";
import { EnemyAvatar } from "./game/Enemy";
import { NpcAvatar, QuestIndicatorState } from "./game/Npc";
import { PortalAvatar } from "./game/Portal";
import { ProjectileAvatar } from "./game/Projectile";
import { LootBagAvatar } from "./game/LootBagAvatar";
import { InputController } from "./game/InputController";
import { connectToWorld, consumeDungeonReservation } from "./network/connection";
import * as api from "./network/api";
import { makeDraggable } from "./ui/DraggablePanel";

const REMOTE_COLOR = 0xe8734a;
const LOCAL_COLOR = 0x4ac0e8;
const PLAYER_PROJECTILE_COLOR = 0xff9a3c;
const PLAYER_PROJECTILE_EMISSIVE = 0xb35a12;
const ENEMY_PROJECTILE_COLOR = 0xd15fe0;
const ENEMY_PROJECTILE_EMISSIVE = 0x8a2fb0;
const INPUT_SEND_INTERVAL_MS = 1000 / 20;
const SERVER_RECONCILE_LERP = 0.02;
const RECONCILE_SNAP_DISTANCE = 3; // large corrections (e.g. death/respawn teleport) snap instead of creeping
const HOTBAR_SLOT_COUNT = 3;
const AILMENT_LABELS: Record<string, string> = { weaken: "Weakened" };
const ENEMY_LABEL: Record<EnemyKind, string> = {
  melee: "Melee Enemy",
  caster: "Caster Enemy",
  boss: "The Ashen Warden",
};

const hud = document.getElementById("hud")!;
const container = document.getElementById("app")!;

const playerHpFill = document.querySelector<HTMLElement>("[data-player-hp-fill]")!;
const playerHpLabel = document.querySelector<HTMLElement>("[data-player-hp-label]")!;
const playerAilmentsEl = document.querySelector<HTMLElement>("[data-player-ailments]")!;
const playerCastBarEl = document.querySelector<HTMLElement>("[data-player-cast-bar]")!;
const playerCastFill = document.querySelector<HTMLElement>("[data-player-cast-fill]")!;
const playerCastLabel = document.querySelector<HTMLElement>("[data-player-cast-label]")!;

const targetPanel = document.getElementById("target-panel")!;
const targetNameEl = document.querySelector<HTMLElement>("[data-target-name]")!;
const targetHpFill = document.querySelector<HTMLElement>("[data-target-hp-fill]")!;
const targetHpLabel = document.querySelector<HTMLElement>("[data-target-hp-label]")!;
const targetCastBarEl = document.querySelector<HTMLElement>("[data-target-cast-bar]")!;
const targetCastFill = document.querySelector<HTMLElement>("[data-target-cast-fill]")!;
const targetEnrageEl = document.querySelector<HTMLElement>("[data-target-enrage]")!;

const partyPanel = document.getElementById("party-panel")!;
const partyMemberListEl = document.getElementById("party-member-list")!;
const partyInvitePromptEl = document.getElementById("party-invite-prompt")!;
const partyInviteTextEl = document.querySelector<HTMLElement>("[data-party-invite-text]")!;

const dungeonFinderPanel = document.getElementById("dungeon-finder-panel")!;
const dungeonYourGroupEl = document.getElementById("dungeon-your-group")!;
const dungeonRoleChecklistEl = document.getElementById("dungeon-role-checklist")!;
const dungeonListingListEl = document.getElementById("dungeon-listing-list")!;
const dungeonOpenListingBtn = document.querySelector<HTMLButtonElement>("[data-dungeon-open-listing]")!;
const dungeonStartBtn = document.querySelector<HTMLButtonElement>("[data-dungeon-start]")!;

const dungeonStatusPanel = document.getElementById("dungeon-status-panel")!;
const dungeonEncounterLabelEl = document.querySelector<HTMLElement>("[data-dungeon-encounter-label]")!;
const leaveDungeonBtn = document.querySelector<HTMLButtonElement>("[data-leave-dungeon]")!;

const playerLevelEl = document.querySelector<HTMLElement>("[data-player-level]")!;
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

const talentPanel = document.getElementById("talent-panel")!;
const talentListEl = document.getElementById("talent-list")!;
const talentPointsEl = document.querySelector<HTMLElement>("[data-talent-points]")!;

const npcDialoguePanel = document.getElementById("npc-dialogue-panel")!;
const npcDialogueNameEl = document.querySelector<HTMLElement>("[data-npc-dialogue-name]")!;
const npcDialogueQuestsEl = document.getElementById("npc-dialogue-quests")!;
const questLogPanel = document.getElementById("quest-log-panel")!;
const questLogListEl = document.getElementById("quest-log-list")!;

const itemTooltipEl = document.getElementById("item-tooltip")!;
const itemTooltipNameEl = document.querySelector<HTMLElement>("[data-tooltip-name]")!;
const itemTooltipSlotEl = document.querySelector<HTMLElement>("[data-tooltip-slot]")!;
const itemTooltipStatsEl = document.querySelector<HTMLElement>("[data-tooltip-stats]")!;
const itemTooltipDescEl = document.querySelector<HTMLElement>("[data-tooltip-desc]")!;

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

makeDraggable(document.getElementById("player-panel")!, "player");
makeDraggable(document.getElementById("target-panel")!, "target");
makeDraggable(document.getElementById("spell-panel")!, "spells");
makeDraggable(document.getElementById("character-panel")!, "character");
makeDraggable(document.getElementById("xp-panel")!, "xp");
makeDraggable(inventoryPanel, "inventory");
makeDraggable(lootWindow, "loot");
makeDraggable(talentPanel, "talents");
makeDraggable(npcDialoguePanel, "npc-dialogue");
makeDraggable(questLogPanel, "quest-log");
makeDraggable(partyPanel, "party");
makeDraggable(dungeonFinderPanel, "dungeon-finder");
makeDraggable(dungeonStatusPanel, "dungeon-status");

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

function renderTalents(player: PlayerStatsSnapshot) {
  talentPointsEl.textContent = `${player.talentPoints} point${player.talentPoints === 1 ? "" : "s"}`;

  const ranks = new Map(player.talentRanks);
  talentListEl.innerHTML = "";
  for (const def of Object.values(TALENTS)) {
    if (def.classId !== player.classId) continue;

    const rank = ranks.get(def.id) ?? 0;
    const maxed = rank >= def.maxRank;

    const card = document.createElement("button");
    card.className = maxed ? "talent-card maxed" : "talent-card";
    card.innerHTML = `
      <div class="talent-card-top">
        <span>${def.name}</span>
        <span class="talent-rank">${rank} / ${def.maxRank}</span>
      </div>
      <span class="talent-desc">${def.description}</span>
    `;
    if (!maxed) {
      card.addEventListener("click", () => {
        const message: SpendTalentMessage = { talentId: def.id };
        activeRoom?.send("spend_talent", message);
      });
    }
    talentListEl.appendChild(card);
  }
}

function updateCharacterPanel(player: PlayerStatsSnapshot) {
  const className = CLASSES[player.classId as ClassId]?.name ?? player.classId;
  playerClassEl.textContent = className;
  characterClassEl.textContent = className;
  playerLevelEl.textContent = `Lv. ${player.level}`;

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

function updateHpBar(fillEl: HTMLElement, labelEl: HTMLElement, hp: number, maxHp: number) {
  const fraction = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
  fillEl.style.width = `${fraction * 100}%`;
  fillEl.style.background = hpColor(fraction);
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
    { kind: string; hp: number; maxHp: number; isCasting: boolean; enragesAt: number }
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
    }
  >();
  const projectiles = new Map<string, ProjectileAvatar>();
  const lootBags = new Map<string, LootBagAvatar>();
  const lootBagSchemaById = new Map<string, { x: number; z: number; items: Iterable<string> }>();
  const dungeonListingSchemaById = new Map<string, { partyId: string; leaderSessionId: string; createdAt: number }>();

  // NPCs are static shared data (no hp, never move), so they're spawned once from NPCS
  // rather than synced through room state like enemies/players/loot bags.
  const npcs = new Map<string, NpcAvatar>();
  for (const def of Object.values(NPCS)) {
    const avatar = new NpcAvatar();
    avatar.group.userData.npcId = def.id;
    avatar.setPosition(def.x, def.z);
    avatar.addTo(gameScene.scene);
    npcs.set(def.id, avatar);
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

  let room: Room | undefined;
  let localSessionId: string | null = null;
  let currentTargetId: string | null = null;
  let currentLootBagId: string | null = null;
  let currentNpcDialogueId: string | null = null;
  let localPlayerSchema: PlayerStatsSnapshot | undefined;
  let pendingGroundTargetSpellId: SpellId | null = null;

  let localHp = 0;
  let localMaxHp = 0;
  let localCastSpellId = "";
  let localCastActive = false;
  let localCastStartRef = 0;

  let targetCastActive = false;
  let targetCastStartRef = 0;

  const localPredicted = new THREE.Vector3(0, 0, 0);
  const localServerPosition = new THREE.Vector3(0, 0, 0);
  let localRotationY = 0;
  let seq = 0;

  const lastClientCastAt = new Map<SpellId, number>();

  // Hotbar slots are keyed by position (0/1/2), not spell identity - the same DOM node
  // holds a different spell per class. slotSpellIds is populated once the local player's
  // class is known (setupHotbarForClass), since class never changes mid-session.
  const spellSlotEls: HTMLElement[] = [];
  const cooldownEls: HTMLElement[] = [];
  const nameEls: HTMLElement[] = [];
  for (let i = 0; i < HOTBAR_SLOT_COUNT; i++) {
    spellSlotEls.push(document.querySelector(`[data-slot="${i}"]`)!);
    cooldownEls.push(document.querySelector(`[data-cooldown="${i}"]`)!);
    nameEls.push(document.querySelector(`[data-name="${i}"]`)!);
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

  // Right-click (on the 3D avatar or the target panel) opens this menu - the single entry
  // point for player-targeted actions. "Invite to Party" is the only one today; more get
  // appended here as they're added, always with Invite first per the established convention.
  function actionsForPlayerTarget(targetSessionId: string): ContextMenuAction[] {
    const actions: ContextMenuAction[] = [];
    if (canInviteToParty(targetSessionId)) {
      actions.push({ label: "Invite to Party", onClick: () => sendPartyInvite(targetSessionId) });
    }
    return actions;
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
      targetNameEl.textContent = ENEMY_LABEL[enemySchema.kind as EnemyKind] ?? enemySchema.kind;
      updateHpBar(targetHpFill, targetHpLabel, enemySchema.hp, enemySchema.maxHp);
      if (enemySchema.isCasting) {
        targetCastActive = true;
        targetCastStartRef = performance.now();
        targetCastBarEl.hidden = false;
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
      }
      return;
    }

    targetPanel.hidden = true;
  }

  function sendCast(spellId: SpellId, message: CastMessage) {
    lastClientCastAt.set(spellId, performance.now());
    room?.send("cast", message);
  }

  function castSpell(slotIndex: number) {
    if (!room) return;
    const spellId = slotSpellIds[slotIndex];
    if (!spellId) return;

    const spell = SPELLS[spellId];
    const now = performance.now();
    const last = lastClientCastAt.get(spellId) ?? -Infinity;
    if (now - last < spell.cooldownMs) return;

    if (spell.targetType === "ground") {
      pendingGroundTargetSpellId = spellId;
      container.classList.add("ground-target-pending");
      return;
    }

    if (spell.targetType === "enemy") {
      if (!currentTargetId || !enemySchemaById.has(currentTargetId)) return;
      sendCast(spellId, { spellId, targetId: currentTargetId });
    } else if (spell.targetType === "ally") {
      const targetId = currentTargetId && playerSchemaById.has(currentTargetId) ? currentTargetId : localSessionId ?? undefined;
      sendCast(spellId, { spellId, targetId });
    } else if (spell.targetType === "self") {
      sendCast(spellId, { spellId });
    }
  }

  function cancelPendingGroundTarget() {
    if (!pendingGroundTargetSpellId) return;
    pendingGroundTargetSpellId = null;
    container.classList.remove("ground-target-pending");
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
    return `Kill ${quest.objectiveCount} ${capitalize(quest.objectiveEnemyKind)} ${noun}`;
  }

  // Ready-to-turn-in takes priority (most actionable), then a new quest to offer, then a
  // plain in-progress indicator - matches the classic "!"/"?" MMO convention.
  function npcQuestIndicatorState(npc: NpcDef): QuestIndicatorState {
    let anyAvailable = false;
    let anyActive = false;
    for (const questId of npc.questIds) {
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

  function renderNpcDialogue() {
    if (!currentNpcDialogueId) return;
    const npc = NPCS[currentNpcDialogueId];
    if (!npc) return;

    npcDialogueNameEl.textContent = npc.name;
    npcDialogueQuestsEl.innerHTML = "";

    for (const questId of npc.questIds) {
      const quest = QUESTS[questId];
      const state = questStateFor(questId);
      const progress = localPlayerSchema ? (new Map(localPlayerSchema.questProgress).get(questId) ?? 0) : 0;

      const card = document.createElement("div");
      card.className = "talent-card";
      card.innerHTML = `
        <div class="talent-card-top"><span>${quest.name}</span></div>
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
    for (const [questId, progress] of localPlayerSchema.questProgress) {
      const quest = QUESTS[questId];
      if (!quest) continue;
      const row = document.createElement("div");
      row.className = "item-row";
      row.innerHTML = `
        <span>${quest.name}<span class="quest-objective">${questObjectiveLabel(quest)}</span></span>
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

  const characterPanel = document.getElementById("character-panel")!;

  window.addEventListener("keydown", (e) => {
    if (e.code === "Digit1") castSpell(0);
    else if (e.code === "Digit2") castSpell(1);
    else if (e.code === "Digit3") castSpell(2);
    else if (e.code === "Escape") {
      cancelPendingGroundTarget();
      closeContextMenu();
    }
    else if (e.code === "KeyP") characterPanel.hidden = !characterPanel.hidden;
    else if (e.code === "KeyI") inventoryPanel.hidden = !inventoryPanel.hidden;
    else if (e.code === "KeyK") talentPanel.hidden = !talentPanel.hidden;
    else if (e.code === "KeyL") questLogPanel.hidden = !questLogPanel.hidden;
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
      cancelPendingGroundTarget();
      const hitPoint = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
        const targetX = clamp(hitPoint.x, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
        const targetZ = clamp(hitPoint.z, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
        sendCast(spellId, { spellId, targetX, targetZ });
      }
      return;
    }

    const clickable = [
      ...[...enemies.values()].map((avatar) => avatar.group),
      ...[...avatars.values()].map((avatar) => avatar.group),
      ...[...lootBags.values()].map((avatar) => avatar.group),
      ...[...npcs.values()].map((avatar) => avatar.group),
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
    if (obj?.userData.isPortal) {
      openDungeonFinder();
      return;
    }

    setTarget((obj?.userData.enemyId as string) ?? (obj?.userData.sessionId as string) ?? null);
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

    dungeonStatusPanel.hidden = !isDungeon;
    if (isDungeon) {
      const updateDungeonStatusPanel = () => {
        const dungeonState = room!.state as unknown as { encounterIndex: number; cleared: boolean };
        dungeonEncounterLabelEl.textContent = dungeonState.cleared
          ? "Cleared!"
          : `Encounter ${dungeonState.encounterIndex + 1} / 3`;
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
      const avatar = new PlayerAvatar(sessionId === localSessionId ? LOCAL_COLOR : REMOTE_COLOR);
      avatar.group.userData.sessionId = sessionId;
      avatar.setTarget(player.x, player.y, player.z, player.rotationY);
      avatar.snapToTarget();
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
        setupHotbarForClass(player.classId);
        updateNpcQuestIndicators();
        renderPartyPanel();
        renderDungeonFinderPanel();
        renderPartyInvitePrompt(player);

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
          renderNpcDialogue();
          renderQuestLog();
          renderPartyInvitePrompt(player);

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
        avatar.setTarget(player.x, player.y, player.z, player.rotationY);
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
      const avatar = new EnemyAvatar(enemy.kind as EnemyKind);
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
        if (enemy.kind === "boss") avatar.setBossPhase(enemy.hp <= enemy.maxHp * BOSS_PHASE_2_HP_FRACTION);

        if (enemyId === currentTargetId) {
          updateHpBar(targetHpFill, targetHpLabel, enemy.hp, enemy.maxHp);

          if (enemy.isCasting && !targetCastActive) {
            targetCastActive = true;
            targetCastStartRef = performance.now();
            targetCastBarEl.hidden = false;
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

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1);

    if (localSessionId) {
      const { moveX, moveZ } = input.getMovement();
      if (moveX !== 0 || moveZ !== 0) {
        localPredicted.x = clamp(localPredicted.x + moveX * PLAYER_SPEED * dt, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
        localPredicted.z = clamp(localPredicted.z + moveZ * PLAYER_SPEED * dt, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
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

      const localAvatar = avatars.get(localSessionId);
      if (localAvatar) {
        localAvatar.setTarget(localPredicted.x, localPredicted.y, localPredicted.z, localRotationY);
        localAvatar.snapToTarget();
      }

      gameScene.followTarget(localPredicted);
    }

    for (const [sessionId, avatar] of avatars) {
      if (sessionId === localSessionId) continue;
      avatar.update();
    }

    for (const avatar of enemies.values()) avatar.update();
    for (const avatar of projectiles.values()) avatar.update();
    portal?.update(dt);

    if (localCastActive && localCastSpellId !== "") {
      const durationMs = SPELLS[localCastSpellId].castTimeMs;
      const fraction = Math.max(0, Math.min(1, (performance.now() - localCastStartRef) / durationMs));
      playerCastFill.style.width = `${fraction * 100}%`;
    }

    if (targetCastActive) {
      const targetEnemySchema = currentTargetId ? enemySchemaById.get(currentTargetId) : undefined;
      const castDurationMs =
        targetEnemySchema?.kind === "boss" ? ENEMY_STATS.boss.aoeCastTimeMs : ENEMY_STATS.caster.castTimeMs;
      const fraction = Math.max(0, Math.min(1, (performance.now() - targetCastStartRef) / castDurationMs));
      targetCastFill.style.width = `${fraction * 100}%`;
    }

    if (currentTargetId) {
      const targetEnemySchema = enemySchemaById.get(currentTargetId);
      if (targetEnemySchema?.kind === "boss" && targetEnemySchema.enragesAt > 0) {
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
      const el = cooldownEls[i];
      if (!el || !spellId) continue;
      const last = lastClientCastAt.get(spellId) ?? -Infinity;
      const elapsed = performance.now() - last;
      const remaining = Math.max(0, 1 - elapsed / SPELLS[spellId].cooldownMs);
      el.style.height = `${remaining * 100}%`;
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
