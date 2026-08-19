import * as THREE from "three";
import { getTerrainHeight } from "@mmo/shared";
import { CAMERA_PITCH } from "./Scene";
import { fitHeight, ModelAnimator, spawnModel, tintModel } from "./models";
import { identityTint } from "./textureTint";

const NPC_COLOR = 0xf5d76e;
const MODEL_PATH = "/models/man.glb";
const MODEL_CLIPS = { idle: "HumanArmature|Man_Idle", walk: "HumanArmature|Man_Walk" };
// Matches the original CapsuleGeometry(0.4, 0.9) avatar this whole model system replaced
// (0.9 + 2*0.4 = 1.7) - man.glb's own native height (~4.8) was never scaled down to this until
// now, which is why NPCs (and, until the class-model change, players) rendered nearly as tall as
// the map's houses.
const MODEL_HEIGHT = 1.7;

const INDICATOR_SIZE = 0.9;
const INDICATOR_Y_OFFSET = 2.25;
const COLOR_AVAILABLE = 0xffd200; // quest to offer - yellow "!"
const COLOR_ACTIVE = 0x9099ab; // quest in progress, not ready - grey "?"
const COLOR_READY = 0xffd200; // quest ready to turn in - yellow "?"

const VENDOR_INDICATOR_SIZE = 0.65;
const VENDOR_INDICATOR_X_OFFSET = 0.55; // offset from the quest indicator so a future NPC could show both at once
const VENDOR_COLOR = 0x4fd166; // green "$", visually distinct from the yellow/grey quest states

// Client-only cosmetic wander for NPCs nobody has a reason to walk up to (see main.ts's `wander`
// computation: no quest, no vendor catalog) - purely visual life for a city, not synced state.
// NPC_QUEST_IDS/vendor interactions are all keyed by the NPC's authored home position (NPCS[id]),
// never by where its avatar is currently rendered, so a wandering NPC never breaks anything - it's
// just a good deal smaller/slower than an enemy's wander (NPCs are people milling around a plaza,
// not creatures patrolling territory) and each client runs its own independent, unsynced timer.
const NPC_WANDER_RADIUS = 3; // meters from home
const NPC_WANDER_SPEED = 0.9; // meters/second
const NPC_WANDER_PAUSE_MS = 2000; // minimum pause between wander legs
const NPC_WANDER_PAUSE_JITTER_MS = 2500; // extra random pause on top of the minimum

// Drawn once and reused across every NpcAvatar instance - only the plane's material color
// changes per-instance, not the glyph texture itself.
function makeGlyphTexture(glyph: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "bold 52px -apple-system, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 5;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
  ctx.strokeText(glyph, 32, 34);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(glyph, 32, 34);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

const EXCLAMATION_TEXTURE = makeGlyphTexture("!");
const QUESTION_TEXTURE = makeGlyphTexture("?");
const DOLLAR_TEXTURE = makeGlyphTexture("$");

export type QuestIndicatorState = "none" | "available" | "active" | "ready";

export class NpcAvatar {
  readonly group = new THREE.Group();
  private readonly indicator: THREE.Mesh;
  private readonly indicatorMaterial: THREE.MeshBasicMaterial;
  private readonly vendorIndicator: THREE.Mesh;
  private animator?: ModelAnimator;
  private homeX = 0;
  private homeZ = 0;
  private yOffset = 0;
  private wanderTarget: { x: number; z: number } | null = null;
  private wanderPauseUntil = 0;

  constructor(private readonly wander = false) {
    // Async-loaded (see models.ts) - same shared model as PlayerAvatar. Non-wandering NPCs are
    // spawned once from NPCS and never repositioned, so they stay on their Idle clip forever;
    // wandering ones (see the `wander` flag) toggle between Idle and Walk in tickWander below.
    spawnModel(MODEL_PATH, MODEL_CLIPS).then(({ object, animator }) => {
      fitHeight(object, MODEL_HEIGHT);
      tintModel(object, identityTint(NPC_COLOR));
      this.group.add(object);
      this.animator = animator;
    });

    // A static tilted plane (matching HealthBar's approach) rather than a THREE.Sprite,
    // since the camera's pitch never changes - no per-frame billboarding needed.
    this.indicatorMaterial = new THREE.MeshBasicMaterial({
      map: EXCLAMATION_TEXTURE,
      transparent: true,
      depthWrite: false,
    });
    this.indicator = new THREE.Mesh(new THREE.PlaneGeometry(INDICATOR_SIZE, INDICATOR_SIZE), this.indicatorMaterial);
    this.indicator.position.y = INDICATOR_Y_OFFSET;
    this.indicator.rotation.x = -CAMERA_PITCH;
    this.indicator.renderOrder = 10;
    this.indicator.visible = false;
    this.group.add(this.indicator);

    // Independent of the quest indicator (offset to the side) - a vendor's shop is always
    // open regardless of player state, unlike the quest "!"/"?" which reacts to progress.
    this.vendorIndicator = new THREE.Mesh(
      new THREE.PlaneGeometry(VENDOR_INDICATOR_SIZE, VENDOR_INDICATOR_SIZE),
      new THREE.MeshBasicMaterial({ map: DOLLAR_TEXTURE, color: VENDOR_COLOR, transparent: true, depthWrite: false }),
    );
    this.vendorIndicator.position.set(VENDOR_INDICATOR_X_OFFSET, INDICATOR_Y_OFFSET, 0);
    this.vendorIndicator.rotation.x = -CAMERA_PITCH;
    this.vendorIndicator.renderOrder = 10;
    this.vendorIndicator.visible = false;
    this.group.add(this.vendorIndicator);
  }

  setQuestIndicator(state: QuestIndicatorState) {
    if (state === "none") {
      this.indicator.visible = false;
      return;
    }

    this.indicator.visible = true;
    if (state === "available") {
      this.indicatorMaterial.map = EXCLAMATION_TEXTURE;
      this.indicatorMaterial.color.setHex(COLOR_AVAILABLE);
    } else if (state === "ready") {
      this.indicatorMaterial.map = QUESTION_TEXTURE;
      this.indicatorMaterial.color.setHex(COLOR_READY);
    } else {
      this.indicatorMaterial.map = QUESTION_TEXTURE;
      this.indicatorMaterial.color.setHex(COLOR_ACTIVE);
    }
    this.indicatorMaterial.needsUpdate = true;
  }

  setVendorIndicator(isVendor: boolean) {
    this.vendorIndicator.visible = isVendor;
  }

  setPosition(x: number, z: number, yOffset = 0) {
    this.homeX = x;
    this.homeZ = z;
    this.yOffset = yOffset;
    this.group.position.set(x, getTerrainHeight(x, z) + yOffset, z);
  }

  // Non-wandering NPCs never move, so this exists purely to keep the Idle clip's mixer
  // advancing; wandering ones also step toward/pause at a randomized point near home each frame.
  update(dt: number) {
    if (this.wander) this.tickWander(dt);
    this.animator?.update(dt);
  }

  private tickWander(dt: number) {
    const now = performance.now();

    if (!this.wanderTarget) {
      if (now < this.wanderPauseUntil) return;
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * NPC_WANDER_RADIUS;
      this.wanderTarget = { x: this.homeX + Math.cos(angle) * radius, z: this.homeZ + Math.sin(angle) * radius };
    }

    const dx = this.wanderTarget.x - this.group.position.x;
    const dz = this.wanderTarget.z - this.group.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.1) {
      this.wanderTarget = null;
      this.wanderPauseUntil = now + NPC_WANDER_PAUSE_MS + Math.random() * NPC_WANDER_PAUSE_JITTER_MS;
      this.animator?.setMoving(false);
      return;
    }

    this.group.rotation.y = Math.atan2(dx, dz);
    const step = Math.min(NPC_WANDER_SPEED * dt, dist);
    const nextX = this.group.position.x + (dx / dist) * step;
    const nextZ = this.group.position.z + (dz / dist) * step;
    this.group.position.set(nextX, getTerrainHeight(nextX, nextZ) + this.yOffset, nextZ);
    this.animator?.setMoving(true);
  }

  addTo(scene: THREE.Scene) {
    scene.add(this.group);
  }

  removeFrom(scene: THREE.Scene) {
    scene.remove(this.group);
  }
}
