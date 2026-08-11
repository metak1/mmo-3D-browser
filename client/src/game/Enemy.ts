import * as THREE from "three";
import { EnemyKind } from "@mmo/shared";
import { HealthBar } from "./HealthBar";

const INTERPOLATION_LERP = 0.25;

const KIND_COLOR: Record<EnemyKind, number> = {
  melee: 0xb3423a,
  caster: 0x8a4fd1,
};

const SELECTION_RING_COLOR = 0xf5d76e;

export class EnemyAvatar {
  readonly group = new THREE.Group();
  readonly healthBar = new HealthBar();
  private readonly selectionRing: THREE.Mesh;
  private targetPosition = new THREE.Vector3();

  constructor(kind: EnemyKind) {
    const color = KIND_COLOR[kind];
    const bodyGeometry: THREE.BufferGeometry =
      kind === "melee" ? new THREE.BoxGeometry(0.8, 1.1, 0.8) : new THREE.OctahedronGeometry(0.6, 0);
    const body = new THREE.Mesh(bodyGeometry, new THREE.MeshStandardMaterial({ color }));
    body.position.y = kind === "melee" ? 0.55 : 0.7;
    this.group.add(body);

    this.selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(0.7, 0.85, 24),
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

  setTarget(x: number, z: number) {
    this.targetPosition.set(x, 0, z);
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
    this.syncHealthBarPosition();
  }

  update() {
    this.group.position.lerp(this.targetPosition, INTERPOLATION_LERP);
    this.syncHealthBarPosition();
  }

  private syncHealthBarPosition() {
    this.healthBar.setPosition(this.group.position.x, this.group.position.y, this.group.position.z);
  }
}
