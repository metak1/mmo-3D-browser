import * as THREE from "three";
import { ChatBubble } from "./ChatBubble";
import { DEFAULT_Y_OFFSET, HealthBar } from "./HealthBar";
import { LevelBadge } from "./LevelBadge";
import { NameLabel } from "./NameLabel";
import { fitHeight, hideMeshesByName, ModelAnimator, spawnModel, spawnRiggedModel, tintModel } from "./models";
import { identityTint } from "./textureTint";

const INTERPOLATION_LERP = 0.25;
const SELECTION_RING_COLOR = 0x6ee7ff;
const MOVING_THRESHOLD = 0.02; // group.position-to-target distance above which the walk clip plays
const NAME_LABEL_GAP = 0.4; // clearance above the health bar so the two never overlap - matches Enemy.ts's own constant

// One CC0 KayKit character (kaylousberg.com, "Adventurers Character Pack") per class. Warrior/
// Rogue/Mage/Oracle use the older v1 export, which ships its own baked Idle/Walking_A per file -
// no retargeting needed. Ranger uses the newer v2 export instead (the only one of these classes
// with a model actually built for it - v1 had no ranger model at all, which is why it used to
// reuse Rogue_Hooded); v2 character meshes carry no baked animations of their own, so Ranger's
// come from the shared Rig_Medium animation library instead - see RIGGED_CLASSES/spawnRiggedModel.
const CLASS_MODEL_PATH: Record<string, string> = {
  warrior: "/models/classes/Knight.glb",
  rogue: "/models/classes/Rogue.glb",
  ranger: "/models/classes/Ranger.glb",
  // No dedicated healer model exists in either export - previously reused Mage (both robed
  // casters, indistinguishable in silhouette, needing CLASS_COLOR to tell them apart at all).
  // Rogue_Hooded's cowled robe reads as a distinct priest/oracle look instead, freeing Ranger to
  // stop reusing it too.
  oracle: "/models/classes/Rogue_Hooded.glb",
  mage: "/models/classes/Mage.glb",
};
const DEFAULT_MODEL_PATH = CLASS_MODEL_PATH.warrior;
const MODEL_CLIPS = { idle: "Idle", walk: "Walking_A" };

const RIGGED_CLASSES = new Set(["ranger"]);
const RIG_MEDIUM_IDLE = { path: "/models/animations/Rig_Medium_General.glb", clip: "Idle_A" };
const RIG_MEDIUM_WALK = { path: "/models/animations/Rig_Medium_MovementBasic.glb", clip: "Walking_A" };

// Tinted by class rather than local/remote identity - the camera already follows the local player
// and their HUD shows their own name/HP, so there's no ambiguity about "which one is me" that a
// color would need to resolve, whereas oracle/mage sharing the Mage mesh genuinely need a color
// difference to read as separate classes at all.
const CLASS_COLOR: Record<string, number> = {
  warrior: 0x6b7684,
  rogue: 0x2e8b57,
  ranger: 0x8a6d3b,
  oracle: 0xf5d76e,
  mage: 0x8a4fd1,
};
const DEFAULT_COLOR = CLASS_COLOR.warrior;

// Each v1 KayKit character ships with every weapon/accessory option it was ever posed with (a
// rogue carries a crossbow, a throwable, AND a dagger, all attached to the same hand bone at once)
// as separate mesh nodes - an unmodified load renders all of them simultaneously (a dagger and a
// crossbow sharing one hand). Pick one weapon set per class and hide the rest. Oracle heals rather
// than fights, so it hides every weapon Rogue_Hooded ships with rather than picking one. v2 models
// (Ranger) have no such accessory nodes to begin with - nothing to hide, see RIGGED_CLASSES.
const CLASS_HIDE_MESHES: Record<string, string[]> = {
  warrior: ["1H_Sword_Offhand", "Badge_Shield", "Rectangle_Shield", "Spike_Shield", "2H_Sword"],
  rogue: ["1H_Crossbow", "2H_Crossbow", "Throwable"],
  oracle: ["Knife", "Knife_Offhand", "Throwable", "1H_Crossbow", "2H_Crossbow"],
  mage: ["Spellbook", "Spellbook_open", "1H_Wand"],
};

// Matches the original CapsuleGeometry(0.4, 0.9) avatar this whole model system replaced
// (0.9 + 2*0.4 = 1.7) - the map's houses/structures were built assuming this human scale.
const MODEL_HEIGHT = 1.7;

export class PlayerAvatar {
  readonly group = new THREE.Group();
  readonly healthBar = new HealthBar();
  readonly levelBadge = new LevelBadge(DEFAULT_Y_OFFSET);
  readonly nameLabel: NameLabel;
  readonly chatBubble = new ChatBubble();
  private readonly selectionRing: THREE.Mesh;
  private animator?: ModelAnimator;
  private targetPosition = new THREE.Vector3();
  private targetRotationY = 0;
  private currentRotationY = 0;

  constructor(classId: string, name: string) {
    this.nameLabel = new NameLabel(name, DEFAULT_Y_OFFSET + NAME_LABEL_GAP);
    // The model loads async (see models.ts) - the group starts with just the selection ring
    // until it resolves, the same "empty until first real content arrives" pattern every other
    // avatar in this game already tolerates before its first setTarget/setPosition call.
    const modelPath = CLASS_MODEL_PATH[classId] ?? DEFAULT_MODEL_PATH;
    const color = CLASS_COLOR[classId] ?? DEFAULT_COLOR;
    const spawn = RIGGED_CLASSES.has(classId)
      ? spawnRiggedModel(modelPath, RIG_MEDIUM_IDLE, RIG_MEDIUM_WALK)
      : spawnModel(modelPath, MODEL_CLIPS);
    spawn.then(({ object, animator }) => {
      fitHeight(object, MODEL_HEIGHT);
      tintModel(object, identityTint(color));
      hideMeshesByName(object, CLASS_HIDE_MESHES[classId] ?? []);
      this.group.add(object);
      this.animator = animator;
    });

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

  setLevel(level: number) {
    this.levelBadge.setLevel(level);
  }

  // guildName is "" for a guildless player - rendered as no subtitle line at all (see
  // NameLabel.setText), not an empty bracket. Called every time this player's schema changes
  // (see main.ts), same "diff internally, redraw only when it actually changed" contract as
  // setLevel/LevelBadge, so a name that never changes and a guild that rarely does stay cheap.
  setName(name: string, guildName: string) {
    this.nameLabel.setText(name, guildName ? `<${guildName}>` : undefined);
  }

  addTo(scene: THREE.Scene) {
    scene.add(this.group);
    scene.add(this.healthBar.group);
    scene.add(this.levelBadge.group);
    scene.add(this.nameLabel.group);
    scene.add(this.chatBubble.group);
    this.syncOverheadPositions();
  }

  removeFrom(scene: THREE.Scene) {
    scene.remove(this.group);
    scene.remove(this.healthBar.group);
    scene.remove(this.levelBadge.group);
    scene.remove(this.nameLabel.group);
    scene.remove(this.chatBubble.group);
  }

  // Turns smoothly toward targetRotationY instead of snapping straight to it - shared by
  // snapToTarget/update below. atan2(sin,cos) of the raw delta always turns the short way around,
  // never the long way past the back (a plain lerp between two raw angles can spin almost a full
  // turn the wrong way right when crossing the +-pi wrap boundary) - mirrors Enemy.ts/Npc.ts's own
  // rotation smoothing exactly, for the same reason.
  private lerpRotationTowardTarget(lerpFactor: number) {
    const delta = Math.atan2(Math.sin(this.targetRotationY - this.currentRotationY), Math.cos(this.targetRotationY - this.currentRotationY));
    this.currentRotationY += delta * lerpFactor;
    this.group.rotation.y = this.currentRotationY;
  }

  // Used by the local player, which snaps straight to its client-predicted position every frame
  // instead of lerping (see main.ts) - so "moving" can't be derived from position delta like
  // update() does for remote avatars, and is passed in from the actual input state instead.
  // Rotation still turns smoothly rather than snapping (position prediction needs to be instant to
  // avoid input lag; the visual heading doesn't, and snapping it produced a jarring instant pop
  // every time the movement direction changed instead of a natural turn).
  snapToTarget(dt: number, moving: boolean) {
    this.group.position.copy(this.targetPosition);
    this.lerpRotationTowardTarget(INTERPOLATION_LERP);
    this.syncOverheadPositions();
    this.animator?.setMoving(moving);
    this.animator?.update(dt);
  }

  update(dt: number) {
    const distance = this.group.position.distanceTo(this.targetPosition);
    this.group.position.lerp(this.targetPosition, INTERPOLATION_LERP);
    this.lerpRotationTowardTarget(INTERPOLATION_LERP);
    this.syncOverheadPositions();
    this.animator?.setMoving(distance > MOVING_THRESHOLD);
    this.animator?.update(dt);
  }

  private syncOverheadPositions() {
    this.healthBar.setPosition(this.group.position.x, this.group.position.y, this.group.position.z);
    this.levelBadge.setPosition(this.group.position.x, this.group.position.y, this.group.position.z);
    this.nameLabel.setPosition(this.group.position.x, this.group.position.y, this.group.position.z);
    this.chatBubble.setPosition(this.group.position.x, this.group.position.y, this.group.position.z);
  }
}
