import * as THREE from "three";
import { ChatBubble } from "./ChatBubble";
import { HealthBar } from "./HealthBar";
import { fitHeight, hideMeshesByName, ModelAnimator, spawnModel, tintModel } from "./models";
import { identityTint } from "./textureTint";

const INTERPOLATION_LERP = 0.25;
const SELECTION_RING_COLOR = 0x6ee7ff;
const MOVING_THRESHOLD = 0.02; // group.position-to-target distance above which the walk clip plays

// One CC0 KayKit character (kaylousberg.com, "Adventurers Character Pack", via GitHub) per class -
// each ships its own Idle/Walking_A animations, so unlike the earlier Quaternius outfit attempt,
// no retargeting is needed. Oracle has no dedicated healer model in the pack, so it reuses Mage
// (both robed casters) - CLASS_COLOR below is what keeps mage/oracle visually distinct from each
// other despite sharing a mesh.
const CLASS_MODEL_PATH: Record<string, string> = {
  warrior: "/models/classes/Knight.glb",
  rogue: "/models/classes/Rogue.glb",
  ranger: "/models/classes/Rogue_Hooded.glb",
  oracle: "/models/classes/Mage.glb",
  mage: "/models/classes/Mage.glb",
};
const DEFAULT_MODEL_PATH = CLASS_MODEL_PATH.warrior;
const MODEL_CLIPS = { idle: "Idle", walk: "Walking_A" };

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

// Each KayKit character ships with every weapon/accessory option it was ever posed with (a rogue
// carries a crossbow, a throwable, AND a dagger, all attached to the same hand bone at once) as
// separate mesh nodes - an unmodified load renders all of them simultaneously (a dagger and a
// crossbow sharing one hand). Pick one weapon set per class and hide the rest. Oracle and Mage
// share the Mage model but get different accessories (staff vs. spellbook) as a second visual cue
// alongside their different tint.
const CLASS_HIDE_MESHES: Record<string, string[]> = {
  warrior: ["1H_Sword_Offhand", "Badge_Shield", "Rectangle_Shield", "Spike_Shield", "2H_Sword"],
  rogue: ["1H_Crossbow", "2H_Crossbow", "Throwable"],
  ranger: ["Knife", "Knife_Offhand", "Throwable", "1H_Crossbow"],
  oracle: ["Spellbook", "1H_Wand", "2H_Staff"],
  mage: ["Spellbook", "Spellbook_open", "1H_Wand"],
};

// Matches the original CapsuleGeometry(0.4, 0.9) avatar this whole model system replaced
// (0.9 + 2*0.4 = 1.7) - the map's houses/structures were built assuming this human scale.
const MODEL_HEIGHT = 1.7;

export class PlayerAvatar {
  readonly group = new THREE.Group();
  readonly healthBar = new HealthBar();
  readonly chatBubble = new ChatBubble();
  private readonly selectionRing: THREE.Mesh;
  private animator?: ModelAnimator;
  private targetPosition = new THREE.Vector3();
  private targetRotationY = 0;

  constructor(classId: string) {
    // The model loads async (see models.ts) - the group starts with just the selection ring
    // until it resolves, the same "empty until first real content arrives" pattern every other
    // avatar in this game already tolerates before its first setTarget/setPosition call.
    const modelPath = CLASS_MODEL_PATH[classId] ?? DEFAULT_MODEL_PATH;
    const color = CLASS_COLOR[classId] ?? DEFAULT_COLOR;
    spawnModel(modelPath, MODEL_CLIPS).then(({ object, animator }) => {
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

  // Used by the local player, which snaps straight to its client-predicted position every frame
  // instead of lerping (see main.ts) - so "moving" can't be derived from position delta like
  // update() does for remote avatars, and is passed in from the actual input state instead.
  snapToTarget(dt: number, moving: boolean) {
    this.group.position.copy(this.targetPosition);
    this.group.rotation.y = this.targetRotationY;
    this.syncOverheadPositions();
    this.animator?.setMoving(moving);
    this.animator?.update(dt);
  }

  update(dt: number) {
    const distance = this.group.position.distanceTo(this.targetPosition);
    this.group.position.lerp(this.targetPosition, INTERPOLATION_LERP);
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, this.targetRotationY, INTERPOLATION_LERP);
    this.syncOverheadPositions();
    this.animator?.setMoving(distance > MOVING_THRESHOLD);
    this.animator?.update(dt);
  }

  private syncOverheadPositions() {
    this.healthBar.setPosition(this.group.position.x, this.group.position.y, this.group.position.z);
    this.chatBubble.setPosition(this.group.position.x, this.group.position.y, this.group.position.z);
  }
}
