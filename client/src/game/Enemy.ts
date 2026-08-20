import * as THREE from "three";
import { ENEMY_CHASE_SPEED, EnemyBehavior, getTerrainHeight } from "@mmo/shared";
import { AoeCircle } from "./AoeCircle";
import { DEFAULT_Y_OFFSET, HealthBar } from "./HealthBar";
import { NameLabel } from "./NameLabel";
import { fitHeight, ModelAnimator, spawnModel, tintModel } from "./models";
import { identityTint } from "./textureTint";

const INTERPOLATION_LERP = 0.25;
const ROTATION_LERP = 0.15;
const MOVING_THRESHOLD = 0.02;
// Every position update this avatar receives while actually moving arrives exactly one server
// tick apart (Colyseus only patches state that changed, and the server's simulation interval is
// fixed) - dividing a tick's position delta by this fixed duration gives a real speed measurement
// without needing to trust wall-clock time between calls, which a wander pause (no updates sent
// for seconds at a time - see CombatEngine.tickWander) would otherwise badly skew. Matches
// SIMULATION_INTERVAL_MS in WorldRoom/DungeonRoom.
const SERVER_TICK_SECONDS = 1 / 30;
// The walk clip's authored pace looks right at this speed (the only one enemies ever moved at
// before wander existed - see ENEMY_CHASE_SPEED) - see setTarget/update for how a slower measured
// speed (wandering) scales the clip's timeScale down so limbs don't outrun the actual footwork.
const WALK_ANIMATION_REFERENCE_SPEED = ENEMY_CHASE_SPEED;
const MIN_WALK_SPEED_SCALE = 0.35; // floor so a near-stationary nudge doesn't look like a freeze-frame

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
const NAME_LABEL_GAP = 0.22; // clearance above the health bar so the two never overlap

export class EnemyAvatar {
  readonly group = new THREE.Group();
  readonly healthBar: HealthBar;
  readonly nameLabel: NameLabel;
  readonly telegraph = new AoeCircle();
  private readonly selectionRing: THREE.Mesh;
  private readonly isBoss: boolean;
  private readonly kind: EnemyBehavior;
  private modelObject?: THREE.Object3D;
  private animator?: ModelAnimator;
  private targetPosition = new THREE.Vector3();
  private desiredRotationY = 0;
  private currentRotationY = 0;
  private measuredSpeed = 0;

  constructor(kind: EnemyBehavior, name: string, aggressive: boolean) {
    this.kind = kind;
    this.isBoss = kind === "boss";
    const healthBarYOffset = this.isBoss ? BOSS_HEALTH_BAR_Y_OFFSET : DEFAULT_Y_OFFSET;
    this.healthBar = new HealthBar(healthBarYOffset);
    // Fixed for this enemy's whole lifetime (not re-set on aggroTargetId changes - see
    // HealthBar.setTypeColor) - yellow if it won't engage until attacked, red if it auto-engages
    // any player within its aggroRange. Bosses are always quest-engaged rather than a
    // passive/aggressive type, so this doesn't apply to them (aggressive is always false there -
    // see main.ts's isAggressiveEnemyType).
    if (!this.isBoss) this.healthBar.setTypeColor(aggressive);
    this.nameLabel = new NameLabel(name, healthBarYOffset + NAME_LABEL_GAP);

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

  // Enemies never had a synced rotation field (there was no reason to, before they could move) -
  // facing is derived client-side from the direction of each incoming position update instead,
  // same atan2(dx, dz) convention the server uses for players. Also measures actual speed from
  // this tick's delta (see SERVER_TICK_SECONDS) for the walk animation's timeScale.
  setTarget(x: number, z: number) {
    const dx = x - this.targetPosition.x;
    const dz = z - this.targetPosition.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.01) this.desiredRotationY = Math.atan2(dx, dz);
    this.measuredSpeed = dist / SERVER_TICK_SECONDS;
    this.targetPosition.set(x, getTerrainHeight(x, z), z);
  }

  // Bosses have no passive/aggressive type to show, so their bar falls back to the normal
  // HP-fraction gradient instead (more useful for a boss fight anyway - a read on remaining HP%,
  // not just a static color); every other kind keeps its fixed type color from the constructor
  // (see HealthBar.setTypeColor) regardless of current HP fraction.
  setHp(hp: number, maxHp: number) {
    this.healthBar.setFraction(maxHp > 0 ? hp / maxHp : 0, this.isBoss);
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
    scene.add(this.nameLabel.group);
    scene.add(this.telegraph.mesh);
    this.syncOverlayPositions();
  }

  removeFrom(scene: THREE.Scene) {
    scene.remove(this.group);
    scene.remove(this.healthBar.group);
    scene.remove(this.nameLabel.group);
    scene.remove(this.telegraph.mesh);
  }

  snapToTarget() {
    this.group.position.copy(this.targetPosition);
    this.currentRotationY = this.desiredRotationY;
    this.group.rotation.y = this.currentRotationY;
    this.syncOverlayPositions();
  }

  update(dt: number) {
    const distance = this.group.position.distanceTo(this.targetPosition);
    this.group.position.lerp(this.targetPosition, INTERPOLATION_LERP);
    // Smoothly turn to face the desired heading rather than snapping to it - matters a lot now
    // that wander (see CombatEngine.tickWander) picks a new random direction every leg; a chasing
    // enemy or a player's heading changes far more gradually already (continuous small steps
    // toward a moving target), so an instant snap was never noticeable before wander made abrupt
    // direction changes common. atan2(sin,cos) of the raw delta always turns the short way around,
    // never the long way past the back.
    const delta = Math.atan2(Math.sin(this.desiredRotationY - this.currentRotationY), Math.cos(this.desiredRotationY - this.currentRotationY));
    this.currentRotationY += delta * ROTATION_LERP;
    this.group.rotation.y = this.currentRotationY;
    this.syncOverlayPositions();
    const speedScale = Math.max(MIN_WALK_SPEED_SCALE, Math.min(1, this.measuredSpeed / WALK_ANIMATION_REFERENCE_SPEED));
    this.animator?.setMoving(distance > MOVING_THRESHOLD, speedScale);
    this.animator?.update(dt);
  }

  private syncOverlayPositions() {
    this.healthBar.setPosition(this.group.position.x, this.group.position.y, this.group.position.z);
    this.nameLabel.setPosition(this.group.position.x, this.group.position.y, this.group.position.z);
  }
}
