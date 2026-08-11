import * as THREE from "three";
import type { Room } from "colyseus.js";
import {
  CastMessage,
  ENEMY_STATS,
  EnemyKind,
  InputMessage,
  MAP_HALF_EXTENT,
  PLAYER_SPEED,
  SPELLS,
  SpellId,
} from "@mmo/shared";
import { GameScene } from "./game/Scene";
import { PlayerAvatar } from "./game/Player";
import { EnemyAvatar } from "./game/Enemy";
import { ProjectileAvatar } from "./game/Projectile";
import { InputController } from "./game/InputController";
import { connectToWorld } from "./network/connection";
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

makeDraggable(document.getElementById("player-panel")!, "player");
makeDraggable(document.getElementById("target-panel")!, "target");
makeDraggable(document.getElementById("spell-panel")!, "spells");

function hpColor(fraction: number): string {
  return fraction > 0.5 ? "#4fd166" : fraction > 0.25 ? "#e0b23c" : "#e0503c";
}

function updateHpBar(fillEl: HTMLElement, labelEl: HTMLElement, hp: number, maxHp: number) {
  const fraction = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
  fillEl.style.width = `${fraction * 100}%`;
  fillEl.style.background = hpColor(fraction);
  labelEl.textContent = `${Math.ceil(hp)}/${Math.ceil(maxHp)}`;
}

async function main() {
  const gameScene = new GameScene(container);
  const input = new InputController();

  const avatars = new Map<string, PlayerAvatar>();
  const enemies = new Map<string, EnemyAvatar>();
  const enemySchemaById = new Map<string, { kind: string; hp: number; maxHp: number; isCasting: boolean }>();
  const projectiles = new Map<string, ProjectileAvatar>();

  let room: Room | undefined;
  let localSessionId: string | null = null;
  let currentTargetId: string | null = null;

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

  window.addEventListener("keydown", (e) => {
    if (e.code === "Digit1") castSpell(1);
    else if (e.code === "Digit2") castSpell(2);
    else if (e.code === "Digit3") castSpell(3);
  });

  const raycaster = new THREE.Raycaster();
  gameScene.renderer.domElement.addEventListener("click", (event) => {
    const rect = gameScene.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, gameScene.camera);

    const enemyGroups = [...enemies.values()].map((avatar) => avatar.group);
    const hits = raycaster.intersectObjects(enemyGroups, true);

    if (hits.length === 0) {
      setTarget(null);
      return;
    }

    let obj: THREE.Object3D | null = hits[0].object;
    while (obj && !obj.userData.enemyId) obj = obj.parent;
    setTarget((obj?.userData.enemyId as string) ?? null);
  });

  try {
    const connection = await connectToWorld();
    room = connection.room;
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
      }

      $(player).onChange(() => {
        avatar.setHp(player.hp, player.maxHp);

        if (sessionId === localSessionId) {
          localServerPosition.set(player.x, player.y, player.z);
          localHp = player.hp;
          localMaxHp = player.maxHp;
          updateHpBar(playerHpFill, playerHpLabel, localHp, localMaxHp);

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

main();
