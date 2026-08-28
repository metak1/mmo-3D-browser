import * as THREE from "three";
import {
  FURNITURE,
  getTerrainHeight,
  PLAYER_SPEED,
  resolveFurnitureCollisions,
  resolveStructureCollisions,
  STRUCTURES,
} from "@mmo/shared";
import { CAMERA_PITCH } from "./Scene";
import { DEFAULT_Y_OFFSET as HEALTH_BAR_DEFAULT_Y_OFFSET } from "./HealthBar";
import { NameLabel } from "./NameLabel";
import { fitHeight, ModelAnimator, spawnRiggedModel, tintModel } from "./models";
import { identityTint } from "./textureTint";

const NPC_COLOR = 0xf5d76e;
// KayKit's Barbarian (kaylousberg.com, "Adventurers Character Pack" v2 export) - a generic
// townsperson stand-in from the same asset family the player classes use, replacing the earlier
// mismatched-style Quaternius man.glb. Like Player.ts's Ranger, this v2 model has no baked
// animations of its own - Idle_A/Walking_A are retargeted from the shared Rig_Medium library
// (see spawnRiggedModel).
const MODEL_PATH = "/models/npc_barbarian.glb";
const IDLE_SOURCE = { path: "/models/animations/Rig_Medium_General.glb", clip: "Idle_A" };
const WALK_SOURCE = { path: "/models/animations/Rig_Medium_MovementBasic.glb", clip: "Walking_A" };
// Matches the original CapsuleGeometry(0.4, 0.9) avatar this whole model system replaced
// (0.9 + 2*0.4 = 1.7).
const MODEL_HEIGHT = 1.7;

// NPCs have no health bar of their own (see NpcAvatar's own doc comment - no hp, no combat), so
// the name sits directly at HealthBar's default height instead of stacking a NAME_LABEL_GAP above
// a bar that doesn't exist here (contrast Enemy.ts/Player.ts, which both have a real bar below it).
const NAME_LABEL_Y_OFFSET = HEALTH_BAR_DEFAULT_Y_OFFSET;

const INDICATOR_SIZE = 0.9;
const INDICATOR_Y_OFFSET = 2.25;
const COLOR_AVAILABLE = 0xffd200; // quest to offer - yellow "!"
const COLOR_ACTIVE = 0x9099ab; // quest in progress, not ready - grey "?"
const COLOR_READY = 0xffd200; // quest ready to turn in - yellow "?"

const VENDOR_INDICATOR_SIZE = 0.65;
const VENDOR_INDICATOR_X_OFFSET = 0.55; // offset from the quest indicator so a future NPC could show both at once
const VENDOR_COLOR = 0x4fd166; // green "$", visually distinct from the yellow/grey quest states

const TRAINER_INDICATOR_SIZE = 0.65;
const TRAINER_INDICATOR_X_OFFSET = -0.55; // opposite side from the vendor indicator - so a future NPC could show quest+vendor+trainer all at once
const TRAINER_COLOR = 0x4ac0e8; // the existing "rare" blue accent, visually distinct from vendor green/quest yellow

// Client-only cosmetic wander for NPCs nobody has a reason to walk up to (see main.ts's `wander`
// computation: no quest, no vendor catalog) - purely visual life for a city, not synced state.
// NPC_QUEST_IDS/vendor interactions are all keyed by the NPC's authored home position (NPCS[id]),
// never by where its avatar is currently rendered, so a wandering NPC never breaks anything - it's
// just a good deal smaller/slower than an enemy's wander (NPCs are people milling around a plaza,
// not creatures patrolling territory) and each client runs its own independent, unsynced timer.
const NPC_WANDER_RADIUS = 3; // meters from home
const NPC_WANDER_TARGET_ATTEMPTS = 6; // see pickWanderTarget's own doc comment
const NPC_ROTATION_LERP = 0.15; // matches Enemy.ts's ROTATION_LERP
const NPC_WANDER_SPEED = 0.9; // meters/second
const NPC_WANDER_PAUSE_MS = 2000; // minimum pause between wander legs
const NPC_WANDER_PAUSE_JITTER_MS = 2500; // extra random pause on top of the minimum
// The Walk clip's authored pace looks right at PLAYER_SPEED (the only speed this shared man.glb
// model ever moved at before NPC wander existed) - a fixed ratio works here (unlike Enemy.ts's
// measured-per-tick approach) since NPC_WANDER_SPEED, unlike an enemy's, is the only speed an NPC
// ever moves at. Without this the legs would cycle through a full stride far faster than the body
// is actually covering ground at this much slower amble.
const NPC_WALK_ANIMATION_SPEED_SCALE = NPC_WANDER_SPEED / PLAYER_SPEED;

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
const TRAINER_TEXTURE = makeGlyphTexture("🎓");

export type QuestIndicatorState = "none" | "available" | "active" | "ready";

export class NpcAvatar {
  readonly group = new THREE.Group();
  readonly nameLabel: NameLabel;
  private readonly indicator: THREE.Mesh;
  private readonly indicatorMaterial: THREE.MeshBasicMaterial;
  private readonly vendorIndicator: THREE.Mesh;
  private readonly trainerIndicator: THREE.Mesh;
  private animator?: ModelAnimator;
  private homeX = 0;
  private homeZ = 0;
  private yOffset = 0;
  private wanderTarget: { x: number; z: number } | null = null;
  private wanderPauseUntil = 0;
  private currentRotationY = 0;

  constructor(name: string, private readonly wander = false) {
    this.nameLabel = new NameLabel(name, NAME_LABEL_Y_OFFSET);
    // Async-loaded (see models.ts) - same asset family as PlayerAvatar. Non-wandering NPCs are
    // spawned once from NPCS and never repositioned, so they stay on their Idle clip forever;
    // wandering ones (see the `wander` flag) toggle between Idle and Walk in tickWander below.
    spawnRiggedModel(MODEL_PATH, IDLE_SOURCE, WALK_SOURCE).then(({ object, animator }) => {
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

    // Independent of both the quest and vendor indicators (opposite side from vendor) - a
    // trainer's lesson is always available regardless of player state, same reasoning as vendor.
    this.trainerIndicator = new THREE.Mesh(
      new THREE.PlaneGeometry(TRAINER_INDICATOR_SIZE, TRAINER_INDICATOR_SIZE),
      new THREE.MeshBasicMaterial({ map: TRAINER_TEXTURE, color: TRAINER_COLOR, transparent: true, depthWrite: false }),
    );
    this.trainerIndicator.position.set(TRAINER_INDICATOR_X_OFFSET, INDICATOR_Y_OFFSET, 0);
    this.trainerIndicator.rotation.x = -CAMERA_PITCH;
    this.trainerIndicator.renderOrder = 10;
    this.trainerIndicator.visible = false;
    this.group.add(this.trainerIndicator);
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

  setTrainerIndicator(isTrainer: boolean) {
    this.trainerIndicator.visible = isTrainer;
  }

  setPosition(x: number, z: number, yOffset = 0) {
    this.homeX = x;
    this.homeZ = z;
    this.yOffset = yOffset;
    this.group.position.set(x, getTerrainHeight(x, z) + yOffset, z);
    this.syncOverlayPositions();
  }

  // Same reasoning as Enemy.ts's own syncOverlayPositions - the name label is a scene sibling, not
  // a child of this.group (see NameLabel's own doc comment: a child would inherit the group's yaw
  // and tilt out of billboard alignment whenever a wandering NPC turns), so it needs its own
  // explicit position sync wherever this.group's position changes.
  private syncOverlayPositions() {
    this.nameLabel.setPosition(this.group.position.x, this.group.position.y, this.group.position.z);
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
      this.wanderTarget = this.pickWanderTarget();
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

    // Turn smoothly toward the wander target instead of snapping straight to it every frame -
    // matches Enemy.ts's own atan2(sin,cos) shortest-path lerp (this used to just assign the raw
    // heading directly, which visibly snap-turned every time the target direction shifted, e.g.
    // right at the start of each new wander leg, or while sliding along an obstacle's edge).
    const desiredRotationY = Math.atan2(dx, dz);
    const delta = Math.atan2(Math.sin(desiredRotationY - this.currentRotationY), Math.cos(desiredRotationY - this.currentRotationY));
    this.currentRotationY += delta * NPC_ROTATION_LERP;
    this.group.rotation.y = this.currentRotationY;
    const step = Math.min(NPC_WANDER_SPEED * dt, dist);
    let nextX = this.group.position.x + (dx / dist) * step;
    let nextZ = this.group.position.z + (dz / dist) * step;
    ({ x: nextX, z: nextZ } = resolveStructureCollisions(nextX, nextZ, STRUCTURES));
    ({ x: nextX, z: nextZ } = resolveFurnitureCollisions(nextX, nextZ, FURNITURE));
    this.group.position.set(nextX, getTerrainHeight(nextX, nextZ) + this.yOffset, nextZ);
    this.syncOverlayPositions();
    this.animator?.setMoving(true, NPC_WALK_ANIMATION_SPEED_SCALE);
  }

  // This cosmetic wander used to aim straight through buildings/decoration with no collision
  // awareness at all - harmless when nothing in the scene actually blocked anything, but once
  // players/enemies started colliding with buildings and outdoor decoration (see shared's
  // BUILDING_FOOTPRINT/FURNITURE_FOOTPRINT) an NPC strolling straight through the same wall looked
  // obviously wrong. Mirrors CombatEngine.pickWanderTarget's retry-then-fall-back-home approach so
  // an NPC boxed in by decoration heads home instead of committing to an unreachable leg and
  // shuffling in place against the object every frame.
  private pickWanderTarget(): { x: number; z: number } {
    for (let attempt = 0; attempt < NPC_WANDER_TARGET_ATTEMPTS; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * NPC_WANDER_RADIUS;
      const x = this.homeX + Math.cos(angle) * radius;
      const z = this.homeZ + Math.sin(angle) * radius;
      if (!this.isPointBlocked(x, z)) return { x, z };
    }
    return { x: this.homeX, z: this.homeZ };
  }

  private isPointBlocked(x: number, z: number): boolean {
    const resolvedStructure = resolveStructureCollisions(x, z, STRUCTURES);
    if (Math.hypot(resolvedStructure.x - x, resolvedStructure.z - z) > 0.01) return true;
    const resolvedFurniture = resolveFurnitureCollisions(x, z, FURNITURE);
    return Math.hypot(resolvedFurniture.x - x, resolvedFurniture.z - z) > 0.01;
  }

  addTo(scene: THREE.Scene) {
    scene.add(this.group);
    scene.add(this.nameLabel.group);
    this.syncOverlayPositions();
  }

  removeFrom(scene: THREE.Scene) {
    scene.remove(this.group);
    scene.remove(this.nameLabel.group);
  }
}
