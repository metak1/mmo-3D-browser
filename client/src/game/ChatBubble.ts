import * as THREE from "three";
import { CAMERA_PITCH } from "./Scene";

const FONT = "600 28px -apple-system, system-ui, sans-serif";
const PADDING_X = 18;
const PADDING_Y = 12;
const LINE_HEIGHT = 34;
const MAX_TEXT_WIDTH = 320; // canvas px available for wrapped text before forcing a line break
const MAX_LINES = 3;
const WORLD_UNITS_PER_CANVAS_PX = 1 / 240;
const Y_OFFSET = 1.95; // anchors the bubble's bottom edge above the avatar's head/health bar
const HIDE_MS = 5000;

function wrapLines(ctx: CanvasRenderingContext2D, text: string): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(candidate).width > MAX_TEXT_WIDTH) {
      lines.push(current);
      current = word;
      if (lines.length === MAX_LINES) break;
    } else {
      current = candidate;
    }
  }
  if (current && lines.length < MAX_LINES) lines.push(current);
  return lines;
}

function makeBubbleTexture(text: string): { texture: THREE.CanvasTexture; width: number; height: number } {
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = FONT;
  const lines = wrapLines(measure, text);

  const width = Math.min(MAX_TEXT_WIDTH, Math.max(...lines.map((l) => measure.measureText(l).width))) + PADDING_X * 2;
  const height = lines.length * LINE_HEIGHT + PADDING_Y * 2;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.font = FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillStyle = "rgba(15, 17, 23, 0.82)";
  ctx.beginPath();
  ctx.roundRect(0, 0, width, height, 10);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  lines.forEach((line, i) => {
    ctx.fillText(line, width / 2, PADDING_Y + LINE_HEIGHT * i + LINE_HEIGHT / 2);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return { texture, width, height };
}

// Mirrors HealthBar/NpcAvatar's tilted-plane-with-canvas-texture pattern, generalized from a
// fixed glyph to arbitrary wrapped text. Kept as a sibling in the scene (not parented, same
// reason as HealthBar - the avatar group yaws with movement) and repositioned every frame.
export class ChatBubble {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshBasicMaterial;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.01, 0.01), this.material);
    this.mesh.rotation.x = -CAMERA_PITCH;
    this.mesh.renderOrder = 11;
    this.mesh.visible = false;
    this.group.add(this.mesh);
  }

  show(text: string) {
    const { texture, width, height } = makeBubbleTexture(text);
    this.material.map?.dispose();
    this.material.map = texture;
    this.material.needsUpdate = true;

    const worldWidth = width * WORLD_UNITS_PER_CANVAS_PX;
    const worldHeight = height * WORLD_UNITS_PER_CANVAS_PX;
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.PlaneGeometry(worldWidth, worldHeight);
    this.mesh.position.y = worldHeight / 2; // grows upward from the group's anchor point
    this.mesh.visible = true;

    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this.mesh.visible = false;
    }, HIDE_MS);
  }

  setPosition(x: number, y: number, z: number) {
    this.group.position.set(x, y + Y_OFFSET, z);
  }
}
