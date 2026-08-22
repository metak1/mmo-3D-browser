import * as THREE from "three";
import { STRUCTURE_GATE_PILLAR_FRACTION, StructureDef, StructureLoop } from "@mmo/shared";
import { fitHeight, loadStaticModel } from "./modelLoader";

// Mirrors client/src/game/Structure.ts's geometry exactly (same shared wall/pillar constants),
// minus the fade-material bookkeeping - the editor always shows structures fully solid, there's
// no walk-in fading concept here. Kept as a separate file rather than imported from the client
// app or moved into @mmo/shared: admin has no other Three.js code today and shared is
// deliberately rendering-library-free (the server imports it too). The duplication is the ~100
// lines of box/cone/polygon construction below, not the numbers that actually matter for
// correctness (those stay single-sourced in @mmo/shared).
const ROOF_COLOR = 0x4a3626;
const FLOOR_COLOR = 0x6b4a30;

function towerCap(width: number, depth: number, height: number): THREE.Mesh {
  // flatShading matters here even more than on the client: this is a bare, untextured cone, and
  // without it the 4 faces blend into each other at the shared edges (ConeGeometry smooths its
  // vertex normals by default) - the cap reads as a soft blob instead of a crisp pyramid, which
  // also makes it hard to judge while resizing since there's no visible ridge to gauge proportions.
  const mesh = new THREE.Mesh(
    new THREE.ConeGeometry((Math.max(width, depth) / 2) * 1.15, height, 4),
    new THREE.MeshStandardMaterial({ color: ROOF_COLOR, flatShading: true }),
  );
  mesh.rotation.y = Math.PI / 4;
  return mesh;
}

function buildWall(def: StructureDef): THREE.Object3D {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(def.width, def.height, def.depth),
    new THREE.MeshStandardMaterial({ color: def.color }),
  );
  mesh.position.y = def.height / 2;
  return mesh;
}

// A simple frame (two posts + a lintel) rather than a solid box - mirrors client/src/game/
// Structure.ts's buildDoor exactly, so the editor preview matches what actually renders in-game.
function buildDoor(def: StructureDef): THREE.Object3D {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: def.color });
  const postWidth = Math.min(def.width * 0.18, 0.3);

  for (const sign of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(postWidth, def.height, def.depth), material);
    post.position.set((sign * (def.width - postWidth)) / 2, def.height / 2, 0);
    group.add(post);
  }

  const lintelHeight = def.height * 0.15;
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(def.width, lintelHeight, def.depth), material);
  lintel.position.y = def.height - lintelHeight / 2;
  group.add(lintel);

  return group;
}

function buildTower(def: StructureDef): THREE.Object3D {
  const group = new THREE.Group();
  const bodyHeight = def.height * 0.85;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(def.width, bodyHeight, def.depth),
    new THREE.MeshStandardMaterial({ color: def.color }),
  );
  body.position.y = bodyHeight / 2;
  group.add(body);

  const cap = towerCap(def.width, def.depth, def.height * 0.25);
  cap.position.y = bodyHeight + (def.height * 0.25) / 2;
  group.add(cap);
  return group;
}

function buildGate(def: StructureDef): THREE.Object3D {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: def.color });
  const pillarWidth = def.width * STRUCTURE_GATE_PILLAR_FRACTION;
  const pillarOffset = def.width / 2 - pillarWidth / 2;

  for (const sign of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(pillarWidth, def.height, def.depth), material);
    pillar.position.set(sign * pillarOffset, def.height / 2, 0);
    group.add(pillar);
  }

  const lintelHeight = def.height * 0.2;
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(def.width, lintelHeight, def.depth), material);
  lintel.position.y = def.height + lintelHeight / 2;
  group.add(lintel);
  return group;
}

// Mirrors client/src/game/Structure.ts's BUILDING_MODELS exactly (same paths + target heights) -
// "building" kind structures are whole pre-made exterior models (KayKit's Medieval Hexagon Pack),
// unlike wall/door/tower/gate's procedural shapes above, so the editor needs its own copy of this
// table to render them for real instead of showing nothing.
export const BUILDING_MODEL_PATH: Record<string, string> = {
  building_archeryrange_blue: "/models/hexagon/building_archeryrange_blue.gltf",
  building_barracks_blue: "/models/hexagon/building_barracks_blue.gltf",
  building_blacksmith_blue: "/models/hexagon/building_blacksmith_blue.gltf",
  building_castle_blue: "/models/hexagon/building_castle_blue.gltf",
  building_church_blue: "/models/hexagon/building_church_blue.gltf",
  building_home_A_blue: "/models/hexagon/building_home_A_blue.gltf",
  building_home_B_blue: "/models/hexagon/building_home_B_blue.gltf",
  building_lumbermill_blue: "/models/hexagon/building_lumbermill_blue.gltf",
  building_market_blue: "/models/hexagon/building_market_blue.gltf",
  building_mine_blue: "/models/hexagon/building_mine_blue.gltf",
  building_tavern_blue: "/models/hexagon/building_tavern_blue.gltf",
  building_tower_A_blue: "/models/hexagon/building_tower_A_blue.gltf",
  building_tower_base_blue: "/models/hexagon/building_tower_base_blue.gltf",
  building_tower_B_blue: "/models/hexagon/building_tower_B_blue.gltf",
  building_tower_catapult_blue: "/models/hexagon/building_tower_catapult_blue.gltf",
  building_watermill_blue: "/models/hexagon/building_watermill_blue.gltf",
  building_well_blue: "/models/hexagon/building_well_blue.gltf",
  building_windmill_blue: "/models/hexagon/building_windmill_blue.gltf",
  building_archeryrange_green: "/models/hexagon/building_archeryrange_green.gltf",
  building_barracks_green: "/models/hexagon/building_barracks_green.gltf",
  building_blacksmith_green: "/models/hexagon/building_blacksmith_green.gltf",
  building_castle_green: "/models/hexagon/building_castle_green.gltf",
  building_church_green: "/models/hexagon/building_church_green.gltf",
  building_home_A_green: "/models/hexagon/building_home_A_green.gltf",
  building_home_B_green: "/models/hexagon/building_home_B_green.gltf",
  building_lumbermill_green: "/models/hexagon/building_lumbermill_green.gltf",
  building_market_green: "/models/hexagon/building_market_green.gltf",
  building_mine_green: "/models/hexagon/building_mine_green.gltf",
  building_tavern_green: "/models/hexagon/building_tavern_green.gltf",
  building_tower_A_green: "/models/hexagon/building_tower_A_green.gltf",
  building_tower_base_green: "/models/hexagon/building_tower_base_green.gltf",
  building_tower_B_green: "/models/hexagon/building_tower_B_green.gltf",
  building_tower_catapult_green: "/models/hexagon/building_tower_catapult_green.gltf",
  building_watermill_green: "/models/hexagon/building_watermill_green.gltf",
  building_well_green: "/models/hexagon/building_well_green.gltf",
  building_windmill_green: "/models/hexagon/building_windmill_green.gltf",
  building_archeryrange_red: "/models/hexagon/building_archeryrange_red.gltf",
  building_barracks_red: "/models/hexagon/building_barracks_red.gltf",
  building_blacksmith_red: "/models/hexagon/building_blacksmith_red.gltf",
  building_castle_red: "/models/hexagon/building_castle_red.gltf",
  building_church_red: "/models/hexagon/building_church_red.gltf",
  building_home_A_red: "/models/hexagon/building_home_A_red.gltf",
  building_home_B_red: "/models/hexagon/building_home_B_red.gltf",
  building_lumbermill_red: "/models/hexagon/building_lumbermill_red.gltf",
  building_market_red: "/models/hexagon/building_market_red.gltf",
  building_mine_red: "/models/hexagon/building_mine_red.gltf",
  building_tavern_red: "/models/hexagon/building_tavern_red.gltf",
  building_tower_A_red: "/models/hexagon/building_tower_A_red.gltf",
  building_tower_base_red: "/models/hexagon/building_tower_base_red.gltf",
  building_tower_B_red: "/models/hexagon/building_tower_B_red.gltf",
  building_tower_catapult_red: "/models/hexagon/building_tower_catapult_red.gltf",
  building_watermill_red: "/models/hexagon/building_watermill_red.gltf",
  building_well_red: "/models/hexagon/building_well_red.gltf",
  building_windmill_red: "/models/hexagon/building_windmill_red.gltf",
  building_archeryrange_yellow: "/models/hexagon/building_archeryrange_yellow.gltf",
  building_barracks_yellow: "/models/hexagon/building_barracks_yellow.gltf",
  building_blacksmith_yellow: "/models/hexagon/building_blacksmith_yellow.gltf",
  building_castle_yellow: "/models/hexagon/building_castle_yellow.gltf",
  building_church_yellow: "/models/hexagon/building_church_yellow.gltf",
  building_home_A_yellow: "/models/hexagon/building_home_A_yellow.gltf",
  building_home_B_yellow: "/models/hexagon/building_home_B_yellow.gltf",
  building_lumbermill_yellow: "/models/hexagon/building_lumbermill_yellow.gltf",
  building_market_yellow: "/models/hexagon/building_market_yellow.gltf",
  building_mine_yellow: "/models/hexagon/building_mine_yellow.gltf",
  building_tavern_yellow: "/models/hexagon/building_tavern_yellow.gltf",
  building_tower_A_yellow: "/models/hexagon/building_tower_A_yellow.gltf",
  building_tower_base_yellow: "/models/hexagon/building_tower_base_yellow.gltf",
  building_tower_B_yellow: "/models/hexagon/building_tower_B_yellow.gltf",
  building_tower_catapult_yellow: "/models/hexagon/building_tower_catapult_yellow.gltf",
  building_watermill_yellow: "/models/hexagon/building_watermill_yellow.gltf",
  building_well_yellow: "/models/hexagon/building_well_yellow.gltf",
  building_windmill_yellow: "/models/hexagon/building_windmill_yellow.gltf",
  building_bridge_A: "/models/hexagon/building_bridge_A.gltf",
  building_bridge_B: "/models/hexagon/building_bridge_B.gltf",
  building_destroyed: "/models/hexagon/building_destroyed.gltf",
  building_dirt: "/models/hexagon/building_dirt.gltf",
  building_grain: "/models/hexagon/building_grain.gltf",
  building_scaffolding: "/models/hexagon/building_scaffolding.gltf",
  building_stage_A: "/models/hexagon/building_stage_A.gltf",
  building_stage_B: "/models/hexagon/building_stage_B.gltf",
  building_stage_C: "/models/hexagon/building_stage_C.gltf",
  fence_stone_straight: "/models/hexagon/fence_stone_straight.gltf",
  fence_stone_straight_gate: "/models/hexagon/fence_stone_straight_gate.gltf",
  fence_wood_straight: "/models/hexagon/fence_wood_straight.gltf",
  fence_wood_straight_gate: "/models/hexagon/fence_wood_straight_gate.gltf",
  wall_corner_A_gate: "/models/hexagon/wall_corner_A_gate.gltf",
  wall_corner_A_inside: "/models/hexagon/wall_corner_A_inside.gltf",
  wall_corner_A_outside: "/models/hexagon/wall_corner_A_outside.gltf",
  wall_corner_B_inside: "/models/hexagon/wall_corner_B_inside.gltf",
  wall_corner_B_outside: "/models/hexagon/wall_corner_B_outside.gltf",
  wall_straight: "/models/hexagon/wall_straight.gltf",
  wall_straight_gate: "/models/hexagon/wall_straight_gate.gltf",
};

export const BUILDING_MODEL_TARGET_HEIGHT: Record<string, number> = {
  building_archeryrange_blue: 6.27,
  building_barracks_blue: 5.74,
  building_blacksmith_blue: 3.45,
  building_castle_blue: 11.94,
  building_church_blue: 5.76,
  building_home_A_blue: 3.26,
  building_home_B_blue: 4.48,
  building_lumbermill_blue: 1.71,
  building_market_blue: 3.44,
  building_mine_blue: 3.98,
  building_tavern_blue: 4.89,
  building_tower_A_blue: 6.4,
  building_tower_base_blue: 10.5,
  building_tower_B_blue: 8.45,
  building_tower_catapult_blue: 1.62,
  building_watermill_blue: 3.68,
  building_well_blue: 2.07,
  building_windmill_blue: 3.51,
  building_archeryrange_green: 6.27,
  building_barracks_green: 5.74,
  building_blacksmith_green: 3.45,
  building_castle_green: 11.94,
  building_church_green: 5.76,
  building_home_A_green: 3.26,
  building_home_B_green: 4.48,
  building_lumbermill_green: 1.71,
  building_market_green: 3.44,
  building_mine_green: 3.98,
  building_tavern_green: 4.89,
  building_tower_A_green: 6.4,
  building_tower_base_green: 10.5,
  building_tower_B_green: 8.45,
  building_tower_catapult_green: 1.62,
  building_watermill_green: 3.68,
  building_well_green: 2.07,
  building_windmill_green: 3.51,
  building_archeryrange_red: 6.27,
  building_barracks_red: 5.74,
  building_blacksmith_red: 3.45,
  building_castle_red: 11.94,
  building_church_red: 5.76,
  building_home_A_red: 3.26,
  building_home_B_red: 4.48,
  building_lumbermill_red: 1.71,
  building_market_red: 3.44,
  building_mine_red: 3.98,
  building_tavern_red: 4.89,
  building_tower_A_red: 6.4,
  building_tower_base_red: 10.5,
  building_tower_B_red: 8.45,
  building_tower_catapult_red: 1.62,
  building_watermill_red: 3.68,
  building_well_red: 2.07,
  building_windmill_red: 3.51,
  building_archeryrange_yellow: 6.27,
  building_barracks_yellow: 5.74,
  building_blacksmith_yellow: 3.45,
  building_castle_yellow: 11.94,
  building_church_yellow: 5.76,
  building_home_A_yellow: 3.26,
  building_home_B_yellow: 4.48,
  building_lumbermill_yellow: 1.71,
  building_market_yellow: 3.44,
  building_mine_yellow: 3.98,
  building_tavern_yellow: 4.89,
  building_tower_A_yellow: 6.4,
  building_tower_base_yellow: 10.5,
  building_tower_B_yellow: 8.45,
  building_tower_catapult_yellow: 1.62,
  building_watermill_yellow: 3.68,
  building_well_yellow: 2.07,
  building_windmill_yellow: 3.51,
  building_bridge_A: 3.13,
  building_bridge_B: 3.13,
  building_destroyed: 2.48,
  building_dirt: 0.22,
  building_grain: 0.98,
  building_scaffolding: 3.25,
  building_stage_A: 0.71,
  building_stage_B: 1.59,
  building_stage_C: 2.46,
  fence_stone_straight: 0.54,
  fence_stone_straight_gate: 0.59,
  fence_wood_straight: 1.1,
  fence_wood_straight_gate: 0.89,
  wall_corner_A_gate: 1.58,
  wall_corner_A_inside: 2.2,
  wall_corner_A_outside: 2.2,
  wall_corner_B_inside: 2.2,
  wall_corner_B_outside: 2.2,
  wall_straight: 2.2,
  wall_straight_gate: 1.58,
};

// Populates `group` (already positioned/rotated by the caller) with the real building model once
// it resolves - mirrors furnitureGeometry.ts's populateFurnitureShape, minus tinting (buildings
// are fixed team-colored variants, not admin-tintable). Safe to call on a group that later gets
// removed from the scene, same as populateFurnitureShape.
export function populateBuildingShape(group: THREE.Group, modelId: string): void {
  const path = BUILDING_MODEL_PATH[modelId];
  if (!path) return; // unrecognized modelId (e.g. stale data, or an admin hasn't set one yet)
  loadStaticModel(path).then((object) => {
    fitHeight(object, BUILDING_MODEL_TARGET_HEIGHT[modelId]);
    group.add(object);
  });
}

// Builds just the structure's own shape, unpositioned/unrotated (local origin at ground center,
// facing local -z) - the caller positions/rotates the returned group from the StructureDef's
// x/z/rotationY, same division of responsibility as client/src/game/Structure.ts's StructureAvatar.
// "building" kind is handled separately by populateBuildingShape above (async model load, not a
// synchronous procedural shape) - the caller adds both.
export function buildStructureShape(def: StructureDef): THREE.Object3D {
  switch (def.kind) {
    case "wall":
      return buildWall(def);
    case "door":
      return buildDoor(def);
    case "tower":
      return buildTower(def);
    case "gate":
      return buildGate(def);
    default:
      return new THREE.Group(); // "building" kind, or an unrecognized kind (e.g. stale data)
  }
}

// Mirrors client/src/game/Structure.ts's buildFlatPolygon - see its comment for why this
// triangulates in x/z and writes y directly instead of going through THREE.Shape's local-XY-plane
// + rotation route. Meshes are already in world space (unlike buildStructureShape's pieces, which
// the caller positions/rotates) since a room's polygon comes from several structures at once and
// has no single def to be "local" to.
function buildFlatPolygon(points: { x: number; z: number }[], y: number, material: THREE.Material): THREE.Mesh {
  const positions: number[] = [];
  for (const p of points) positions.push(p.x, y, p.z);

  const triangles = THREE.ShapeUtils.triangulateShape(
    points.map((p) => new THREE.Vector2(p.x, p.z)),
    [],
  );
  const indices: number[] = [];
  for (const [a, b, c] of triangles) indices.push(a, b, c);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

// The floor + roof over one room detected by findStructureLoops - shown fully opaque (no walk-in
// fade, matching every other structure in the editor) so an admin can always see the room they
// just closed off. Returns a world-space group, already positioned - unlike buildStructureShape,
// the caller doesn't reposition this.
export function buildEnclosureShape(loop: StructureLoop): THREE.Object3D {
  const group = new THREE.Group();
  group.add(buildFlatPolygon(loop.floorPoints, loop.floorY + 0.02, new THREE.MeshStandardMaterial({ color: FLOOR_COLOR, side: THREE.DoubleSide })));
  group.add(buildFlatPolygon(loop.roofPoints, loop.roofY, new THREE.MeshStandardMaterial({ color: ROOF_COLOR, side: THREE.DoubleSide })));
  return group;
}
