import * as THREE from "three";
import { FurnitureDef, FurnitureKind, getTerrainHeight } from "@mmo/shared";
import { fitHeight, spawnStaticModel, tintModel } from "./models";
import { identityTint } from "./textureTint";

// Indoor kinds are KayKit's Dungeon Pack (kaylousberg.com) - one piece picked per FurnitureKind,
// close in role to what the procedural primitives it replaces stood in for. Every dungeon-pack
// model shares one texture atlas (client/public/models/dungeon/dungeon_texture.png). Outdoor
// nature kinds (hill/rock*/tree/mountain*) are the Medieval Hexagon Pack's own decoration set
// instead, sharing the hex tiles' atlas (client/public/models/nature/hexagons_medieval.png) - a
// second extra texture load, only paid once no matter how many instances of either pack end up on
// screen.
const MODEL_PATH: Record<FurnitureKind, string> = {
  table: "/models/dungeon/table_medium.gltf",
  chair: "/models/dungeon/chair.gltf",
  barrel: "/models/dungeon/barrel_large.gltf",
  crate: "/models/dungeon/box_large.gltf",
  bookshelf: "/models/dungeon/shelves.gltf",
  hill: "/models/nature/hill_single_A.gltf",
  hillB: "/models/nature/hill_single_B.gltf",
  hillC: "/models/nature/hill_single_C.gltf",
  hillsA: "/models/nature/hills_A.gltf",
  hillsATrees: "/models/nature/hills_A_trees.gltf",
  hillsB: "/models/nature/hills_B.gltf",
  hillsBTrees: "/models/nature/hills_B_trees.gltf",
  hillsC: "/models/nature/hills_C.gltf",
  hillsCTrees: "/models/nature/hills_C_trees.gltf",
  rock: "/models/nature/rock_single_A.gltf",
  rockB: "/models/nature/rock_single_B.gltf",
  rockC: "/models/nature/rock_single_C.gltf",
  rockD: "/models/nature/rock_single_D.gltf",
  rockE: "/models/nature/rock_single_E.gltf",
  tree: "/models/nature/tree_single_A.gltf",
  treeB: "/models/nature/tree_single_B.gltf",
  treeACut: "/models/nature/tree_single_A_cut.gltf",
  treeBCut: "/models/nature/tree_single_B_cut.gltf",
  treesACut: "/models/nature/trees_A_cut.gltf",
  treesALarge: "/models/nature/trees_A_large.gltf",
  treesAMedium: "/models/nature/trees_A_medium.gltf",
  treesASmall: "/models/nature/trees_A_small.gltf",
  treesBCut: "/models/nature/trees_B_cut.gltf",
  treesBLarge: "/models/nature/trees_B_large.gltf",
  treesBMedium: "/models/nature/trees_B_medium.gltf",
  treesBSmall: "/models/nature/trees_B_small.gltf",
  mountainA: "/models/nature/mountain_A.gltf",
  mountainB: "/models/nature/mountain_B.gltf",
  mountainC: "/models/nature/mountain_C.gltf",
  mountainAGrass: "/models/nature/mountain_A_grass.gltf",
  mountainAGrassTrees: "/models/nature/mountain_A_grass_trees.gltf",
  mountainBGrass: "/models/nature/mountain_B_grass.gltf",
  mountainBGrassTrees: "/models/nature/mountain_B_grass_trees.gltf",
  mountainCGrass: "/models/nature/mountain_C_grass.gltf",
  mountainCGrassTrees: "/models/nature/mountain_C_grass_trees.gltf",
  cloudBig: "/models/nature/cloud_big.gltf",
  cloudSmall: "/models/nature/cloud_small.gltf",
  waterlilyA: "/models/nature/waterlily_A.gltf",
  waterlilyB: "/models/nature/waterlily_B.gltf",
  waterplantA: "/models/nature/waterplant_A.gltf",
  waterplantB: "/models/nature/waterplant_B.gltf",
  waterplantC: "/models/nature/waterplant_C.gltf",
  hexBarrel: "/models/hexprops/barrel.gltf",
  bucketArrows: "/models/hexprops/bucket_arrows.gltf",
  bucketEmpty: "/models/hexprops/bucket_empty.gltf",
  bucketWater: "/models/hexprops/bucket_water.gltf",
  hexCrateBigA: "/models/hexprops/crate_A_big.gltf",
  hexCrateSmallA: "/models/hexprops/crate_A_small.gltf",
  hexCrateBigB: "/models/hexprops/crate_B_big.gltf",
  hexCrateSmallB: "/models/hexprops/crate_B_small.gltf",
  hexCrateLongA: "/models/hexprops/crate_long_A.gltf",
  hexCrateLongB: "/models/hexprops/crate_long_B.gltf",
  hexCrateLongC: "/models/hexprops/crate_long_C.gltf",
  hexCrateLongEmpty: "/models/hexprops/crate_long_empty.gltf",
  hexCrateOpen: "/models/hexprops/crate_open.gltf",
  flagBlue: "/models/hexprops/flag_blue.gltf",
  flagGreen: "/models/hexprops/flag_green.gltf",
  flagRed: "/models/hexprops/flag_red.gltf",
  flagYellow: "/models/hexprops/flag_yellow.gltf",
  ladder: "/models/hexprops/ladder.gltf",
  pallet: "/models/hexprops/pallet.gltf",
  resourceLumber: "/models/hexprops/resource_lumber.gltf",
  resourceStone: "/models/hexprops/resource_stone.gltf",
  sack: "/models/hexprops/sack.gltf",
  archeryTarget: "/models/hexprops/target.gltf",
  tent: "/models/hexprops/tent.gltf",
  weaponrack: "/models/hexprops/weaponrack.gltf",
  wheelbarrow: "/models/hexprops/wheelbarrow.gltf",
};

// Target world-space heights, close to the real-world-ish proportions the procedural primitives
// this replaces were built to - each model's own native export scale gets normalized against this
// rather than trusted directly (see fitHeight), same reasoning as the character models' scale fix.
// This same targetHeight/nativeHeight ratio is also what shared's FURNITURE_FOOTPRINT was computed
// with (applied to each model's native X/Z extent instead of Y) - see its own doc comment - so the
// server's movement-blocking collider always matches this client's rendered scale.
const MODEL_TARGET_HEIGHT: Record<FurnitureKind, number> = {
  table: 0.85,
  chair: 0.85,
  barrel: 0.85,
  crate: 0.7,
  bookshelf: 1.8,
  hill: 1.2,
  hillB: 1.2,
  hillC: 1.2,
  hillsA: 2.6,
  hillsATrees: 3,
  hillsB: 2.4,
  hillsBTrees: 2.8,
  hillsC: 2.5,
  hillsCTrees: 2.9,
  rock: 0.5,
  rockB: 0.5,
  rockC: 0.5,
  rockD: 0.5,
  rockE: 0.5,
  tree: 2.2,
  treeB: 2.2,
  treeACut: 0.4,
  treeBCut: 0.4,
  treesACut: 0.4,
  treesALarge: 3.2,
  treesAMedium: 2.8,
  treesASmall: 2.2,
  treesBCut: 0.35,
  treesBLarge: 3,
  treesBMedium: 2.6,
  treesBSmall: 2,
  mountainA: 2.4,
  mountainB: 2.4,
  mountainC: 2.4,
  mountainAGrass: 2.4,
  mountainAGrassTrees: 2.6,
  mountainBGrass: 2.4,
  mountainBGrassTrees: 2.6,
  mountainCGrass: 2.4,
  mountainCGrassTrees: 2.6,
  cloudBig: 2.8,
  cloudSmall: 2,
  waterlilyA: 0.15,
  waterlilyB: 0.18,
  waterplantA: 0.4,
  waterplantB: 0.5,
  waterplantC: 0.45,
  hexBarrel: 0.7,
  bucketArrows: 0.76,
  bucketEmpty: 0.41,
  bucketWater: 0.35,
  hexCrateBigA: 0.69,
  hexCrateSmallA: 0.46,
  hexCrateBigB: 0.69,
  hexCrateSmallB: 0.46,
  hexCrateLongA: 0.5,
  hexCrateLongB: 0.5,
  hexCrateLongC: 0.66,
  hexCrateLongEmpty: 0.5,
  hexCrateOpen: 0.68,
  flagBlue: 1.39,
  flagGreen: 1.39,
  flagRed: 1.39,
  flagYellow: 1.39,
  ladder: 2.54,
  pallet: 0.26,
  resourceLumber: 0.69,
  resourceStone: 0.92,
  sack: 0.21,
  archeryTarget: 1,
  tent: 1.7,
  weaponrack: 0.79,
  wheelbarrow: 0.62,
};

// Purely decorative, indoor and outdoor alike - never interacted with. Most outdoor kinds (see
// shared's FURNITURE_FOOTPRINT) are also server-side solid; this avatar just renders what's
// already blocking movement rather than the client deciding collision itself.
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
