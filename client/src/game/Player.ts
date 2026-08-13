import * as THREE from "three";
import { ChatBubble } from "./ChatBubble";
import { HealthBar } from "./HealthBar";

const INTERPOLATION_LERP = 0.25;
const SELECTION_RING_COLOR = 0x6ee7ff;

export class PlayerAvatar {
  readonly group = new THREE.Group();
  readonly healthBar = new HealthBar();
  readonly chatBubble = new ChatBubble();
  private readonly selectionRing: THREE.Mesh;
  private targetPosition = new THREE.Vector3();
  private targetRotationY = 0;

  constructor(color: number) {
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.4, 0.9, 4, 8),
      new THREE.MeshStandardMaterial({ color }),
    );
    body.position.y = 0.85;
    this.group.add(body);

    const facing = new THREE.Mesh(
      new THREE.ConeGeometry(0.15, 0.35, 8),
      new THREE.MeshStandardMaterial({ color: 0xffffff }),
    );
    facing.rotation.x = Math.PI / 2;
    facing.position.set(0, 0.85, 0.55);
    this.group.add(facing);

    this.selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 0.75, 24),
      new THREE.MeshBasicMaterial({ color: SELECTION_RING_COLOR, side: THREE.DoubleSide }),
    );
    this.selectionRing.rotation.x = -Math.PI / 2;
    this.selectionRing.position.y = 0.02;
    this.selectionRing.visible = false;
    this.group.add(this.selectionRing);
  }

  setSelected(selected: boolean) {
    this.selectionRing.visible = selected;
  }

  setTarget(x: number, y: number, z: number, rotationY: number) {
    this.targetPosition.set(x, y, z);
    this.targetRotationY = rotationY;
  }

  setHp(hp: number, maxHp: number) {
    this.healthBar.setFraction(maxHp > 0 ? hp / maxHp : 0);
  }

  addTo(scene: THREE.Scene) {
    scene.add(this.group);
    scene.add(this.healthBar.group);
    scene.add(this.chatBubble.group);
    this.syncOverheadPositions();
  }

  removeFrom(scene: THREE.Scene) {
    scene.remove(this.group);
    scene.remove(this.healthBar.group);
    scene.remove(this.chatBubble.group);
  }

  snapToTarget() {
    this.group.position.copy(this.targetPosition);
    this.group.rotation.y = this.targetRotationY;
    this.syncOverheadPositions();
  }

  update() {
    this.group.position.lerp(this.targetPosition, INTERPOLATION_LERP);
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, this.targetRotationY, INTERPOLATION_LERP);
    this.syncOverheadPositions();
  }

  private syncOverheadPositions() {
    this.healthBar.setPosition(this.group.position.x, this.group.position.y, this.group.position.z);
    this.chatBubble.setPosition(this.group.position.x, this.group.position.y, this.group.position.z);
  }
}
