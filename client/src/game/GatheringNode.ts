import * as THREE from "three";
import { getTerrainHeight } from "@mmo/shared";
import { fitHeight, spawnStaticModel } from "./models";
import { NameLabel } from "./NameLabel";

// Same nature-pack models Furniture.ts already uses for its "tree"/"rock*" kinds (see its own
// MODEL_PATH/MODEL_TARGET_HEIGHT doc comment) - reused here rather than duplicated assets, just a
// separate small lookup since gathering-node-types' model_id keys (admin-authored, see
// admin/src/entities.ts) are their own symbolic set, not FurnitureKind.
const MODEL_PATH: Record<string, string> = {
  oakTree: "/models/nature/tree_single_A.gltf",
  pineTree: "/models/nature/tree_single_B.gltf",
  copperVein: "/models/nature/rock_single_A.gltf",
  ironVein: "/models/nature/rock_single_B.gltf",
  silverVein: "/models/nature/rock_single_C.gltf",
  goldVein: "/models/nature/rock_single_D.gltf",
};
const DEFAULT_MODEL_PATH = "/models/nature/rock_single_A.gltf";
const MODEL_TARGET_HEIGHT: Record<string, number> = {
  oakTree: 2.2,
  pineTree: 2.2,
  copperVein: 0.5,
  ironVein: 0.5,
  silverVein: 0.5,
  goldVein: 0.5,
};
const DEFAULT_TARGET_HEIGHT = 0.5;

// Bright yellow (matches the NPC/waypoint marker gold already used for "notable, interact-with-me"
// world objects elsewhere in this game) - stands out clearly against a tree/rock's own natural
// colors, unlike NameLabel's default white which already reads fine over players/enemies.
const LABEL_COLOR = "#f5d76e";
const LABEL_GAP = 0.3; // world units of clearance above the model's own target height

// A world object a player clicks to gather from - depletes (hidden) then respawns (shown again)
// entirely server-driven (see WorldRoom.handleGatherNode's `available` flip), same
// "always render whatever the synced state says" contract every other avatar in this game follows.
// The name label is what tells a player what a given tree/rock silhouette actually is/gives before
// they click it - matches WaypointAvatar's own "an unlabeled shape doesn't explain itself" reasoning.
export class GatheringNodeAvatar {
  readonly group = new THREE.Group();
  readonly nameLabel: NameLabel;

  constructor(modelId: string, name: string, x: number, z: number) {
    const targetHeight = MODEL_TARGET_HEIGHT[modelId] ?? DEFAULT_TARGET_HEIGHT;
    spawnStaticModel(MODEL_PATH[modelId] ?? DEFAULT_MODEL_PATH).then((object) => {
      fitHeight(object, targetHeight);
      this.group.add(object);
    });
    this.group.position.set(x, getTerrainHeight(x, z), z);
    this.nameLabel = new NameLabel(name, targetHeight + LABEL_GAP, undefined, LABEL_COLOR);
    this.nameLabel.setPosition(x, getTerrainHeight(x, z), z);
  }

  setAvailable(available: boolean) {
    this.group.visible = available;
    this.nameLabel.group.visible = available;
  }

  addTo(scene: THREE.Scene) {
    scene.add(this.group);
    scene.add(this.nameLabel.group);
  }

  removeFrom(scene: THREE.Scene) {
    scene.remove(this.group);
    scene.remove(this.nameLabel.group);
  }
}
