import * as THREE from "three";
import { CAMERA_PITCH } from "./Scene";

export const WIDTH = 1.0;
const HEIGHT = 0.15;
export const DEFAULT_Y_OFFSET = 1.75;

const COLOR_HIGH = 0x4fd166;
const COLOR_MID = 0xe0b23c;
const COLOR_LOW = 0xe0503c;

// Reused by setTypeColor - enemy bars trade the usual HP-fraction gradient for a fixed
// passive/aggressive cue instead (see EnemyAvatar's constructor), reusing the same red/yellow
// already meaningful elsewhere (low HP / mid HP) so the palette stays consistent.
const COLOR_PASSIVE = COLOR_MID; // yellow - won't engage until attacked
const COLOR_AGGRESSIVE = COLOR_LOW; // red - auto-engages within its aggroRange

// Not parented to the character mesh on purpose: the character group yaws to face
// its movement direction, and a child would inherit that yaw, rotating the bar out
// of alignment with the camera. Kept as a sibling in the scene and repositioned
// every frame instead (see setPosition).
export class HealthBar {
  readonly group = new THREE.Group();
  private readonly fill: THREE.Mesh;
  private readonly fillMaterial: THREE.MeshBasicMaterial;
  private readonly yOffset: number;

  constructor(yOffset = DEFAULT_Y_OFFSET) {
    this.yOffset = yOffset;

    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(WIDTH, HEIGHT),
      new THREE.MeshBasicMaterial({ color: 0x1a1c24 }),
    );
    this.group.add(bg);

    this.fillMaterial = new THREE.MeshBasicMaterial({ color: COLOR_HIGH });
    this.fill = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH, HEIGHT), this.fillMaterial);
    this.fill.position.z = 0.001;
    this.group.add(this.fill);

    this.group.rotation.x = -CAMERA_PITCH;
    this.group.renderOrder = 10;
  }

  setPosition(x: number, y: number, z: number) {
    this.group.position.set(x, y + this.yOffset, z);
  }

  // `colorByFraction` lets enemy avatars skip the HP-fraction gradient - their bar's color is
  // fixed at spawn instead, via setTypeColor (still calling this every HP change, for the width).
  setFraction(fraction: number, colorByFraction = true) {
    const clamped = Math.max(0, Math.min(1, fraction));
    this.fill.scale.x = clamped || 0.0001;
    this.fill.position.x = -(WIDTH * (1 - clamped)) / 2;
    if (colorByFraction) {
      this.fillMaterial.color.setHex(clamped > 0.5 ? COLOR_HIGH : clamped > 0.25 ? COLOR_MID : COLOR_LOW);
    }
  }

  // A fixed per-enemy-type cue, not a dynamic one - set once at spawn (see EnemyAvatar's
  // constructor) and never touched again, since setFraction never overwrites the color when
  // colorByFraction is false.
  setTypeColor(aggressive: boolean) {
    this.fillMaterial.color.setHex(aggressive ? COLOR_AGGRESSIVE : COLOR_PASSIVE);
  }
}
