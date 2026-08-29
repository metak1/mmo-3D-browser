import * as THREE from "three";
import type { Room, SeatReservation } from "colyseus.js";
import {
  ActionFailedMessage,
  ActionFailReason,
  BOSS_PHASE_2_HP_FRACTION,
  BossStats,
  BUFFS,
  BuffKind,
  CastFailedMessage,
  CastFailReason,
  CastMessage,
  CasterStats,
  ChatBroadcast,
  CLASSES,
  ClassId,
  CombatTextEvent,
  ENEMY_TYPES,
  EnemyBehavior,
  EQUIP_SLOT_LABEL,
  FURNITURE,
  GatherNodeMessage,
  GATHER_INTERACT_RADIUS,
  GATHERING_NODE_TYPES,
  GuildRosterSnapshot,
  InputMessage,
  ITEMS,
  loadGameContent,
  LOOT_PICKUP_RADIUS,
  LootTakeMessage,
  MAP_HALF_EXTENT,
  NPCS,
  NPC_INTERACT_RADIUS,
  NPC_QUEST_IDS,
  PLAYER_SPEED,
  MOUNT_SPEED_MULTIPLIER,
  PORTAL_POSITION,
  RARITY_COLOR,
  isHexPassable,
  resolveStructureCollisions,
  SPELLS,
  SpellId,
  STRUCTURES,
  TimeOfDaySetBroadcast,
  TradeSnapshot,
  WAYPOINTS,
  WAYPOINT_INTERACT_RADIUS,
  WaypointTravelMessage,
  decodeItemToken,
  findStructureLoops,
  getTerrainHeight,
} from "@mmo/shared";
import { createCastPredictor } from "./game/castPrediction";
import { GameScene } from "./game/Scene";
import { Telegraph } from "./game/Telegraph";
import { FloatingCombatText } from "./game/FloatingCombatText";
import { playHitSound, playHealSound, playErrorSound } from "./game/sfx";
import { DEFAULT_Y_OFFSET as HEALTH_BAR_DEFAULT_Y_OFFSET } from "./game/HealthBar";
import { PlayerAvatar } from "./game/Player";
import { EnemyAvatar } from "./game/Enemy";
import { NpcAvatar } from "./game/Npc";
import { StructureAvatar, StructureEnclosureAvatar } from "./game/Structure";
import { WaypointAvatar } from "./game/Waypoint";
import { FurnitureAvatar } from "./game/Furniture";
import { Minimap } from "./game/Minimap";
import { PortalAvatar } from "./game/Portal";
import { ProjectileAvatar } from "./game/Projectile";
import { LootBagAvatar } from "./game/LootBagAvatar";
import { GatheringNodeAvatar } from "./game/GatheringNode";
import { InputController } from "./game/InputController";
import { connectToWorld, consumeDungeonReservation } from "./network/connection";
import * as api from "./network/api";
import { makeDraggable, makeResizable } from "./ui/DraggablePanel";
import { openContextMenu, closeContextMenu } from "./ui/contextMenu";
import {
  inventoryPanel,
  renderInventory,
  updateMountButton,
  useItemSlot,
  useOverrideItem,
  isEquipAssignment,
  lastKnownMaterials,
  lastKnownInventoryTokens,
} from "./ui/inventoryPanel";
import { professionsPanel, renderProfessionsPanel } from "./ui/professionsPanel";
import { talentPanel, renderTalents } from "./ui/talentsPanel";
import { updateCharacterPanel, updateHpBar, typeColor, isAggressiveEnemyType } from "./ui/characterPanel";
import { localClassId, setActiveRoom, setRefreshSpellSlotOverrides, setLocalClassId } from "./clientState";
import { GameSession } from "./GameSession";
import {
  friendsPanel,
  guildPanel,
  renderPartyPanel,
  renderPartyInvitePrompt,
  renderFriendsPanel,
  renderGuildPanel,
  renderTradeInvitePrompt,
  closeTradeWindow,
  actionsForPlayerTarget,
  handleTradeUpdate,
  handleGuildRoster,
  setupSocialPanels,
} from "./ui/socialPanels";
import {
  npcDialoguePanel,
  questLogPanel,
  renderNpcDialogue,
  openNpcDialogue,
  closeNpcDialogue,
  renderQuestLog,
  updateNpcQuestIndicators,
  computeQuestAreaMarkers,
  computeNpcQuestStates,
  setupNpcAndQuestsPanel,
} from "./ui/npcAndQuestsPanel";
import {
  renderDungeonFinderPanel,
  openDungeonFinder,
  setupDungeonFinderPanel,
} from "./ui/dungeonFinderPanel";
import { setupChatPanel, handleChatBroadcast } from "./ui/chatPanel";

const PLAYER_PROJECTILE_COLOR = 0xff9a3c;
const PLAYER_PROJECTILE_EMISSIVE = 0xb35a12;
const ENEMY_PROJECTILE_COLOR = 0xd15fe0;
const ENEMY_PROJECTILE_EMISSIVE = 0x8a2fb0;
const INPUT_SEND_INTERVAL_MS = 1000 / 20;
const SERVER_RECONCILE_LERP = 0.02;
const RECONCILE_SNAP_DISTANCE = 3; // large corrections (e.g. death/respawn teleport) snap instead of creeping
const HOTBAR_SLOT_COUNT = 3;
const AILMENT_LABELS: Record<string, string> = { weaken: "Weakened" };

// Renders a DayNightCycle fraction (0..1, 0/1 = midnight, 0.5 = noon - see that class's own doc
// comment) as a 12-hour clock for the minimap readout. Matches the "/time" chat command's own
// hour<->fraction mapping (handleSlashCommand below) so a value the sun icon shows here is the
// same one an admin would type to get back to it.
function formatTimeOfDay(fraction: number): string {
  const totalMinutes = Math.round(fraction * 24 * 60) % (24 * 60);
  const hours24 = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const icon = hours24 >= 6 && hours24 < 18 ? "☀" : "🌙";
  return `${icon} ${hours12}:${String(minutes).padStart(2, "0")} ${hours24 < 12 ? "AM" : "PM"}`;
}

const hud = document.getElementById("hud")!;
const container = document.getElementById("app")!;
const minimap = new Minimap(document.getElementById("minimap") as HTMLCanvasElement);
const minimapClockEl = document.getElementById("minimap-clock")!;
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

// canvas.width/height are the backing-resolution pixels Minimap.project()/pan()/zoomBy() all work
// in (see bigMapResizeObserver above - scaled by devicePixelRatio), but mouse events report
// CSS pixels against the element's on-screen (getBoundingClientRect) size - this converts one to
// the other so a drag/scroll feels 1:1 with the cursor regardless of that ratio.
function toBigMapBackingPixels(dxCss: number, dyCss: number): { x: number; y: number } {
  const rect = bigMapCanvas.getBoundingClientRect();
  return {
    x: dxCss * (rect.width > 0 ? bigMapCanvas.width / rect.width : 1),
    y: dyCss * (rect.height > 0 ? bigMapCanvas.height / rect.height : 1),
  };
}

const BIG_MAP_ZOOM_STEP = 1.2;
let bigMapPanning = false;
let bigMapPanLastX = 0;
let bigMapPanLastY = 0;

bigMapCanvas.addEventListener("mousedown", (event) => {
  bigMapPanning = true;
  bigMapPanLastX = event.clientX;
  bigMapPanLastY = event.clientY;
  bigMapCanvas.style.cursor = "grabbing";
  event.preventDefault(); // don't let a drag starting here also select page text
});
window.addEventListener("mousemove", (event) => {
  if (!bigMapPanning) return;
  const delta = toBigMapBackingPixels(event.clientX - bigMapPanLastX, event.clientY - bigMapPanLastY);
  bigMap.pan(delta.x, delta.y);
  bigMapPanLastX = event.clientX;
  bigMapPanLastY = event.clientY;
});
window.addEventListener("mouseup", () => {
  if (!bigMapPanning) return;
  bigMapPanning = false;
  bigMapCanvas.style.cursor = "grab";
});

bigMapCanvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault(); // don't also scroll the page underneath the panel
    const cursor = toBigMapBackingPixels(event.offsetX, event.offsetY);
    bigMap.zoomBy(event.deltaY < 0 ? BIG_MAP_ZOOM_STEP : 1 / BIG_MAP_ZOOM_STEP, cursor.x, cursor.y);
  },
  { passive: false },
);

const playerHpFill = document.querySelector<HTMLElement>("[data-player-hp-fill]")!;
const playerHpLabel = document.querySelector<HTMLElement>("[data-player-hp-label]")!;
const playerAilmentsEl = document.querySelector<HTMLElement>("[data-player-ailments]")!;
const playerBuffsEl = document.querySelector<HTMLElement>("[data-player-buffs]")!;
const playerDotsEl = document.querySelector<HTMLElement>("[data-player-dots]")!;
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

const dungeonStatusPanel = document.getElementById("dungeon-status-panel")!;
const dungeonEncounterLabelEl = document.querySelector<HTMLElement>("[data-dungeon-encounter-label]")!;
const leaveDungeonBtn = document.querySelector<HTMLButtonElement>("[data-leave-dungeon]")!;

const lootWindow = document.getElementById("loot-window")!;
const lootListEl = document.getElementById("loot-list")!;

const waypointPanel = document.getElementById("waypoint-panel")!;
const waypointMapCanvas = document.getElementById("waypoint-map") as HTMLCanvasElement;
const waypointMap = new Minimap(waypointMapCanvas, true);

const actionFeedbackEl = document.getElementById("action-feedback")!;

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
makeDraggable(lootWindow, "loot");
makeDraggable(waypointPanel, "waypoint");
makeDraggable(dungeonStatusPanel, "dungeon-status");

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
  const gatheringNodes = new Map<string, GatheringNodeAvatar>();
  const gatheringNodeSchemaById = new Map<string, { x: number; z: number; available: boolean }>();
  const dungeonListingSchemaById = new Map<string, { partyId: string; leaderSessionId: string; createdAt: number }>();

  // NPCs are static shared data (no hp, no server-synced position), so they're spawned once
  // from NPCS rather than synced through room state like enemies/players/loot bags. One with
  // no quest and no vendor catalog has no reason for a player to seek it out by a fixed spot,
  // so it wanders a little near its authored position instead of just standing there - purely
  // cosmetic (see NpcAvatar's `wander` flag), the interact/vendor logic still keys off NPCS[id]'s
  // authored x/z, unaffected by wherever the avatar has currently wandered to.
  const npcs = new Map<string, NpcAvatar>();
  for (const def of Object.values(NPCS)) {
    const wander = !def.vendorItemIds?.length && !(NPC_QUEST_IDS[def.id]?.length) && !def.teachesProfessionId;
    const avatar = new NpcAvatar(def.name, wander);
    avatar.group.userData.npcId = def.id;
    avatar.setPosition(def.x, def.z, def.yOffset);
    avatar.setVendorIndicator(!!def.vendorItemIds);
    avatar.setTrainerIndicator(!!def.teachesProfessionId);
    avatar.addTo(gameScene.scene);
    npcs.set(def.id, avatar);
  }

  // The shared-state bridge to the four panel-like sections split into client/src/ui/*.ts
  // (social panels, NPC dialogue + quests, dungeon finder, chat) - see GameSession's own doc
  // comment for why only these ~17 fields live here instead of the whole closure. avatars/npcs/
  // playerSchemaById/dungeonListingSchemaById are the same Map instances declared above, not
  // copies - mutating them here or through `session` is the same object either way.
  // setTarget/isNearWorldPoint/showActionFeedback are referenced by name before their textual
  // `function` definitions below - safe, function declarations are fully hoisted.
  const session: GameSession = {
    token,
    characterId,
    isDungeon,
    localSessionId: null,
    localPlayerSchema: undefined,
    playerSchemaById,
    avatars,
    npcs,
    dungeonListingSchemaById,
    currentNpcDialogueId: null,
    activeGuildRoster: null,
    activeTradeSnapshot: null,
    activeChatChannel: "say",
    chatHistory: { say: [], party: [], guild: [] },
    setTarget: (id) => setTarget(id),
    isNearWorldPoint: (x, z, radius) => isNearWorldPoint(x, z, radius),
    showActionFeedback: (text) => showActionFeedback(text),
  };

  setupSocialPanels(session);
  setupNpcAndQuestsPanel(session);
  setupDungeonFinderPanel();
  setupChatPanel(session);

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
  const groundTargetPreview = new Telegraph();
  gameScene.scene.add(groundTargetPreview.mesh);

  const combatText = new FloatingCombatText(gameScene.scene);

  let room: Room | undefined;
  let currentTargetId: string | null = null;
  let currentLootBagId: string | null = null;
  let currentWaypointId: string | null = null;
  let pendingGroundTargetSpellId: SpellId | null = null;
  let pendingGroundTargetSlotIndex: number | null = null;
  let lastGroundCursorX = 0;
  let lastGroundCursorZ = 0;

  let localHp = 0;
  let localMaxHp = 0;
  let localCastSpellId = "";
  let localGuildId = 0;
  let localGuildRole = "";
  let localCastActive = false;
  let localCastStartRef = 0;

  let targetCastActive = false;
  let targetCastStartRef = 0;

  const localPredicted = new THREE.Vector3(0, 0, 0);
  const localServerPosition = new THREE.Vector3(0, 0, 0);
  const followTargetScratch = new THREE.Vector3(0, 0, 0); // localPredicted.y stays gameplay-0 always; this carries terrain height for the camera only
  let localRotationY = 0;
  let seq = 0;

  const castPredictor = createCastPredictor();

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
    renderSpellSlotOverrides();
  }

  // Slots 1-3 default to the class's own spells, but can be overridden with an item/equip token
  // dragged from the bag - same drag contract item slots 4-6 already use (text/plain payload),
  // just a second possible destination for it. Right-click reverts to the spell (there's always
  // one underneath, unlike slots 4-6 which just go empty). Persisted per-browser like the item
  // hotbar - see ITEM_SLOT_STORAGE_KEY's own reasoning for why that scope is fine here too.
  const SPELL_SLOT_OVERRIDE_KEY = "mmo:spellHotbarOverrides";
  function loadSpellSlotOverrides(): (string | null)[] {
    try {
      const raw = localStorage.getItem(SPELL_SLOT_OVERRIDE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.from({ length: HOTBAR_SLOT_COUNT }, (_, i) =>
        Array.isArray(parsed) && typeof parsed[i] === "string" ? (parsed[i] as string) : null,
      );
    } catch {
      return Array.from({ length: HOTBAR_SLOT_COUNT }, () => null);
    }
  }
  let spellSlotOverrides: (string | null)[] = loadSpellSlotOverrides();

  function renderSpellSlotOverrides() {
    for (let i = 0; i < HOTBAR_SLOT_COUNT; i++) {
      const overrideId = spellSlotOverrides[i];
      const slotEl = spellSlotEls[i];
      const nameEl = nameEls[i];
      if (!overrideId) {
        slotEl?.classList.remove("overridden", "unusable");
        const id = slotSpellIds[i];
        nameEl.textContent = id ? SPELLS[id].name : "";
        continue;
      }
      const decoded = decodeItemToken(overrideId);
      const item = ITEMS[decoded.itemId];
      const depleted = isEquipAssignment(overrideId) ? !lastKnownInventoryTokens.has(overrideId) : (lastKnownMaterials.get(overrideId) ?? 0) <= 0;
      slotEl?.classList.add("overridden");
      slotEl?.classList.toggle("unusable", depleted);
      slotEl?.classList.remove("too-far");
      nameEl.textContent = item ? `${item.icon} ${item.name}` : overrideId;
      // The per-frame loop skips overridden slots entirely (see the animate loop's own guard),
      // so any cooldown sweep/charge badge that was mid-animation when the override landed would
      // otherwise freeze in place behind the item's name - clear it here instead.
      cooldownEls[i].style.height = "0%";
      if (chargesEls[i]) chargesEls[i].hidden = true;
    }
  }
  setRefreshSpellSlotOverrides(renderSpellSlotOverrides);

  function setSpellSlotOverride(index: number, itemId: string | null) {
    spellSlotOverrides[index] = itemId;
    try {
      localStorage.setItem(SPELL_SLOT_OVERRIDE_KEY, JSON.stringify(spellSlotOverrides));
    } catch {
      // best-effort - a private/blocked storage context just means the assignment doesn't survive reload
    }
    renderSpellSlotOverrides();
  }

  for (let i = 0; i < HOTBAR_SLOT_COUNT; i++) {
    const el = spellSlotEls[i];
    const index = i;
    el.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (!spellSlotOverrides[index]) return;
      setSpellSlotOverride(index, null);
    });
    el.addEventListener("dragover", (event) => event.preventDefault());
    el.addEventListener("dragenter", () => el.classList.add("drag-over"));
    el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
    el.addEventListener("drop", (event) => {
      event.preventDefault();
      el.classList.remove("drag-over");
      const itemId = event.dataTransfer?.getData("text/plain");
      if (itemId) setSpellSlotOverride(index, itemId);
    });
  }

  function triggerSpellSlot(slotIndex: number) {
    const overrideId = spellSlotOverrides[slotIndex];
    if (overrideId) {
      useOverrideItem(overrideId);
      return;
    }
    castSpell(slotIndex);
  }

  function updateHud() {
    if (!session.localSessionId) return;
    hud.textContent = `Connected as ${session.localSessionId}`;
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

  // DotStack (see WorldState.ts) carries no name/kind of its own (unlike ailments/buffs, which
  // key off AilmentKind/BuffKind) - it's just however many damage-over-time stacks are currently
  // ticking, so this shows a stack count rather than a list of named effects.
  function updateDotIndicator(player: { dots: { length: number } }) {
    const count = player.dots.length;
    playerDotsEl.textContent = count > 0 ? `DOT${count > 1 ? ` ×${count}` : ""}` : "";
    playerDotsEl.hidden = count === 0;
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
      targetNameEl.textContent = id === session.localSessionId ? `${className} (You)` : className;
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

  function sendCast(spellId: SpellId, message: CastMessage) {
    castPredictor.pushCast(spellId, performance.now());
    room?.send("cast", message);
  }

  const CAST_FAIL_LABEL: Record<CastFailReason, string> = {
    out_of_range: "Out of Range",
    no_line_of_sight: "No Line of Sight",
    no_target: "No Target Selected",
    already_casting: "Already Casting",
    on_cooldown: "On Cooldown",
    interrupted: "Interrupted",
  };

  const ACTION_FAIL_LABEL: Record<ActionFailReason, string> = {
    too_far: "Too Far Away",
    inventory_full: "Inventory Full",
    not_enough_gold: "Not Enough Gold",
    not_available: "Not Available",
    not_found: "Character Not Found",
    already_friends: "Already Friends",
    already_pending: "Request Already Pending",
    already_in_guild: "Already In a Guild",
    name_taken: "Name Taken",
    not_leader: "Not the Guild Leader",
    not_admin: "Admins Only",
    profession_not_learned: "Profession Not Learned",
    profession_slots_full: "Already Know 2 Professions",
    profession_already_learned: "Already Known",
    level_too_low: "Level Too Low",
    insufficient_materials: "Not Enough Materials",
    not_usable: "Can't Use That",
    no_mount: "No Mount Owned",
  };

  // One shared toast for every reason a player-initiated action can fail - started out cast-only
  // (see castSpell's own predictive checks below and the "cast_failed" server message) and now
  // also covers loot/quest/vendor/waypoint rejections (see "action_failed" below and the
  // proximity pre-checks before openLootWindow/openNpcDialogue/openWaypointPanel) - a single spot
  // so "the player tried to do something and it didn't work" always gets the same clear,
  // consistent acknowledgment regardless of which check caught it or whether it was
  // client-predicted or a server round-trip.
  let actionFeedbackFadeTimer = 0;
  function showActionFeedback(text: string) {
    actionFeedbackEl.textContent = text;
    actionFeedbackEl.classList.remove("visible");
    void actionFeedbackEl.offsetWidth; // force reflow so re-triggering the same text still re-fades from a full restart
    actionFeedbackEl.classList.add("visible");
    window.clearTimeout(actionFeedbackFadeTimer);
    actionFeedbackFadeTimer = window.setTimeout(() => actionFeedbackEl.classList.remove("visible"), 1300);
    playErrorSound();
  }

  // Small allowance for latency between this client-side check and the server's own (same idea as
  // castSpell's CLIENT_RANGE_BUFFER below, just shared across every interact-radius check instead
  // of a spell-range one) - keeps an "in range" verdict here from diverging from what the server
  // will accept for a legitimately-in-range click.
  const CLIENT_INTERACT_RANGE_BUFFER = 1;
  function isNearWorldPoint(x: number, z: number, radius: number): boolean {
    return Math.hypot(localPredicted.x - x, localPredicted.z - z) <= radius + CLIENT_INTERACT_RANGE_BUFFER;
  }

  // Reuses HealthBar's own DEFAULT_Y_OFFSET as the world-space anchor (imported, not duplicated,
  // so the two can never silently drift apart the way a copied literal would) - the extra 100
  // screen pixels on top of that is the actual "float above the player" clearance, applied in
  // screen space (not world units) so it stays a constant, readable distance regardless of camera
  // zoom/distance.
  const ACTION_FEEDBACK_WORLD_Y_OFFSET = HEALTH_BAR_DEFAULT_Y_OFFSET;
  const ACTION_FEEDBACK_SCREEN_OFFSET_PX = 100;
  const actionFeedbackAnchorScratch = new THREE.Vector3();

  // Projects the local player's position to a screen pixel and repositions the toast there (see
  // #action-feedback's own CSS comment for how translate(-50%, -100%) uses this point). Called every
  // frame from animate() alongside the rest of the local-player sync, so the toast tracks the
  // player smoothly even while it's fading out, not just at the moment it's shown.
  function syncActionFeedbackPosition(worldX: number, worldY: number, worldZ: number) {
    actionFeedbackAnchorScratch.set(worldX, worldY + ACTION_FEEDBACK_WORLD_Y_OFFSET, worldZ).project(gameScene.camera);
    const rect = gameScene.renderer.domElement.getBoundingClientRect();
    const screenX = rect.left + ((actionFeedbackAnchorScratch.x + 1) / 2) * rect.width;
    const screenY = rect.top + ((1 - actionFeedbackAnchorScratch.y) / 2) * rect.height;
    actionFeedbackEl.style.left = `${screenX}px`;
    actionFeedbackEl.style.top = `${screenY - ACTION_FEEDBACK_SCREEN_OFFSET_PX}px`;
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
    showActionFeedback(CAST_FAIL_LABEL.out_of_range);
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
      if (!currentTargetId || currentTargetId === session.localSessionId || !playerSchemaById.has(currentTargetId)) return false;
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

    if (localCastActive) {
      showActionFeedback(CAST_FAIL_LABEL.already_casting);
      return;
    }

    const spell = SPELLS[spellId];
    const now = performance.now();
    if (castPredictor.activeCastsFor(spellId, now).length >= castPredictor.maxChargesFor(spellId, localClassId, session.localPlayerSchema?.talentRanks)) {
      showActionFeedback(CAST_FAIL_LABEL.on_cooldown);
      return;
    }

    if (spell.targetType === "ground") {
      pendingGroundTargetSpellId = spellId;
      pendingGroundTargetSlotIndex = slotIndex;
      container.classList.add("ground-target-pending");
      groundTargetPreview.setShape(spell.effects[0].shape);
      groundTargetPreview.show();
      return;
    }

    if (spell.targetType === "enemy") {
      if (!currentTargetId || !enemySchemaById.has(currentTargetId)) {
        showActionFeedback(CAST_FAIL_LABEL.no_target);
        return;
      }
      const enemyPos = enemies.get(currentTargetId)?.group.position;
      if (enemyPos && !isWithinSpellRange(spellId, enemyPos.x, enemyPos.z)) {
        flashOutOfRange(slotIndex);
        return;
      }
      sendCast(spellId, { spellId, targetId: currentTargetId });
    } else if (spell.targetType === "ally") {
      const targetId = currentTargetId && playerSchemaById.has(currentTargetId) ? currentTargetId : session.localSessionId ?? undefined;
      if (!targetId) {
        showActionFeedback(CAST_FAIL_LABEL.no_target);
        return;
      }
      if (targetId !== session.localSessionId) {
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
      row.innerHTML = `<span style="color: ${RARITY_COLOR[rarity]}">${item.name}</span><span class="item-slot-tag">${item.slot ? EQUIP_SLOT_LABEL[item.slot] : "Material"}</span>`;
      row.addEventListener("click", () => {
        const message: LootTakeMessage = { bagId: currentLootBagId!, itemId: token };
        room?.send("loot_take", message);
      });
      lootListEl.appendChild(row);
    }
  }

  function openLootWindow(bagId: string) {
    const bag = lootBagSchemaById.get(bagId);
    if (bag && !isNearWorldPoint(bag.x, bag.z, LOOT_PICKUP_RADIUS)) {
      showActionFeedback(ACTION_FAIL_LABEL.too_far);
      return;
    }
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

  // Draws the whole map's terrain (same as the M-key big map) but with waypointsOnly=true so
  // structures/NPCs/portal/boss arena don't compete for attention on a panel whose only job is
  // picking a destination - just the waypoints, every OTHER one linked back to the current one and
  // labeled by name, plus a highlighted "you are here"
  // marker over the current one - see Minimap.update's travelFromWaypointId param. The server
  // independently re-validates that the player is actually standing near some waypoint (see
  // WorldRoom.handleWaypointTravel) - this client-side proximity gate (openWaypointPanel below)
  // just keeps the panel itself from ever opening somewhere that request would get rejected. A
  // static snapshot at open time, not wired into the per-frame animate() loop like the minimap/big
  // map are - picking a fast-travel destination doesn't need a live-updating view.
  function renderWaypointPanel() {
    if (!currentWaypointId) return;
    waypointMap.resetView();
    const self = { x: localPredicted.x, z: localPredicted.z, rotationY: localRotationY };
    waypointMap.update(self, true, [], new Map(), currentWaypointId, true);
  }

  // Mirrors main.ts's own toBigMapBackingPixels - canvas.width/height are the backing-resolution
  // pixels Minimap.project()/hitTestWaypoint() work in, but mouse events report CSS pixels against
  // the element's on-screen size.
  function toWaypointMapBackingPixels(cssX: number, cssY: number): { x: number; y: number } {
    const rect = waypointMapCanvas.getBoundingClientRect();
    return {
      x: cssX * (rect.width > 0 ? waypointMapCanvas.width / rect.width : 1),
      y: cssY * (rect.height > 0 ? waypointMapCanvas.height / rect.height : 1),
    };
  }

  waypointMapCanvas.addEventListener("click", (event) => {
    if (!currentWaypointId) return;
    const p = toWaypointMapBackingPixels(event.offsetX, event.offsetY);
    const hitId = waypointMap.hitTestWaypoint(p.x, p.y);
    if (!hitId || hitId === currentWaypointId) return;
    const message: WaypointTravelMessage = { targetWaypointId: hitId };
    room?.send("waypoint_travel", message);
    closeWaypointPanel();
  });

  // Only the cursor reacts on hover (a pointer over a clickable waypoint, a grab cursor otherwise -
  // matches the panel's own draggable affordance) - no re-render needed since the map itself is a
  // static snapshot (see renderWaypointPanel's own doc comment).
  waypointMapCanvas.addEventListener("mousemove", (event) => {
    if (!currentWaypointId) return;
    const p = toWaypointMapBackingPixels(event.offsetX, event.offsetY);
    const hitId = waypointMap.hitTestWaypoint(p.x, p.y);
    waypointMapCanvas.style.cursor = hitId && hitId !== currentWaypointId ? "pointer" : "default";
  });

  function openWaypointPanel(waypointId: string) {
    const waypoint = WAYPOINTS.find((w) => w.id === waypointId);
    if (waypoint && !isNearWorldPoint(waypoint.x, waypoint.z, WAYPOINT_INTERACT_RADIUS)) {
      showActionFeedback(ACTION_FAIL_LABEL.too_far);
      return;
    }
    currentWaypointId = waypointId;
    waypointPanel.hidden = false;
    renderWaypointPanel();
  }

  function closeWaypointPanel() {
    currentWaypointId = null;
    waypointPanel.hidden = true;
  }

  document.querySelector("[data-waypoint-close]")!.addEventListener("click", () => closeWaypointPanel());

  // Gathering has no panel - a click is the whole interaction (server resolves range/availability/
  // profession-learned/level itself; this is just the same "predict the obvious failure locally so
  // the toast is instant" pre-check openWaypointPanel/openLootWindow already do).
  function handleGatherClick(nodeId: string) {
    const node = gatheringNodeSchemaById.get(nodeId);
    if (node && !isNearWorldPoint(node.x, node.z, GATHER_INTERACT_RADIUS)) {
      showActionFeedback(ACTION_FAIL_LABEL.too_far);
      return;
    }
    if (node && !node.available) {
      showActionFeedback(ACTION_FAIL_LABEL.not_available);
      return;
    }
    const message: GatherNodeMessage = { nodeId };
    room?.send("gather_node", message);
  }

  leaveDungeonBtn.addEventListener("click", () => {
    // Carries the party (if any) through the return trip - see the matching restorePartyId
    // plumbing in main()'s connect call and WorldRoom.onJoin, and DungeonRoom.onJoin's
    // identical carry-through on the way in.
    const partyId = session.localPlayerSchema?.partyId || undefined;
    sessionStorage.setItem("mmo:pendingConnect", JSON.stringify({ mode: "world", token, characterId, partyId }));
    window.location.reload();
  });

  const characterPanel = document.getElementById("character-panel")!;

  window.addEventListener("keydown", (e) => {
    if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) return;
    if (e.code === "Digit1") triggerSpellSlot(0);
    else if (e.code === "Digit2") triggerSpellSlot(1);
    else if (e.code === "Digit3") triggerSpellSlot(2);
    else if (e.code === "Digit4") useItemSlot(0);
    else if (e.code === "Digit5") useItemSlot(1);
    else if (e.code === "Digit6") useItemSlot(2);
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
      if (!talentPanel.hidden && session.localPlayerSchema) renderTalents(session.localPlayerSchema);
    }
    else if (e.code === "KeyL") questLogPanel.hidden = !questLogPanel.hidden;
    else if (e.code === "KeyR") {
      professionsPanel.hidden = !professionsPanel.hidden;
      if (!professionsPanel.hidden && session.localPlayerSchema) renderProfessionsPanel(session.localPlayerSchema);
    }
    else if (e.code === "KeyO") friendsPanel.hidden = !friendsPanel.hidden;
    else if (e.code === "KeyG") {
      const opening = guildPanel.hidden;
      guildPanel.hidden = !guildPanel.hidden;
      if (opening && session.localPlayerSchema && session.localPlayerSchema.guildId !== 0) room?.send("guild_roster_request");
    }
    else if (e.code === "KeyM") {
      bigMapPanel.hidden = !bigMapPanel.hidden;
      // Reset pan/zoom on open (not close) - so a previous session's zoomed-in corner never
      // greets the player next time they press M, without losing the view mid-session if they
      // toggle other panels while the map stays open.
      if (!bigMapPanel.hidden) bigMap.resetView();
    }
    else if (e.code === "KeyH") room?.send("toggle_mount");
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
      ...[...gatheringNodes.values()].map((avatar) => avatar.group),
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
      !obj.userData.gatheringNodeId &&
      !obj.userData.isPortal
    ) {
      obj = obj.parent;
    }

    if (obj?.userData.bagId) {
      openLootWindow(obj.userData.bagId as string);
      return;
    }
    if (obj?.userData.npcId) {
      openNpcDialogue(session, obj.userData.npcId as string);
      return;
    }
    if (obj?.userData.waypointId) {
      openWaypointPanel(obj.userData.waypointId as string);
      return;
    }
    if (obj?.userData.gatheringNodeId) {
      handleGatherClick(obj.userData.gatheringNodeId as string);
      return;
    }
    if (obj?.userData.isPortal) {
      openDungeonFinder(session);
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
    const actions = sessionId ? actionsForPlayerTarget(session, sessionId) : [];
    if (actions.length === 0) {
      closeContextMenu();
      return;
    }
    openContextMenu(event.clientX, event.clientY, actions);
  });

  targetPanel.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const actions = currentTargetId ? actionsForPlayerTarget(session, currentTargetId) : [];
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
    setActiveRoom(room);
    const $ = connection.$;
    session.localSessionId = room.sessionId;
    (window as any).__debugRoom = room; // TEMP: collision QA probe, remove after testing

    // Room transitions (overworld <-> dungeon) are a reservation + full page reload rather
    // than an in-place scene rebuild - main() only ever fully sets up one room connection
    // per page load, so switching rooms just stashes what's needed and reloads into it.
    room.onMessage("dungeon_ready", (reservation: SeatReservation) => {
      sessionStorage.setItem("mmo:pendingConnect", JSON.stringify({ mode: "dungeon", reservation, token, characterId }));
      window.location.reload();
    });

    // Works identically in the overworld and inside a dungeon instance - both room types
    // broadcast the same "chat" message shape (see server/src/rooms/chat.ts).
    room.onMessage("chat", (payload: ChatBroadcast) => handleChatBroadcast(session, payload));

    // The "/time" admin command's result (see handleSlashCommand) - broadcast to every client in
    // the room, not just whoever ran the command, so it reads as a GM tool everyone sees the effect
    // of. WorldRoom-only (see WorldRoom.handleSetTimeOfDay), same "harmless to register
    // unconditionally" reasoning as trade/guild below - a dungeon connection just never emits it.
    room.onMessage("time_of_day_set", (payload: TimeOfDaySetBroadcast) => gameScene.setTimeOfDay(payload.fraction));

    // Trade is WorldRoom-only (see plan) but these handlers are harmless to register
    // unconditionally - a DungeonRoom connection simply never emits these message types.
    room.onMessage("trade_update", (snapshot: TradeSnapshot) => handleTradeUpdate(session, snapshot));
    room.onMessage("trade_complete", () => closeTradeWindow(session));
    room.onMessage("trade_cancelled", () => closeTradeWindow(session));

    // Guild management (create/invite/kick/promote/disband) is WorldRoom-only (see plan) but
    // guild_roster is harmless to register unconditionally - a DungeonRoom connection just never
    // emits it since its own handleGuildRosterRequest is the only thing that can trigger it there.
    room.onMessage("guild_roster", (snapshot: GuildRosterSnapshot) => handleGuildRoster(session, snapshot));

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

    // Targeted at just this client (see CastFailedMessage's own doc comment) - covers the
    // failure reasons castSpell can't predict itself (no_line_of_sight) plus a safety net for the
    // ones it normally already catches client-side, so a cast that fails for any reason always
    // gets the same visible acknowledgment even if client/server state briefly disagrees.
    room.onMessage("cast_failed", (event: CastFailedMessage) => showActionFeedback(CAST_FAIL_LABEL[event.reason]));
    // Same "safety net for state the client couldn't (or didn't bother to) predict" role as
    // cast_failed above, for loot/quest/vendor/waypoint instead of spells - see ActionFailedMessage's
    // own doc comment.
    room.onMessage("action_failed", (event: ActionFailedMessage) => showActionFeedback(ACTION_FAIL_LABEL[event.reason]));

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
        renderDungeonFinderPanel(session);
      });
      $(room.state).dungeonListings.onRemove((_listing, partyId) => {
        dungeonListingSchemaById.delete(partyId);
        renderDungeonFinderPanel(session);
      });
    }

    $(room.state).players.onAdd((player, sessionId) => {
      const avatar = new PlayerAvatar(player.classId, player.name);
      avatar.group.userData.sessionId = sessionId;
      avatar.setTarget(player.x, getTerrainHeight(player.x, player.z), player.z, player.rotationY);
      avatar.snapToTarget(0, false);
      avatar.setHp(player.hp, player.maxHp);
      avatar.setLevel(player.level);
      avatar.setName(player.name, player.guildName);
      avatar.addTo(gameScene.scene);
      avatars.set(sessionId, avatar);
      playerSchemaById.set(sessionId, player);

      if (sessionId === session.localSessionId) {
        localHp = player.hp;
        localMaxHp = player.maxHp;
        session.localPlayerSchema = player;
        setLocalClassId(player.classId as ClassId);
        updateHud();
        updateHpBar(playerHpFill, playerHpLabel, localHp, localMaxHp);
        updateCharacterPanel(player);
        updateAilmentIndicator(player);
        updateBuffIndicator(player);
        updateDotIndicator(player);
        updateMountButton(player);
        setupHotbarForClass(player.classId);
        updateNpcQuestIndicators(session);
        renderPartyPanel(session);
        renderDungeonFinderPanel(session);
        renderPartyInvitePrompt(session, player);
        renderTradeInvitePrompt(session, player);
        renderFriendsPanel(session);
        renderGuildPanel(session);
        localGuildId = player.guildId;
        localGuildRole = player.guildRole;
        if (localGuildId !== 0) room?.send("guild_roster_request");

        // Same nested-schema-doesn't-bubble reasoning as questProgress/ailments/buffs below -
        // friends/pendingFriendRequests/pendingGuildInvites are their own MapSchema/ArraySchema,
        // so mutating one doesn't reliably trigger the parent Player's own onChange. Each
        // FriendEntry can also change in place (online flips) without being added/removed, so
        // it needs its own per-entry listener too - mirrors how enemy/projectile schemas below
        // bind $(entry).onChange() individually as each one is added.
        $(player.friends).onAdd((friend) => {
          renderFriendsPanel(session);
          $(friend).onChange(() => renderFriendsPanel(session));
        });
        $(player.friends).onRemove(() => renderFriendsPanel(session));
        $(player.pendingFriendRequests).onAdd(() => renderFriendsPanel(session));
        $(player.pendingFriendRequests).onRemove(() => renderFriendsPanel(session));
        $(player.pendingGuildInvites).onAdd(() => renderGuildPanel(session));
        $(player.pendingGuildInvites).onRemove(() => renderGuildPanel(session));

        // Mutating a nested MapSchema (questProgress/questCompleted/ailments) does not
        // reliably trigger the parent Player's own onChange callback below unless a sibling
        // scalar field also changes in the same tick. Ailment *application* happens to also
        // change hp in the same tick (so it already updated live), but accept/turn-in and
        // Cleanse's ailments.clear() touch nothing else - they need their own explicit
        // listeners to keep the dialogue/quest-log/ailment indicator/NPC head-icon live.
        const rerenderQuestUi = () => {
          renderNpcDialogue(session);
          renderQuestLog(session);
          updateNpcQuestIndicators(session);
        };
        $(player.questProgress).onAdd(rerenderQuestUi);
        $(player.questProgress).onChange(rerenderQuestUi);
        $(player.questProgress).onRemove(rerenderQuestUi);
        $(player.questCompleted).onAdd(rerenderQuestUi);
        $(player.ailments).onAdd(() => updateAilmentIndicator(player));
        $(player.ailments).onRemove(() => updateAilmentIndicator(player));
        $(player.buffs).onAdd(() => updateBuffIndicator(player));
        $(player.buffs).onRemove(() => updateBuffIndicator(player));
        $(player.dots).onAdd(() => updateDotIndicator(player));
        $(player.dots).onRemove(() => updateDotIndicator(player));
        // Same reasoning as above - a completed trade removes/adds inventory tokens (see
        // TradeManager.finalize) without necessarily touching gold (a trade can be items-only),
        // so the parent Player onChange below isn't guaranteed to fire and the inventory panel
        // was staying stale until something unrelated (equip, loot, reconnect) forced a re-render.
        $(player.inventory).onAdd(() => renderInventory(player));
        $(player.inventory).onRemove(() => renderInventory(player));
        // Same nested-MapSchema reasoning as questProgress/ailments above - professionXp/
        // professionLevel/materials each need their own explicit listeners to keep the
        // Professions panel (all its tabs depend on all 3 maps at once) AND an open trainer NPC
        // dialogue (its Learn button's disabled/Learned state) live.
        const rerenderProfessionsUi = () => {
          renderProfessionsPanel(player);
          renderNpcDialogue(session);
        };
        $(player.professionXp).onAdd(rerenderProfessionsUi);
        $(player.professionXp).onChange(rerenderProfessionsUi);
        $(player.professionXp).onRemove(rerenderProfessionsUi);
        $(player.professionLevel).onChange(rerenderProfessionsUi);
        // Materials also render inside the Inventory panel now (see renderInventory) - that's
        // the one place professionXp/professionLevel changes never need to reach.
        const rerenderMaterialsUi = () => {
          rerenderProfessionsUi();
          renderInventory(player);
        };
        $(player.materials).onAdd(rerenderMaterialsUi);
        $(player.materials).onChange(rerenderMaterialsUi);
        $(player.materials).onRemove(rerenderMaterialsUi);
      }

      $(player).onChange(() => {
        // Called before the local-player branch's early `return` below, so a partyId/hp
        // change on ANY player (local or remote) always keeps the party frame list live.
        renderPartyPanel(session);
        renderDungeonFinderPanel(session);

        avatar.setHp(player.hp, player.maxHp);
        avatar.setLevel(player.level);
        avatar.setName(player.name, player.guildName);
        avatar.setMounted(player.mounted);

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

        if (sessionId === session.localSessionId) {
          localServerPosition.set(player.x, player.y, player.z);
          localHp = player.hp;
          localMaxHp = player.maxHp;
          updateHpBar(playerHpFill, playerHpLabel, localHp, localMaxHp);
          updateCharacterPanel(player);
          updateAilmentIndicator(player);
          updateBuffIndicator(player);
          updateDotIndicator(player);
          updateMountButton(player);
          renderNpcDialogue(session);
          renderQuestLog(session);
          renderPartyInvitePrompt(session, player);
          renderTradeInvitePrompt(session, player);
          renderGuildPanel(session);

          // Only an actual guildId/guildRole transition (joined/left/kicked/promoted) warrants a
          // fresh roster pull, not every field change on this Player (which fires every movement
          // tick) - same "compare against a cached previous value" guard castSpellId uses below.
          if (player.guildId !== localGuildId || player.guildRole !== localGuildRole) {
            localGuildId = player.guildId;
            localGuildRole = player.guildRole;
            if (localGuildId === 0) session.activeGuildRoster = null;
            else if (!guildPanel.hidden) room?.send("guild_roster_request");
          }

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
      renderPartyPanel(session);
      renderDungeonFinderPanel(session);
    });

    $(room.state).enemies.onAdd((enemy, enemyId) => {
      const enemyType = ENEMY_TYPES[enemy.enemyTypeId];
      const enemyName = enemyType?.name ?? enemy.enemyTypeId;
      const aggressive = isAggressiveEnemyType(enemy.enemyTypeId);
      const avatar = new EnemyAvatar(enemy.behavior as EnemyBehavior, enemyName, aggressive, enemyType?.modelId);
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

    // Gathering nodes are seeded once at room init and live for the room's whole lifetime (unlike
    // loot bags) - only `available` ever flips, on gather/respawn (WorldRoom.handleGatherNode) -
    // so onAdd is the only lifecycle event that matters here, no onRemove.
    $(room.state).gatheringNodes.onAdd((node, nodeId) => {
      const nodeType = GATHERING_NODE_TYPES[node.nodeTypeId];
      const avatar = new GatheringNodeAvatar(nodeType?.modelId ?? "", nodeType?.name ?? "", node.x, node.z);
      avatar.group.userData.gatheringNodeId = nodeId;
      avatar.setAvailable(node.available);
      avatar.addTo(gameScene.scene);
      gatheringNodes.set(nodeId, avatar);
      gatheringNodeSchemaById.set(nodeId, node);

      $(node).onChange(() => avatar.setAvailable(node.available));
    });

    room.onLeave(() => {
      hud.textContent = "Disconnected from server";
    });

    setInterval(() => {
      const { moveX, moveZ } = input.getMovement();
      if (moveX !== 0 || moveZ !== 0) castPredictor.cancelPendingCooldown(performance.now());
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
    if (!schema?.isCasting || schema.behavior !== "boss") return avatar.setTelegraph(false);

    const stats = ENEMY_TYPES[schema.enemyTypeId]?.stats as BossStats | undefined;
    if (!stats) return avatar.setTelegraph(false);

    const bossX = avatar.group.position.x;
    const bossZ = avatar.group.position.z;
    const targetAvatar = schema.aggroTargetId ? avatars.get(schema.aggroTargetId) : undefined;
    const impactX = targetAvatar?.group.position.x ?? bossX;
    const impactZ = targetAvatar?.group.position.z ?? bossZ;
    // Same atan2(dx,dz) convention this codebase already uses for every other facing angle
    // (player/enemy movement, hex ramp rotation) - aims a cone/line telegraph the same direction
    // the server's own unitMatchesShape aims that shape's hit-test.
    const facing = Math.atan2(impactX - bossX, impactZ - bossZ);

    if (schema.castAbilityName) {
      const ability = stats.specialAbilities?.find((a) => a.name === schema.castAbilityName);
      if (!ability) return avatar.setTelegraph(false);
      const shape = ability.effect.shape;
      // A circle explicitly centered on the impact point renders there; every other shape
      // (including a caster-centered circle) is anchored on the boss itself, matching where
      // CombatEngine's own unitMatchesShape measures cone/line/caster-circle distances from.
      const atImpact = shape.kind === "circle" && shape.centeredOn === "impact";
      avatar.setTelegraph(true, atImpact ? impactX : bossX, atImpact ? impactZ : bossZ, shape, facing);
      return;
    }

    // The boss's own unnamed phase-2 splash attack (not a BossAbilityDef - see PendingEnemyCast's
    // doc comment server-side) - still a flat circle at the target, unchanged from before.
    if (stats.aoeRadius && targetAvatar) {
      avatar.setTelegraph(true, impactX, impactZ, { kind: "circle", radius: stats.aoeRadius, centeredOn: "impact" });
      return;
    }
    avatar.setTelegraph(false);
  }

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1);

    if (session.localSessionId) {
      const { moveX, moveZ } = input.getMovement();
      if (moveX !== 0 || moveZ !== 0) {
        // Mirrors CombatEngine.tickPlayerMovement's effective-speed calc exactly - see that
        // function's own comment for why prediction must match the server's math bit for bit.
        const speed = session.localPlayerSchema?.mounted ? PLAYER_SPEED * MOUNT_SPEED_MULTIPLIER : PLAYER_SPEED;
        let nextX = clamp(localPredicted.x + moveX * speed * dt, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
        let nextZ = clamp(localPredicted.z + moveZ * speed * dt, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
        // Mirrors CombatEngine.tickPlayerMovement's server-authoritative collision exactly (same
        // shared function/data) so prediction never drifts from the server and rubber-bands at
        // walls - STRUCTURES is skipped in a dungeon since it always holds the overworld's rows.
        if (!isDungeon) {
          const resolved = resolveStructureCollisions(nextX, nextZ, STRUCTURES);
          nextX = clamp(resolved.x, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);
          nextZ = clamp(resolved.z, -MAP_HALF_EXTENT, MAP_HALF_EXTENT);

          // Same story now for the overworld's hex terrain (see HexGround.ts/hex.ts) - water
          // blocks movement server-side too (CombatEngine's blockWaterTerrain), mirrored here so
          // prediction doesn't walk onto water for a tick before being corrected.
          if (!isHexPassable(nextX, nextZ)) {
            if (isHexPassable(nextX, localPredicted.z)) nextZ = localPredicted.z;
            else if (isHexPassable(localPredicted.x, nextZ)) nextX = localPredicted.x;
            else {
              nextX = localPredicted.x;
              nextZ = localPredicted.z;
            }
          }
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

      // The NPC dialogue panel (quests/vendor/trainer sections all live inside it - see
      // renderNpcDialogue) only ever opens while in range (openNpcDialogue's own check), but
      // nothing closed it again if the player then walked away mid-conversation - every actual
      // action inside it was already range-gated server-side regardless, this just keeps the UI
      // honest about it too.
      if (session.currentNpcDialogueId && !npcDialoguePanel.hidden) {
        const npc = NPCS[session.currentNpcDialogueId];
        if (npc && !isNearWorldPoint(npc.x, npc.z, NPC_INTERACT_RADIUS)) closeNpcDialogue(session);
      }

      const groundY = getTerrainHeight(localPredicted.x, localPredicted.z);

      const localAvatar = avatars.get(session.localSessionId);
      if (localAvatar) {
        localAvatar.setTarget(localPredicted.x, groundY, localPredicted.z, localRotationY);
        localAvatar.snapToTarget(dt, moveX !== 0 || moveZ !== 0);
      }
      syncActionFeedbackPosition(localPredicted.x, groundY, localPredicted.z);

      followTargetScratch.set(localPredicted.x, groundY, localPredicted.z);
      gameScene.followTarget(followTargetScratch);
      for (const avatar of structures) avatar.update(localPredicted.x, localPredicted.z, gameScene.nightFactor);
    }

    for (const [sessionId, avatar] of avatars) {
      if (sessionId === session.localSessionId) continue;
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

    if (session.localSessionId) {
      const selfDot = { x: localPredicted.x, z: localPredicted.z, rotationY: localRotationY };
      const questAreas = computeQuestAreaMarkers(session);
      const npcQuestStates = computeNpcQuestStates(session);
      minimap.update(selfDot, !isDungeon, questAreas, npcQuestStates);
      // Same per-frame data, just at a bigger radius - skip the extra canvas work while the
      // panel is closed instead of redrawing a map nobody can see.
      if (!bigMapPanel.hidden) bigMap.update(selfDot, !isDungeon, questAreas, npcQuestStates);

      const timeOfDayFraction = gameScene.timeOfDayFraction;
      minimapClockEl.hidden = timeOfDayFraction === undefined;
      if (timeOfDayFraction !== undefined) minimapClockEl.textContent = formatTimeOfDay(timeOfDayFraction);
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
      // An item-overridden slot shows the item's own static state (see renderSpellSlotOverrides)
      // instead of a spell cooldown sweep - skip the per-frame spell update entirely for it.
      if (spellSlotOverrides[i]) continue;

      const now = performance.now();
      const active = castPredictor.activeCastsFor(spellId, now);
      const max = castPredictor.maxChargesFor(spellId, localClassId, session.localPlayerSchema?.talentRanks);
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
