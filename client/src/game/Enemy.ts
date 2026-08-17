import * as THREE from "three";
import { EnemyBehavior, getTerrainHeight } from "@mmo/shared";
import { AoeCircle } from "./AoeCircle";
import { HealthBar } from "./HealthBar";
import { fitHeight, ModelAnimator, spawnModel, tintModel } from "./models";
import { identityTint } from "./textureTint";

const INTERPOLATION_LERP = 0.25;
const MOVING_THRESHOLD = 0.02;

const KIND_COLOR: Record<EnemyBehavior, number> = {
  melee: 0xb3423a,
  caster: 0x8a4fd1,
  boss: 0x6b1a1a,
};

// A single CC0 Quaternius "Goblin" model (goblin.glb) shared across all three enemy kinds,
// distinguished by tint/scale instead of separate meshes - mirrors how man.glb is already
// shared between Player and Npc. The original per-kind monster pack (orc/wizard/yeti.glb) turned
// out to be a broken export: even rendered raw with zero processing, those files collapse into a
// blob instead of a standing creature, confirmed via isolated testing outside this game entirely
// (man.glb, from a different pack, renders perfectly through the identical code path). goblin.glb
// was sourced and verified separately as a working replacement.
const MODEL_PATH = "/models/goblin.glb";
const MODEL_CLIPS = {
  idle: "EnemyArmature|EnemyArmature|EnemyArmature|Idle",
  walk: "EnemyArmature|EnemyArmature|EnemyArmature|Walk",
};

// Target world-space heights (roughly matching the old box/octahedron/icosahedron primitives'
// footprint) that fitHeight scales each model to, regardless of its native export scale.
const KIND_HEIGHT: Record<EnemyBehavior, number> = {
  melee: 1.8,
  caster: 1.6,
  boss: 3,
};

const BOSS_PHASE_2_COLOR = 0xe0503c;

const SELECTION_RING_COLOR = 0xf5d76e;
const BOSS_HEALTH_BAR_Y_OFFSET = 2.6; // clears the boss's taller body; regular enemies use HealthBar's own default

export class EnemyAvatar {
  readonly group = new THREE.Group();
  readonly healthBar: HealthBar;
  readonly telegraph = new AoeCircle();
  private readonly selectionRing: THREE.Mesh;
  private readonly isBoss: boolean;
  private readonly kind: EnemyBehavior;
  private modelObject?: THREE.Object3D;
  private animator?: ModelAnimator;
  private targetPosition = new THREE.Vector3();

  constructor(kind: EnemyBehavior) {
    this.kind = kind;
    this.isBoss = kind === "boss";
    this.healthBar = new HealthBar(this.isBoss ? BOSS_HEALTH_BAR_Y_OFFSET : undefined);

    spawnModel(MODEL_PATH, MODEL_CLIPS).then(({ object, animator }) => {
      fitHeight(object, KIND_HEIGHT[kind]);
      tintModel(object, identityTint(KIND_COLOR[kind]));
      this.group.add(object);
      this.modelObject = object;
      this.animator = animator;
    });

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
    if (!this.isBoss || !this.modelObject) return;
    tintModel(this.modelObject, identityTint(isPhase2 ? BOSS_PHASE_2_COLOR : KIND_COLOR.boss));
  }

  setTarget(x: number, z: number) {
    this.targetPosition.set(x, getTerrainHeight(x, z), z);
  }

  setHp(hp: number, maxHp: number) {
    this.healthBar.setFraction(maxHp > 0 ? hp / maxHp : 0, false);
  }

  // Enemy bars trade the usual HP-fraction color gradient for an aggro cue instead (see
  // HealthBar.setAggroColor) - red if aggro is on the local player (or not engaged yet), yellow
  // if it's on someone else. Called alongside setHp whenever aggroTargetId changes.
  setAggro(hasAggro: boolean) {
    this.healthBar.setAggroColor(hasAggro);
  }

  // Marks the ground area this enemy is about to hit while winding up an AoE ability - not
  // necessarily centered on the enemy itself (see main.ts's updateEnemyTelegraph, which centers
  // the existing phase-2 splash on its target instead), so this takes an explicit position rather
  // than always following this.group.
  setTelegraph(active: boolean, x: number, z: number, radius: number) {
    if (!active) {
      this.telegraph.hide();
      return;
    }
    this.telegraph.setRadius(radius);
    this.telegraph.setPosition(x, z);
    this.telegraph.show();
  }

  addTo(scene: THREE.Scene) {
    scene.add(this.group);
    scene.add(this.healthBar.group);
    scene.add(this.telegraph.mesh);
    this.syncHealthBarPosition();
  }

  removeFrom(scene: THREE.Scene) {
    scene.remove(this.group);
    scene.remove(this.healthBar.group);
    scene.remove(this.telegraph.mesh);
  }

  snapToTarget() {
    this.group.position.copy(this.targetPosition);
    this.syncHealthBarPosition();
  }

  update(dt: number) {
    const distance = this.group.position.distanceTo(this.targetPosition);
    this.group.position.lerp(this.targetPosition, INTERPOLATION_LERP);
    this.syncHealthBarPosition();
    this.animator?.setMoving(distance > MOVING_THRESHOLD);
    this.animator?.update(dt);
  }

  private syncHealthBarPosition() {
    this.healthBar.setPosition(this.group.position.x, this.group.position.y, this.group.position.z);
  }
}
