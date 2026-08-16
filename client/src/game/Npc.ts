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

  constructor() {
    // Async-loaded (see models.ts) - same shared model as PlayerAvatar, just never told to
    // walk (NPCs are static, spawned once from NPCS and never repositioned), so it stays on
    // its Idle clip forever.
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
    this.group.position.set(x, getTerrainHeight(x, z) + yOffset, z);
  }

  // NPCs never move, so this exists purely to keep the Idle clip's mixer advancing.
  update(dt: number) {
    this.animator?.update(dt);
  }

  addTo(scene: THREE.Scene) {
    scene.add(this.group);
  }

  removeFrom(scene: THREE.Scene) {
    scene.remove(this.group);
  }
}
