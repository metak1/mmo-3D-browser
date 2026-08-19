import * as THREE from "three";
import { CAMERA_PITCH } from "./Scene";

const FONT = "600 32px -apple-system, system-ui, sans-serif";
const PADDING_X = 8;
const HEIGHT = 40;
const WORLD_UNITS_PER_CANVAS_PX = 1 / 240; // matches ChatBubble's scale so text reads at a consistent size

function makeNameTexture(text: string): { texture: THREE.CanvasTexture; width: number; height: number } {
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = FONT;
  const width = Math.ceil(measure.measureText(text).width) + PADDING_X * 2;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d")!;
  ctx.font = FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 5;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
  ctx.strokeText(text, width / 2, HEIGHT / 2 + 1);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, width / 2, HEIGHT / 2 + 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return { texture, width, height: HEIGHT };
}

// A static tilted plane, drawn once (matching HealthBar/NpcAvatar's approach) - an enemy's name
// never changes after spawn, so there's no need for ChatBubble's dynamic re-wrap/timeout
// machinery. Kept as a sibling in the scene (not parented, same reason as HealthBar - the
// avatar group yaws with movement) and repositioned every frame.
export class NameLabel {
  readonly group = new THREE.Group();
  private readonly yOffset: number;

  constructor(text: string, yOffset: number) {
    this.yOffset = yOffset;
    const { texture, width, height } = makeNameTexture(text);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width * WORLD_UNITS_PER_CANVAS_PX, height * WORLD_UNITS_PER_CANVAS_PX),
      material,
    );
    mesh.rotation.x = -CAMERA_PITCH;
    mesh.renderOrder = 10;
    this.group.add(mesh);
  }

  setPosition(x: number, y: number, z: number) {
    this.group.position.set(x, y + this.yOffset, z);
  }
}
