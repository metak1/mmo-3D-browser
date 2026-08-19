import * as THREE from "three";
import { CAMERA_PITCH } from "./Scene";

const FONT = "700 40px -apple-system, system-ui, sans-serif";
const CRIT_FONT = "700 56px -apple-system, system-ui, sans-serif";
const WORLD_UNITS_PER_CANVAS_PX = 1 / 240;
const Y_OFFSET = 2.1; // starts just above the health bar (HealthBar's own default is 1.55)
const RISE_DISTANCE = 1.4;
const LIFETIME_MS = 900;
const JITTER = 0.35; // small random x/z spread so simultaneous hits (AoE) don't fully overlap

function makeTextTexture(text: string, color: string, crit: boolean): { texture: THREE.CanvasTexture; width: number; height: number } {
  const font = crit ? CRIT_FONT : FONT;
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = font;
  const textWidth = measure.measureText(text).width;

  const padding = crit ? 16 : 10;
  const width = textWidth + padding * 2;
  const height = (crit ? 56 : 40) + padding * 2;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = crit ? 7 : 5;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
  ctx.strokeText(text, width / 2, height / 2);
  ctx.fillStyle = color;
  ctx.fillText(text, width / 2, height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return { texture, width, height };
}

interface ActiveEntry {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  baseY: number;
  ageMs: number;
}

// Same tilted-plane-with-canvas-texture technique as ChatBubble/HealthBar, but pooled/transient
// rather than one instance per avatar - a manager owning a flat list of short-lived meshes it
// spawns, rises, fades, and disposes on its own, since any number of hits can land in one tick.
export class FloatingCombatText {
  private readonly scene: THREE.Scene;
  private readonly active: ActiveEntry[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  spawn(x: number, y: number, z: number, text: string, color: string, crit: boolean) {
    const { texture, width, height } = makeTextTexture(text, color, crit);
    const worldWidth = width * WORLD_UNITS_PER_CANVAS_PX;
    const worldHeight = height * WORLD_UNITS_PER_CANVAS_PX;

    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(worldWidth, worldHeight), material);
    mesh.rotation.x = -CAMERA_PITCH;
    mesh.renderOrder = 12;
    const baseY = y + Y_OFFSET;
    mesh.position.set(x + (Math.random() - 0.5) * JITTER, baseY, z + (Math.random() - 0.5) * JITTER);

    this.scene.add(mesh);
    this.active.push({ mesh, material, baseY, ageMs: 0 });
  }

  update(dt: number) {
    if (this.active.length === 0) return;
    const dtMs = dt * 1000;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const entry = this.active[i];
      entry.ageMs += dtMs;
      const t = Math.min(entry.ageMs / LIFETIME_MS, 1);

      entry.mesh.position.y = entry.baseY + RISE_DISTANCE * t;
      entry.material.opacity = 1 - t * t;

      if (t >= 1) {
        this.scene.remove(entry.mesh);
        entry.mesh.geometry.dispose();
        entry.material.map?.dispose();
        entry.material.dispose();
        this.active.splice(i, 1);
      }
    }
  }
}
