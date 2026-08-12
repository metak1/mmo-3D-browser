import * as THREE from "three";
import { CAMERA_PITCH } from "./Scene";

const WIDTH = 0.9;
const HEIGHT = 0.12;
const Y_OFFSET = 1.55;

const COLOR_HIGH = 0x4fd166;
const COLOR_MID = 0xe0b23c;
const COLOR_LOW = 0xe0503c;

// Not parented to the character mesh on purpose: the character group yaws to face
// its movement direction, and a child would inherit that yaw, rotating the bar out
// of alignment with the camera. Kept as a sibling in the scene and repositioned
// every frame instead (see setPosition).
export class HealthBar {
  readonly group = new THREE.Group();
  private readonly fill: THREE.Mesh;
  private readonly fillMaterial: THREE.MeshBasicMaterial;
  private readonly yOffset: number;

  constructor(yOffset = Y_OFFSET) {
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

  setFraction(fraction: number) {
    const clamped = Math.max(0, Math.min(1, fraction));
    this.fill.scale.x = clamped || 0.0001;
    this.fill.position.x = -(WIDTH * (1 - clamped)) / 2;
    this.fillMaterial.color.setHex(clamped > 0.5 ? COLOR_HIGH : clamped > 0.25 ? COLOR_MID : COLOR_LOW);
  }
}
