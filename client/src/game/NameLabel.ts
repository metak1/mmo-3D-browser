import * as THREE from "three";
import { CAMERA_PITCH } from "./Scene";

const FONT = "700 56px -apple-system, system-ui, sans-serif";
const SUBTITLE_FONT = "700 38px -apple-system, system-ui, sans-serif";
const SUBTITLE_COLOR = "#c9a63c"; // matches the XP bar/level badge's gold accent elsewhere in the HUD
const PADDING_X = 12;
const LINE_HEIGHT = 68;
const SUBTITLE_LINE_HEIGHT = 46;
const WORLD_UNITS_PER_CANVAS_PX = 1 / 240; // matches ChatBubble's scale so text reads at a consistent size

// subtitle (a player's guild tag, e.g. "<Ironclad>") renders as a smaller line above the name -
// undefined/omitted draws exactly the single centered line this always used to be, so an enemy's
// static name (the only caller with no subtitle) is pixel-for-pixel unchanged. `color` defaults to
// white (every existing caller's look, unchanged) - callers that want to stand out (e.g. a
// gathering node's name, in yellow) can override it.
function makeNameTexture(
  name: string,
  subtitle: string | undefined,
  color: string,
): { texture: THREE.CanvasTexture; width: number; height: number } {
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = FONT;
  let width = Math.ceil(measure.measureText(name).width);
  if (subtitle) {
    measure.font = SUBTITLE_FONT;
    width = Math.max(width, Math.ceil(measure.measureText(subtitle).width));
  }
  width += PADDING_X * 2;
  const height = subtitle ? LINE_HEIGHT + SUBTITLE_LINE_HEIGHT : LINE_HEIGHT;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 8;

  if (subtitle) {
    ctx.font = SUBTITLE_FONT;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
    ctx.strokeText(subtitle, width / 2, SUBTITLE_LINE_HEIGHT / 2 + 1);
    ctx.fillStyle = SUBTITLE_COLOR;
    ctx.fillText(subtitle, width / 2, SUBTITLE_LINE_HEIGHT / 2 + 1);
  }

  const nameY = (subtitle ? SUBTITLE_LINE_HEIGHT : 0) + LINE_HEIGHT / 2 + 1;
  ctx.font = FONT;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
  ctx.strokeText(name, width / 2, nameY);
  ctx.fillStyle = color;
  ctx.fillText(name, width / 2, nameY);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return { texture, width, height };
}

// A tilted plane, repositioned every frame (not parented - same reason as HealthBar, the avatar
// group yaws with movement and a child would inherit that). An enemy's name is drawn once at spawn
// and never touched again; a player's name/guild can change after spawn (see Player.ts's setName),
// so setText redraws only when the combined text actually differs, mirroring LevelBadge's own
// "static until told otherwise" diffing.
export class NameLabel {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly yOffset: number;
  private readonly color: string;
  private currentName: string;
  private currentSubtitle: string | undefined;

  constructor(name: string, yOffset: number, subtitle?: string, color = "#ffffff") {
    this.yOffset = yOffset;
    this.color = color;
    this.currentName = name;
    this.currentSubtitle = subtitle;
    this.material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.rotation.x = -CAMERA_PITCH;
    this.mesh.renderOrder = 10;
    this.group.add(this.mesh);
    this.redraw();
  }

  setText(name: string, subtitle?: string) {
    if (name === this.currentName && subtitle === this.currentSubtitle) return;
    this.currentName = name;
    this.currentSubtitle = subtitle;
    this.redraw();
  }

  private redraw() {
    const { texture, width, height } = makeNameTexture(this.currentName, this.currentSubtitle, this.color);
    this.material.map?.dispose();
    this.material.map = texture;
    this.material.needsUpdate = true;

    const worldWidth = width * WORLD_UNITS_PER_CANVAS_PX;
    const worldHeight = height * WORLD_UNITS_PER_CANVAS_PX;
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.PlaneGeometry(worldWidth, worldHeight);
    // The name line's own vertical center always stays exactly at yOffset (matches the original
    // always-single-line behavior pixel-for-pixel when there's no subtitle) - a subtitle line
    // grows the plane upward from there instead of shifting the name, so it never dips down into
    // the health bar below.
    this.mesh.position.y = this.currentSubtitle ? (SUBTITLE_LINE_HEIGHT / 2) * WORLD_UNITS_PER_CANVAS_PX : 0;
  }

  setPosition(x: number, y: number, z: number) {
    this.group.position.set(x, y + this.yOffset, z);
  }
}
