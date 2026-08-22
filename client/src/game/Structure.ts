import * as THREE from "three";
import {
  STRUCTURE_GATE_PILLAR_FRACTION,
  StructureDef,
  StructureLoop,
  getTerrainHeight,
} from "@mmo/shared";
import { fitHeight, spawnStaticModel } from "./models";
import { stoneTexture } from "./textures";
import { softTint } from "./textureTint";

// Fixed regardless of an individual structure's wall color, so roofs/caps always read clearly
// against whatever color an admin picks for the walls.
const ROOF_COLOR = 0x4a3626;
const FLOOR_COLOR = 0x6b4a30;

// KayKit's Medieval Hexagon Pack (kaylousberg.com) - whole pre-made exterior buildings, unlike
// wall/door/tower/gate's procedural shapes (see StructureKind's doc comment). Each model's native
// export scale is tiny (a "home" is under a meter tall - built for a tabletop-hex-tile scale, not
// this game's ~1-unit-per-meter convention), hence targetHeight/fitHeight, same reasoning as every
// other real model in this codebase (see models.ts's fitHeight comment). Every building/color
// variant the pack ships (blue/green/red/yellow team colors, plus the neutral bridges/walls/fences/
// scaffolding/etc.) is registered here - targetHeight is each model's own native bbox height scaled
// by a category ratio (~3.5x for regular buildings, ~7x for towers, ~2x for wall/fence segments),
// not hand-tuned per model; the fences/walls here are visual-only (see StructureKind's own wall/
// door/tower/gate kinds for the ones that actually collide).
const BUILDING_MODELS: Record<string, { path: string; targetHeight: number }> = {
  building_archeryrange_blue: { path: "/models/hexagon/building_archeryrange_blue.gltf", targetHeight: 6.27 },
  building_barracks_blue: { path: "/models/hexagon/building_barracks_blue.gltf", targetHeight: 5.74 },
  building_blacksmith_blue: { path: "/models/hexagon/building_blacksmith_blue.gltf", targetHeight: 3.45 },
  building_castle_blue: { path: "/models/hexagon/building_castle_blue.gltf", targetHeight: 11.94 },
  building_church_blue: { path: "/models/hexagon/building_church_blue.gltf", targetHeight: 5.76 },
  building_home_A_blue: { path: "/models/hexagon/building_home_A_blue.gltf", targetHeight: 3.26 },
  building_home_B_blue: { path: "/models/hexagon/building_home_B_blue.gltf", targetHeight: 4.48 },
  building_lumbermill_blue: { path: "/models/hexagon/building_lumbermill_blue.gltf", targetHeight: 1.71 },
  building_market_blue: { path: "/models/hexagon/building_market_blue.gltf", targetHeight: 3.44 },
  building_mine_blue: { path: "/models/hexagon/building_mine_blue.gltf", targetHeight: 3.98 },
  building_tavern_blue: { path: "/models/hexagon/building_tavern_blue.gltf", targetHeight: 4.89 },
  building_tower_A_blue: { path: "/models/hexagon/building_tower_A_blue.gltf", targetHeight: 6.4 },
  building_tower_base_blue: { path: "/models/hexagon/building_tower_base_blue.gltf", targetHeight: 10.5 },
  building_tower_B_blue: { path: "/models/hexagon/building_tower_B_blue.gltf", targetHeight: 8.45 },
  building_tower_catapult_blue: { path: "/models/hexagon/building_tower_catapult_blue.gltf", targetHeight: 1.62 },
  building_watermill_blue: { path: "/models/hexagon/building_watermill_blue.gltf", targetHeight: 3.68 },
  building_well_blue: { path: "/models/hexagon/building_well_blue.gltf", targetHeight: 2.07 },
  building_windmill_blue: { path: "/models/hexagon/building_windmill_blue.gltf", targetHeight: 3.51 },
  building_archeryrange_green: { path: "/models/hexagon/building_archeryrange_green.gltf", targetHeight: 6.27 },
  building_barracks_green: { path: "/models/hexagon/building_barracks_green.gltf", targetHeight: 5.74 },
  building_blacksmith_green: { path: "/models/hexagon/building_blacksmith_green.gltf", targetHeight: 3.45 },
  building_castle_green: { path: "/models/hexagon/building_castle_green.gltf", targetHeight: 11.94 },
  building_church_green: { path: "/models/hexagon/building_church_green.gltf", targetHeight: 5.76 },
  building_home_A_green: { path: "/models/hexagon/building_home_A_green.gltf", targetHeight: 3.26 },
  building_home_B_green: { path: "/models/hexagon/building_home_B_green.gltf", targetHeight: 4.48 },
  building_lumbermill_green: { path: "/models/hexagon/building_lumbermill_green.gltf", targetHeight: 1.71 },
  building_market_green: { path: "/models/hexagon/building_market_green.gltf", targetHeight: 3.44 },
  building_mine_green: { path: "/models/hexagon/building_mine_green.gltf", targetHeight: 3.98 },
  building_tavern_green: { path: "/models/hexagon/building_tavern_green.gltf", targetHeight: 4.89 },
  building_tower_A_green: { path: "/models/hexagon/building_tower_A_green.gltf", targetHeight: 6.4 },
  building_tower_base_green: { path: "/models/hexagon/building_tower_base_green.gltf", targetHeight: 10.5 },
  building_tower_B_green: { path: "/models/hexagon/building_tower_B_green.gltf", targetHeight: 8.45 },
  building_tower_catapult_green: { path: "/models/hexagon/building_tower_catapult_green.gltf", targetHeight: 1.62 },
  building_watermill_green: { path: "/models/hexagon/building_watermill_green.gltf", targetHeight: 3.68 },
  building_well_green: { path: "/models/hexagon/building_well_green.gltf", targetHeight: 2.07 },
  building_windmill_green: { path: "/models/hexagon/building_windmill_green.gltf", targetHeight: 3.51 },
  building_archeryrange_red: { path: "/models/hexagon/building_archeryrange_red.gltf", targetHeight: 6.27 },
  building_barracks_red: { path: "/models/hexagon/building_barracks_red.gltf", targetHeight: 5.74 },
  building_blacksmith_red: { path: "/models/hexagon/building_blacksmith_red.gltf", targetHeight: 3.45 },
  building_castle_red: { path: "/models/hexagon/building_castle_red.gltf", targetHeight: 11.94 },
  building_church_red: { path: "/models/hexagon/building_church_red.gltf", targetHeight: 5.76 },
  building_home_A_red: { path: "/models/hexagon/building_home_A_red.gltf", targetHeight: 3.26 },
  building_home_B_red: { path: "/models/hexagon/building_home_B_red.gltf", targetHeight: 4.48 },
  building_lumbermill_red: { path: "/models/hexagon/building_lumbermill_red.gltf", targetHeight: 1.71 },
  building_market_red: { path: "/models/hexagon/building_market_red.gltf", targetHeight: 3.44 },
  building_mine_red: { path: "/models/hexagon/building_mine_red.gltf", targetHeight: 3.98 },
  building_tavern_red: { path: "/models/hexagon/building_tavern_red.gltf", targetHeight: 4.89 },
  building_tower_A_red: { path: "/models/hexagon/building_tower_A_red.gltf", targetHeight: 6.4 },
  building_tower_base_red: { path: "/models/hexagon/building_tower_base_red.gltf", targetHeight: 10.5 },
  building_tower_B_red: { path: "/models/hexagon/building_tower_B_red.gltf", targetHeight: 8.45 },
  building_tower_catapult_red: { path: "/models/hexagon/building_tower_catapult_red.gltf", targetHeight: 1.62 },
  building_watermill_red: { path: "/models/hexagon/building_watermill_red.gltf", targetHeight: 3.68 },
  building_well_red: { path: "/models/hexagon/building_well_red.gltf", targetHeight: 2.07 },
  building_windmill_red: { path: "/models/hexagon/building_windmill_red.gltf", targetHeight: 3.51 },
  building_archeryrange_yellow: { path: "/models/hexagon/building_archeryrange_yellow.gltf", targetHeight: 6.27 },
  building_barracks_yellow: { path: "/models/hexagon/building_barracks_yellow.gltf", targetHeight: 5.74 },
  building_blacksmith_yellow: { path: "/models/hexagon/building_blacksmith_yellow.gltf", targetHeight: 3.45 },
  building_castle_yellow: { path: "/models/hexagon/building_castle_yellow.gltf", targetHeight: 11.94 },
  building_church_yellow: { path: "/models/hexagon/building_church_yellow.gltf", targetHeight: 5.76 },
  building_home_A_yellow: { path: "/models/hexagon/building_home_A_yellow.gltf", targetHeight: 3.26 },
  building_home_B_yellow: { path: "/models/hexagon/building_home_B_yellow.gltf", targetHeight: 4.48 },
  building_lumbermill_yellow: { path: "/models/hexagon/building_lumbermill_yellow.gltf", targetHeight: 1.71 },
  building_market_yellow: { path: "/models/hexagon/building_market_yellow.gltf", targetHeight: 3.44 },
  building_mine_yellow: { path: "/models/hexagon/building_mine_yellow.gltf", targetHeight: 3.98 },
  building_tavern_yellow: { path: "/models/hexagon/building_tavern_yellow.gltf", targetHeight: 4.89 },
  building_tower_A_yellow: { path: "/models/hexagon/building_tower_A_yellow.gltf", targetHeight: 6.4 },
  building_tower_base_yellow: { path: "/models/hexagon/building_tower_base_yellow.gltf", targetHeight: 10.5 },
  building_tower_B_yellow: { path: "/models/hexagon/building_tower_B_yellow.gltf", targetHeight: 8.45 },
  building_tower_catapult_yellow: { path: "/models/hexagon/building_tower_catapult_yellow.gltf", targetHeight: 1.62 },
  building_watermill_yellow: { path: "/models/hexagon/building_watermill_yellow.gltf", targetHeight: 3.68 },
  building_well_yellow: { path: "/models/hexagon/building_well_yellow.gltf", targetHeight: 2.07 },
  building_windmill_yellow: { path: "/models/hexagon/building_windmill_yellow.gltf", targetHeight: 3.51 },
  building_bridge_A: { path: "/models/hexagon/building_bridge_A.gltf", targetHeight: 3.13 },
  building_bridge_B: { path: "/models/hexagon/building_bridge_B.gltf", targetHeight: 3.13 },
  building_destroyed: { path: "/models/hexagon/building_destroyed.gltf", targetHeight: 2.48 },
  building_dirt: { path: "/models/hexagon/building_dirt.gltf", targetHeight: 0.22 },
  building_grain: { path: "/models/hexagon/building_grain.gltf", targetHeight: 0.98 },
  building_scaffolding: { path: "/models/hexagon/building_scaffolding.gltf", targetHeight: 3.25 },
  building_stage_A: { path: "/models/hexagon/building_stage_A.gltf", targetHeight: 0.71 },
  building_stage_B: { path: "/models/hexagon/building_stage_B.gltf", targetHeight: 1.59 },
  building_stage_C: { path: "/models/hexagon/building_stage_C.gltf", targetHeight: 2.46 },
  fence_stone_straight: { path: "/models/hexagon/fence_stone_straight.gltf", targetHeight: 0.54 },
  fence_stone_straight_gate: { path: "/models/hexagon/fence_stone_straight_gate.gltf", targetHeight: 0.59 },
  fence_wood_straight: { path: "/models/hexagon/fence_wood_straight.gltf", targetHeight: 1.1 },
  fence_wood_straight_gate: { path: "/models/hexagon/fence_wood_straight_gate.gltf", targetHeight: 0.89 },
  wall_corner_A_gate: { path: "/models/hexagon/wall_corner_A_gate.gltf", targetHeight: 1.58 },
  wall_corner_A_inside: { path: "/models/hexagon/wall_corner_A_inside.gltf", targetHeight: 2.2 },
  wall_corner_A_outside: { path: "/models/hexagon/wall_corner_A_outside.gltf", targetHeight: 2.2 },
  wall_corner_B_inside: { path: "/models/hexagon/wall_corner_B_inside.gltf", targetHeight: 2.2 },
  wall_corner_B_outside: { path: "/models/hexagon/wall_corner_B_outside.gltf", targetHeight: 2.2 },
  wall_straight: { path: "/models/hexagon/wall_straight.gltf", targetHeight: 2.2 },
  wall_straight_gate: { path: "/models/hexagon/wall_straight_gate.gltf", targetHeight: 1.58 },
};

// How translucent an enclosed room's roof gets once the player is well inside its footprint, and
// how many world units beyond the footprint the fade transitions over (WoW-style "walk under the
// roof") - walls stay solid always, a door is how you actually get in.
const FADE_MIN_OPACITY = 0.12;
const FADE_MARGIN = 3;

// A 4-sided ConeGeometry approximates a pyramid, but its `radius` is the distance from the
// center to a *vertex*, not to the middle of a face - after the 45° rotation that aligns those
// faces with the box's walls, each face sits at `radius * cos(45°)` from center, not at `radius`.
// Without the compensating *Math.SQRT2 below, the roof's flat sides land noticeably inside the
// tower's footprint (and its corners short of the wall corners too), so the walls poke out from
// under it instead of the roof properly capping/overhanging them.
const TOWER_CAP_OVERHANG = 1.15;

function towerCap(width: number, depth: number, height: number): THREE.Mesh {
  // ConeGeometry smooths its vertex normals across the seam between adjacent faces by default
  // (fine for a round cone, but this one only has 4 radial segments to approximate a pyramid) -
  // without flatShading each of the 4 triangular faces blends into its neighbors instead of
  // reading as a distinct flat plane, which is what made the cap look like a soft blob/smudge
  // rather than a crisp low-poly roof (matching the sharp-faced look every BoxGeometry wall
  // already has for free, since a box never shares vertices/normals across its faces).
  const material = new THREE.MeshStandardMaterial({ color: ROOF_COLOR, flatShading: true });
  const radius = (Math.max(width, depth) / 2) * TOWER_CAP_OVERHANG * Math.SQRT2;
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 4), material);
  mesh.rotation.y = Math.PI / 4;
  return mesh;
}

interface BuiltStructure {
  object: THREE.Object3D;
}

function buildWall(def: StructureDef): BuiltStructure {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(def.width, def.height, def.depth),
    new THREE.MeshStandardMaterial({ color: softTint(def.color), map: stoneTexture(def.width, def.height) }),
  );
  mesh.position.y = def.height / 2;
  return { object: mesh };
}

// A simple frame (two posts + a lintel) rather than a solid box - a door never collides (see
// shared's getStructureColliders), so this is purely a visual marker of where the opening is,
// both standing alone and as part of a wall run that findStructureLoops turned into a room.
function buildDoor(def: StructureDef): BuiltStructure {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: softTint(def.color), map: stoneTexture(def.width, def.height) });
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

  return { object: group };
}

function buildTower(def: StructureDef): BuiltStructure {
  const group = new THREE.Group();
  const bodyHeight = def.height * 0.85;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(def.width, bodyHeight, def.depth),
    new THREE.MeshStandardMaterial({ color: softTint(def.color), map: stoneTexture(def.width, bodyHeight) }),
  );
  body.position.y = bodyHeight / 2;
  group.add(body);

  const cap = towerCap(def.width, def.depth, def.height * 0.25);
  cap.position.y = bodyHeight + (def.height * 0.25) / 2;
  group.add(cap);
  return { object: group };
}

function buildGate(def: StructureDef): BuiltStructure {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: softTint(def.color), map: stoneTexture(def.width, def.height) });
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
  return { object: group };
}

// Every other kind here is simple procedural Three.js geometry with no asset loading (matching
// Player/Npc/Enemy's own convention) - kind selects one of these hardcoded shape builders;
// everything else (position/size/color/rotation) is admin content. "building" is the exception
// (see BUILDING_MODELS/StructureKind's doc comment), loaded asynchronously like every other real
// model in this codebase - the group starts empty and gets the model added once it resolves.
// Walls/pillars/buildings are solid and actually block the player server-side (see shared's
// getStructureColliders/resolveStructureCollisions/BUILDING_FOOTPRINT) - a door never blocks,
// and neither does a building whose modelId has no BUILDING_FOOTPRINT entry (a bridge, a flat
// ground decal, or a piece with its own passable gate opening - see BUILDING_FOOTPRINT's own doc
// comment for the full list). A room's floor/roof aren't part of any single StructureDef/
// StructureAvatar - see StructureEnclosureAvatar
// below, built separately from findStructureLoops over the whole structure list (which "building"
// never participates in either).
export class StructureAvatar {
  readonly group = new THREE.Group();

  constructor(def: StructureDef) {
    if (def.kind === "building") {
      const model = def.modelId ? BUILDING_MODELS[def.modelId] : undefined;
      // Unrecognized/missing modelId (e.g. stale data, or an admin hasn't set one yet) - render
      // nothing rather than crash, same fallback the switch below uses for its own default case.
      if (model) {
        spawnStaticModel(model.path).then((object) => {
          fitHeight(object, model.targetHeight);
          this.group.add(object);
        });
      }
    } else {
      let built: BuiltStructure;
      switch (def.kind) {
        case "wall":
          built = buildWall(def);
          break;
        case "door":
          built = buildDoor(def);
          break;
        case "tower":
          built = buildTower(def);
          break;
        case "gate":
          built = buildGate(def);
          break;
        default:
          built = { object: new THREE.Group() }; // unrecognized kind (e.g. stale data) - render nothing rather than crash
      }
      this.group.add(built.object);
    }
    // getTerrainHeight flattens the ground under every structure's own footprint (see
    // shared/src/types.ts), so this always lands the structure on level ground by default -
    // yOffset lets an admin deliberately raise/sink it from there (e.g. a platform, a sunken
    // ruin) via the map editor's Y-axis gizmo.
    this.group.position.set(def.x, getTerrainHeight(def.x, def.z) + def.yOffset, def.z);
    this.group.rotation.y = def.rotationY;
  }

  // No-op today - kept so main.ts can iterate structures and enclosures through the same
  // `update(x, z)` call without caring which of the two it's actually holding.
  update(_playerX: number, _playerZ: number) {}

  addTo(scene: THREE.Scene) {
    scene.add(this.group);
  }

  removeFrom(scene: THREE.Scene) {
    scene.remove(this.group);
  }
}

// Builds one arbitrary-polygon-shaped flat mesh (a room's floor or roof) directly in 3D rather
// than via THREE.Shape/ExtrudeGeometry - those build in the shape's local XY plane and need a
// rotation to lie flat, which flips the winding (and therefore which side the normal/texture
// faces) depending on sign conventions that are easy to get backwards. Triangulating in x/z and
// writing y directly sidesteps that; the mesh is double-sided (see callers) so the loop's
// arbitrary winding direction never matters for visibility either.
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

// The floor + roof over one room detected by findStructureLoops - a sibling to the individual
// wall/door StructureAvatars that make up the room's perimeter, not a child of any one of them,
// since the polygon is a function of all of them together. Exposes the same
// update/addTo/removeFrom shape as StructureAvatar so main.ts can manage both through one list.
export class StructureEnclosureAvatar {
  readonly group = new THREE.Group();
  private readonly roofMaterial: THREE.MeshStandardMaterial;
  private readonly centroidX: number;
  private readonly centroidZ: number;
  private readonly fadeInnerRadius: number;

  constructor(loop: StructureLoop) {
    const floorMaterial = new THREE.MeshStandardMaterial({ color: FLOOR_COLOR, side: THREE.DoubleSide });
    const floor = buildFlatPolygon(loop.floorPoints, loop.floorY + 0.02, floorMaterial);
    this.group.add(floor);

    this.roofMaterial = new THREE.MeshStandardMaterial({
      color: ROOF_COLOR,
      transparent: true,
      side: THREE.DoubleSide,
    });
    const roof = buildFlatPolygon(loop.roofPoints, loop.roofY, this.roofMaterial);
    this.group.add(roof);

    this.centroidX = loop.floorPoints.reduce((sum, p) => sum + p.x, 0) / loop.floorPoints.length;
    this.centroidZ = loop.floorPoints.reduce((sum, p) => sum + p.z, 0) / loop.floorPoints.length;
    let maxRadius = 0;
    for (const p of loop.floorPoints) maxRadius = Math.max(maxRadius, Math.hypot(p.x - this.centroidX, p.z - this.centroidZ));
    this.fadeInnerRadius = maxRadius;
  }

  // Called every frame with the local player's world position - fades the roof out once the
  // player is well inside the room, same WoW-style "walk under the roof" as the old pyramid roof.
  update(playerX: number, playerZ: number) {
    const dist = Math.hypot(playerX - this.centroidX, playerZ - this.centroidZ);
    const t = Math.min(1, Math.max(0, (dist - this.fadeInnerRadius) / FADE_MARGIN));
    this.roofMaterial.opacity = FADE_MIN_OPACITY + (1 - FADE_MIN_OPACITY) * t;
  }

  addTo(scene: THREE.Scene) {
    scene.add(this.group);
  }

  removeFrom(scene: THREE.Scene) {
    scene.remove(this.group);
  }
}
