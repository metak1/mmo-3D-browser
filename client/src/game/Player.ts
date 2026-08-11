import * as THREE from "three";
import { HealthBar } from "./HealthBar";

const INTERPOLATION_LERP = 0.25;

export class PlayerAvatar {
  readonly group = new THREE.Group();
  readonly healthBar = new HealthBar();
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
    this.syncHealthBarPosition();
  }

  removeFrom(scene: THREE.Scene) {
    scene.remove(this.group);
    scene.remove(this.healthBar.group);
  }

  snapToTarget() {
    this.group.position.copy(this.targetPosition);
    this.group.rotation.y = this.targetRotationY;
    this.syncHealthBarPosition();
  }

  update() {
    this.group.position.lerp(this.targetPosition, INTERPOLATION_LERP);
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, this.targetRotationY, INTERPOLATION_LERP);
    this.syncHealthBarPosition();
  }

  private syncHealthBarPosition() {
    this.healthBar.setPosition(this.group.position.x, this.group.position.y, this.group.position.z);
  }
}
