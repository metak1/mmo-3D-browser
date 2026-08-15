import * as THREE from "three";
import { EnemyBehavior } from "@mmo/shared";
import { HealthBar } from "./HealthBar";

const INTERPOLATION_LERP = 0.25;

const KIND_COLOR: Record<EnemyBehavior, number> = {
  melee: 0xb3423a,
  caster: 0x8a4fd1,
  boss: 0x6b1a1a,
};

const BOSS_PHASE_2_COLOR = 0xe0503c;

const SELECTION_RING_COLOR = 0xf5d76e;
const BOSS_HEALTH_BAR_Y_OFFSET = 2.6; // clears the boss's taller body; regular enemies use HealthBar's own default

export class EnemyAvatar {
  readonly group = new THREE.Group();
  readonly healthBar: HealthBar;
  private readonly selectionRing: THREE.Mesh;
  private readonly bodyMaterial: THREE.MeshStandardMaterial;
  private readonly isBoss: boolean;
  private targetPosition = new THREE.Vector3();

  constructor(kind: EnemyBehavior) {
    this.isBoss = kind === "boss";
    this.healthBar = new HealthBar(this.isBoss ? BOSS_HEALTH_BAR_Y_OFFSET : undefined);

    const color = KIND_COLOR[kind];
    let bodyGeometry: THREE.BufferGeometry;
    let bodyY: number;
    if (kind === "melee") {
      bodyGeometry = new THREE.BoxGeometry(0.8, 1.1, 0.8);
      bodyY = 0.55;
    } else if (kind === "caster") {
      bodyGeometry = new THREE.OctahedronGeometry(0.6, 0);
      bodyY = 0.7;
    } else {
      bodyGeometry = new THREE.IcosahedronGeometry(1.1, 0);
      bodyY = 1.1;
    }
    this.bodyMaterial = new THREE.MeshStandardMaterial({ color });
    const body = new THREE.Mesh(bodyGeometry, this.bodyMaterial);
    body.position.y = bodyY;
    this.group.add(body);

    this.selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(this.isBoss ? 1.3 : 0.7, this.isBoss ? 1.5 : 0.85, 24),
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

  // No-op for non-boss kinds - safe to call unconditionally from the generic per-enemy
  // onChange handler. Phase is derived client-side from hp/maxHp, not a synced flag.
  setBossPhase(isPhase2: boolean) {
    if (!this.isBoss) return;
    this.bodyMaterial.color.setHex(isPhase2 ? BOSS_PHASE_2_COLOR : KIND_COLOR.boss);
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
