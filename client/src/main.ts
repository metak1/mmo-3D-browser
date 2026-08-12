import * as THREE from "three";
import type { Room } from "colyseus.js";
import {
  CastMessage,
  CLASSES,
  ClassId,
  ENEMY_STATS,
  EnemyKind,
  EquipMessage,
  EquipSlot,
  InputMessage,
  INVENTORY_SIZE,
  ITEMS,
  LootTakeMessage,
  MAP_HALF_EXTENT,
  PLAYER_SPEED,
  PlayerStats,
  RARITY_COLOR,
  RARITY_MULTIPLIER,
  SPELLS,
  SpellId,
  SpendTalentMessage,
  TALENTS,
  UnequipMessage,
  decodeItemToken,
  getEffectiveStats,
  xpForNextLevel,
} from "@mmo/shared";
import { GameScene } from "./game/Scene";
import { PlayerAvatar } from "./game/Player";
import { EnemyAvatar } from "./game/Enemy";
import { ProjectileAvatar } from "./game/Projectile";
import { LootBagAvatar } from "./game/LootBagAvatar";
import { InputController } from "./game/InputController";
import { connectToWorld } from "./network/connection";
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
const SPELL_IDS: SpellId[] = [1, 2, 3];

const hud = document.getElementById("hud")!;
const container = document.getElementById("app")!;

const playerHpFill = document.querySelector<HTMLElement>("[data-player-hp-fill]")!;
const playerHpLabel = document.querySelector<HTMLElement>("[data-player-hp-label]")!;
const playerCastBarEl = document.querySelector<HTMLElement>("[data-player-cast-bar]")!;
const playerCastFill = document.querySelector<HTMLElement>("[data-player-cast-fill]")!;
const playerCastLabel = document.querySelector<HTMLElement>("[data-player-cast-label]")!;

const targetPanel = document.getElementById("target-panel")!;
const targetNameEl = document.querySelector<HTMLElement>("[data-target-name]")!;
const targetHpFill = document.querySelector<HTMLElement>("[data-target-hp-fill]")!;
const targetHpLabel = document.querySelector<HTMLElement>("[data-target-hp-label]")!;
const targetCastBarEl = document.querySelector<HTMLElement>("[data-target-cast-bar]")!;
const targetCastFill = document.querySelector<HTMLElement>("[data-target-cast-fill]")!;

const playerLevelEl = document.querySelector<HTMLElement>("[data-player-level]")!;
const playerClassEl = document.querySelector<HTMLElement>("[data-player-class]")!;
const characterClassEl = document.querySelector<HTMLElement>("[data-character-class]")!;
const xpFill = document.querySelector<HTMLElement>("[data-xp-fill]")!;
const xpLabel = document.querySelector<HTMLElement>("[data-xp-label]")!;
const statEls = {
  strength: document.querySelector<HTMLElement>("[data-stat-strength]")!,
  dexterity: document.querySelector<HTMLElement>("[data-stat-dexterity]")!,
  intellect: document.querySelector<HTMLElement>("[data-stat-intellect]")!,
  vitality: document.querySelector<HTMLElement>("[data-stat-vitality]")!,
  luck: document.querySelector<HTMLElement>("[data-stat-luck]")!,
  armor: document.querySelector<HTMLElement>("[data-stat-armor]")!,
};

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

const itemTooltipEl = document.getElementById("item-tooltip")!;
const itemTooltipNameEl = document.querySelector<HTMLElement>("[data-tooltip-name]")!;
const itemTooltipSlotEl = document.querySelector<HTMLElement>("[data-tooltip-slot]")!;
const itemTooltipStatsEl = document.querySelector<HTMLElement>("[data-tooltip-stats]")!;
const itemTooltipDescEl = document.querySelector<HTMLElement>("[data-tooltip-desc]")!;

const STAT_LABELS: Record<keyof PlayerStats, string> = {
  strength: "Strength",
  dexterity: "Dexterity",
  intellect: "Intellect",
  vitality: "Vitality",
  luck: "Luck",
  armor: "Armor",
};

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
    .map(([stat, value]) => `<span>+${Math.round((value ?? 0) * multiplier)} ${STAT_LABELS[stat as keyof PlayerStats]}</span>`)
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
  strength: number;
  dexterity: number;
  intellect: number;
  vitality: number;
  luck: number;
  armor: number;
  equippedWeapon: string;
  equippedArmor: string;
  equippedTrinket: string;
  inventory: Iterable<string>;
  talentPoints: number;
  talentRanks: Iterable<[string, number]>;
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
      strength: player.strength,
      dexterity: player.dexterity,
      intellect: player.intellect,
      vitality: player.vitality,
      luck: player.luck,
      armor: player.armor,
    },
    { weapon: player.equippedWeapon, armor: player.equippedArmor, trinket: player.equippedTrinket },
  );

  statEls.strength.textContent = `${effective.strength}`;
  statEls.dexterity.textContent = `${effective.dexterity}`;
  statEls.intellect.textContent = `${effective.intellect}`;
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

async function main(token: string, characterId: number) {
  const gameScene = new GameScene(container);
  const input = new InputController();

  const avatars = new Map<string, PlayerAvatar>();
  const enemies = new Map<string, EnemyAvatar>();
  const enemySchemaById = new Map<string, { kind: string; hp: number; maxHp: number; isCasting: boolean }>();
  const projectiles = new Map<string, ProjectileAvatar>();
  const lootBags = new Map<string, LootBagAvatar>();
  const lootBagSchemaById = new Map<string, { x: number; z: number; items: Iterable<string> }>();

  let room: Room | undefined;
  let localSessionId: string | null = null;
  let currentTargetId: string | null = null;
  let currentLootBagId: string | null = null;

  let localHp = 0;
  let localMaxHp = 0;
  let localCastSpellId = 0;
  let localCastActive = false;
  let localCastStartRef = 0;

  let targetCastActive = false;
  let targetCastStartRef = 0;

  const localPredicted = new THREE.Vector3(0, 0, 0);
  const localServerPosition = new THREE.Vector3(0, 0, 0);
  let localRotationY = 0;
  let seq = 0;

  const lastClientCastAt = new Map<SpellId, number>();
  const cooldownEls = new Map<SpellId, HTMLElement>();
  for (const spellId of SPELL_IDS) {
    const nameEl = document.querySelector(`[data-name="${spellId}"]`);
    if (nameEl) nameEl.textContent = SPELLS[spellId].name;
    const cooldownEl = document.querySelector(`[data-cooldown="${spellId}"]`) as HTMLElement | null;
    if (cooldownEl) cooldownEls.set(spellId, cooldownEl);
  }

  function updateHud() {
    if (!localSessionId) return;
    hud.textContent = `Connected as ${localSessionId}`;
  }

  function setTarget(id: string | null) {
    if (currentTargetId) enemies.get(currentTargetId)?.setSelected(false);
    currentTargetId = id;
    targetCastActive = false;
    targetCastBarEl.hidden = true;

    if (!id) {
      targetPanel.hidden = true;
      return;
    }

    enemies.get(id)?.setSelected(true);
    targetPanel.hidden = false;

    const schema = enemySchemaById.get(id);
    if (!schema) return;

    targetNameEl.textContent = schema.kind === "melee" ? "Melee Enemy" : "Caster Enemy";
    updateHpBar(targetHpFill, targetHpLabel, schema.hp, schema.maxHp);

    if (schema.isCasting) {
      targetCastActive = true;
      targetCastStartRef = performance.now();
      targetCastBarEl.hidden = false;
    }
  }

  function castSpell(spellId: SpellId) {
    if (!room || !currentTargetId) return;
    const spell = SPELLS[spellId];
    const now = performance.now();
    const last = lastClientCastAt.get(spellId) ?? -Infinity;
    if (now - last < spell.cooldownMs) return;

    lastClientCastAt.set(spellId, now);
    const message: CastMessage = { spellId, targetId: currentTargetId };
    room.send("cast", message);
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

  const characterPanel = document.getElementById("character-panel")!;

  window.addEventListener("keydown", (e) => {
    if (e.code === "Digit1") castSpell(1);
    else if (e.code === "Digit2") castSpell(2);
    else if (e.code === "Digit3") castSpell(3);
    else if (e.code === "KeyP") characterPanel.hidden = !characterPanel.hidden;
    else if (e.code === "KeyI") inventoryPanel.hidden = !inventoryPanel.hidden;
    else if (e.code === "KeyK") talentPanel.hidden = !talentPanel.hidden;
  });

  const raycaster = new THREE.Raycaster();
  gameScene.renderer.domElement.addEventListener("click", (event) => {
    const rect = gameScene.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, gameScene.camera);

    const clickable = [
      ...[...enemies.values()].map((avatar) => avatar.group),
      ...[...lootBags.values()].map((avatar) => avatar.group),
    ];
    const hits = raycaster.intersectObjects(clickable, true);

    if (hits.length === 0) {
      setTarget(null);
      return;
    }

    let obj: THREE.Object3D | null = hits[0].object;
    while (obj && !obj.userData.enemyId && !obj.userData.bagId) obj = obj.parent;

    if (obj?.userData.bagId) {
      openLootWindow(obj.userData.bagId as string);
      return;
    }

    setTarget((obj?.userData.enemyId as string) ?? null);
  });

  try {
    const connection = await connectToWorld(token, characterId);
    room = connection.room;
    activeRoom = room;
    const $ = connection.$;
    localSessionId = room.sessionId;

    $(room.state).players.onAdd((player, sessionId) => {
      const avatar = new PlayerAvatar(sessionId === localSessionId ? LOCAL_COLOR : REMOTE_COLOR);
      avatar.setTarget(player.x, player.y, player.z, player.rotationY);
      avatar.snapToTarget();
      avatar.setHp(player.hp, player.maxHp);
      avatar.addTo(gameScene.scene);
      avatars.set(sessionId, avatar);

      if (sessionId === localSessionId) {
        localHp = player.hp;
        localMaxHp = player.maxHp;
        updateHud();
        updateHpBar(playerHpFill, playerHpLabel, localHp, localMaxHp);
        updateCharacterPanel(player);
      }

      $(player).onChange(() => {
        avatar.setHp(player.hp, player.maxHp);

        if (sessionId === localSessionId) {
          localServerPosition.set(player.x, player.y, player.z);
          localHp = player.hp;
          localMaxHp = player.maxHp;
          updateHpBar(playerHpFill, playerHpLabel, localHp, localMaxHp);
          updateCharacterPanel(player);

          if (player.castSpellId !== localCastSpellId) {
            localCastSpellId = player.castSpellId;
            if (localCastSpellId !== 0) {
              localCastActive = true;
              localCastStartRef = performance.now();
              playerCastLabel.textContent = SPELLS[localCastSpellId as SpellId].name;
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

    if (localCastActive && localCastSpellId !== 0) {
      const durationMs = SPELLS[localCastSpellId as SpellId].castTimeMs;
      const fraction = Math.max(0, Math.min(1, (performance.now() - localCastStartRef) / durationMs));
      playerCastFill.style.width = `${fraction * 100}%`;
    }

    if (targetCastActive) {
      const fraction = Math.max(0, Math.min(1, (performance.now() - targetCastStartRef) / ENEMY_STATS.caster.castTimeMs));
      targetCastFill.style.width = `${fraction * 100}%`;
    }

    for (const spellId of SPELL_IDS) {
      const el = cooldownEls.get(spellId);
      if (!el) continue;
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
