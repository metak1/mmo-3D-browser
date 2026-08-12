import * as THREE from "three";
import { CAMERA_PITCH } from "./Scene";

const NPC_COLOR = 0xf5d76e;

const INDICATOR_SIZE = 0.9;
const INDICATOR_Y_OFFSET = 2.25;
const COLOR_AVAILABLE = 0xffd200; // quest to offer - yellow "!"
const COLOR_ACTIVE = 0x9099ab; // quest in progress, not ready - grey "?"
const COLOR_READY = 0xffd200; // quest ready to turn in - yellow "?"

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

export type QuestIndicatorState = "none" | "available" | "active" | "ready";

export class NpcAvatar {
  readonly group = new THREE.Group();
  private readonly indicator: THREE.Mesh;
  private readonly indicatorMaterial: THREE.MeshBasicMaterial;

  constructor() {
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.4, 0.9, 4, 8),
      new THREE.MeshStandardMaterial({ color: NPC_COLOR }),
    );
    body.position.y = 0.85;
    this.group.add(body);

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

  setPosition(x: number, z: number) {
    this.group.position.set(x, 0, z);
  }

  addTo(scene: THREE.Scene) {
    scene.add(this.group);
  }

  removeFrom(scene: THREE.Scene) {
    scene.remove(this.group);
  }
}
