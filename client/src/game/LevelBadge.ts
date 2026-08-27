import * as THREE from "three";
import { CAMERA_PITCH } from "./Scene";
import { WIDTH as HEALTH_BAR_WIDTH } from "./HealthBar";

const SIZE_PX = 64; // canvas resolution, square
const WORLD_UNITS_PER_CANVAS_PX = 1 / 240; // matches ChatBubble/NameLabel's scale so text reads at a consistent size
const GAP = 0.06; // world units of clearance between the health bar's left edge and the badge

function makeLevelTexture(level: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE_PX;
  canvas.height = SIZE_PX;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "rgba(15, 17, 23, 0.85)";
  ctx.beginPath();
  ctx.roundRect(1, 1, SIZE_PX - 2, SIZE_PX - 2, 6);
  ctx.fill();
  ctx.strokeStyle = "#4a5578";
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.font = "700 32px -apple-system, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff6d5";
  ctx.fillText(String(level), SIZE_PX / 2, SIZE_PX / 2 + 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

// A small square badge showing a player's level, sitting just left of their health bar (see
// HealthBar's own WIDTH, imported here so the two never drift apart if one's size changes without
// the other). Only players carry a level at all (see EnemyTypeDef - enemies have no per-instance
// level field), so this is Player.ts-only, unlike HealthBar/NameLabel which both classes share.
// Redraws its texture only when the level actually changes (setLevel), same "static until told
// otherwise" approach NameLabel uses for a name.
export class LevelBadge {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly yOffset: number;
  private currentLevel: number | null = null;

  constructor(healthBarYOffset: number) {
    this.yOffset = healthBarYOffset; // vertically centered on the health bar, not above it
    this.material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    const worldSize = SIZE_PX * WORLD_UNITS_PER_CANVAS_PX;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(worldSize, worldSize), this.material);
    this.mesh.position.x = -(HEALTH_BAR_WIDTH / 2 + GAP + worldSize / 2);
    this.mesh.rotation.x = -CAMERA_PITCH;
    this.mesh.renderOrder = 10;
    this.group.add(this.mesh);
  }

  setLevel(level: number) {
    if (level === this.currentLevel) return;
    this.currentLevel = level;
    this.material.map?.dispose();
    this.material.map = makeLevelTexture(level);
    this.material.needsUpdate = true;
  }

  setPosition(x: number, y: number, z: number) {
    this.group.position.set(x, y + this.yOffset, z);
  }
}
