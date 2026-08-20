import * as THREE from "three";
import { FurnitureDef, FurnitureKind, getTerrainHeight } from "@mmo/shared";
import { fitHeight, spawnStaticModel, tintModel } from "./models";
import { identityTint } from "./textureTint";

// KayKit's Dungeon Pack (kaylousberg.com) - one piece picked per FurnitureKind, close in role to
// what the procedural primitives it replaces stood in for. Every dungeon-pack model shares one
// texture atlas (client/public/models/dungeon/dungeon_texture.png), so this is a single extra
// texture load no matter how many distinct pieces/instances end up on screen.
const MODEL_PATH: Record<FurnitureKind, string> = {
  table: "/models/dungeon/table_medium.gltf",
  chair: "/models/dungeon/chair.gltf",
  barrel: "/models/dungeon/barrel_large.gltf",
  crate: "/models/dungeon/box_large.gltf",
  bookshelf: "/models/dungeon/shelves.gltf",
};

// Target world-space heights, close to the real-world-ish proportions the procedural primitives
// this replaces were built to - each model's own native export scale gets normalized against this
// rather than trusted directly (see fitHeight), same reasoning as the character models' scale fix.
const MODEL_TARGET_HEIGHT: Record<FurnitureKind, number> = {
  table: 0.85,
  chair: 0.85,
  barrel: 0.85,
  crate: 0.7,
  bookshelf: 1.8,
};

// Purely decorative: never collides, never interacted with, exists only to dress an enclosed room
// (see StructureEnclosureAvatar) so it doesn't read as an empty box.
export class FurnitureAvatar {
  readonly group = new THREE.Group();

  constructor(def: FurnitureDef) {
    // Async-loaded (see models.ts) - the group starts empty (just positioned/rotated) until the
    // model resolves, the same "empty until first real content arrives" pattern every other
    // avatar in this game already tolerates.
    spawnStaticModel(MODEL_PATH[def.kind]).then((object) => {
      fitHeight(object, MODEL_TARGET_HEIGHT[def.kind]);
      tintModel(object, identityTint(def.color));
      this.group.add(object);
    });
    this.group.position.set(def.x, getTerrainHeight(def.x, def.z) + def.yOffset, def.z);
    this.group.rotation.y = def.rotationY;
  }

  addTo(scene: THREE.Scene) {
    scene.add(this.group);
  }

  removeFrom(scene: THREE.Scene) {
    scene.remove(this.group);
  }
}
