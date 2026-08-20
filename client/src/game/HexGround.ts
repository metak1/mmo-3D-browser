import * as THREE from "three";
import {
  AXIAL_DIRECTIONS,
  classifyHexTerrain,
  hexToWorld,
  HexTerrainKind,
  HEX_CIRCUMRADIUS,
  HEX_TILE_SCALE,
} from "@mmo/shared";
import { loadModelGeometry } from "./models";

// The overworld floor is a mosaic of KayKit hex tiles, now driven by shared/src/hex.ts's real
// (not just visual) axial coordinate system and terrain classifier - grass/water/road are a
// genuine gameplay layer (water blocks movement, see CombatEngine's blockWaterTerrain), not just
// paint. Different kinds need different geometry/material, so each kind gets its own
// THREE.InstancedMesh rather than the single shared one this file used before.
const TILE_WIDTH = Math.sqrt(3) * HEX_CIRCUMRADIUS; // flat-to-flat, world X spacing between columns
const TILE_ROW_SPACING = 1.5 * HEX_CIRCUMRADIUS; // world Z spacing between rows

// The six 60-degree rotations a regular hexagon's outline is invariant under - applying one per
// grass/water tile (picked deterministically from its own position) breaks up the obvious
// repetition of a single tile model copied thousands of times, without ever producing a visible
// seam between neighbors.
const ROTATION_STEPS = [0, 1, 2, 3, 4, 5].map((n) => (n * Math.PI) / 3);

const MODEL_PATHS: Record<HexTerrainKind, string> = {
  grass: "/models/hexagon/hex_grass.gltf",
  water: "/models/hexagon/hex_water.gltf",
  road: "/models/hexagon/hex_road_A.gltf",
};

interface PlacedCell {
  q: number;
  r: number;
  x: number;
  z: number;
}

function deterministicRotation(x: number, z: number): number {
  return ROTATION_STEPS[Math.abs(Math.round(x * 3 + z * 7)) % ROTATION_STEPS.length];
}

// hex_road_A is a straight piece connecting two opposite edges (see the pack's own preview - it's
// the only one of the 13 lettered road tiles without a bend/junction). Rotating it to face any one
// of a road cell's own road-neighbors keeps straight stretches visually continuous; bends/
// junctions render with whichever neighbor happens to be picked first, an accepted approximation
// per this feature's scope (see the plan's "roads: keep it simple" note) rather than a full
// edge-aware autotile set.
function roadRotation(cell: PlacedCell, roadCells: Set<string>): number {
  for (const dir of AXIAL_DIRECTIONS) {
    const neighborKey = `${cell.q + dir.q},${cell.r + dir.r}`;
    if (!roadCells.has(neighborKey)) continue;
    const neighborWorld = hexToWorld(cell.q + dir.q, cell.r + dir.r);
    const dx = neighborWorld.x - cell.x;
    const dz = neighborWorld.z - cell.z;
    // hex_road_A's band runs along the tile's local +X axis by default. A THREE rotation.y of θ
    // sends local +X to world (cosθ, -sinθ) - so θ = atan2(-dz, dx) points the band at (dx, dz).
    // Snapped to the nearest 60-degree step so it still tiles cleanly against its neighbors.
    const angle = Math.atan2(-dz, dx);
    const step = Math.round(angle / (Math.PI / 3));
    return step * (Math.PI / 3);
  }
  return 0;
}

function buildKindMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  cells: PlacedCell[],
  rotationOf: (cell: PlacedCell) => number,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(cells.length, 1));
  mesh.count = cells.length;
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scale = new THREE.Vector3(HEX_TILE_SCALE, HEX_TILE_SCALE, HEX_TILE_SCALE);
  const position = new THREE.Vector3();

  cells.forEach((cell, i) => {
    position.set(cell.x, 0, cell.z);
    euler.set(0, rotationOf(cell), 0);
    quaternion.setFromEuler(euler);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(i, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (cells.length > 0) mesh.computeBoundingSphere();

  return mesh;
}

export async function buildHexGround(halfExtent: number): Promise<THREE.Object3D> {
  const [grass, water, road] = await Promise.all([
    loadModelGeometry(MODEL_PATHS.grass),
    loadModelGeometry(MODEL_PATHS.water),
    loadModelGeometry(MODEL_PATHS.road),
  ]);

  const byKind: Record<HexTerrainKind, PlacedCell[]> = { grass: [], water: [], road: [] };
  const roadCells = new Set<string>();

  const rMax = Math.ceil(halfExtent / TILE_ROW_SPACING) + 1;
  for (let r = -rMax; r <= rMax; r++) {
    const qMax = Math.ceil(halfExtent / TILE_WIDTH) + 1 + Math.ceil(Math.abs(r) / 2);
    for (let q = -qMax; q <= qMax; q++) {
      const { x, z } = hexToWorld(q, r);
      if (Math.abs(x) > halfExtent || Math.abs(z) > halfExtent) continue;
      const kind = classifyHexTerrain(q, r);
      const cell: PlacedCell = { q, r, x, z };
      byKind[kind].push(cell);
      if (kind === "road") roadCells.add(`${q},${r}`);
    }
  }

  const group = new THREE.Group();
  group.add(buildKindMesh(grass.geometry, grass.material, byKind.grass, (cell) => deterministicRotation(cell.x, cell.z)));
  group.add(buildKindMesh(water.geometry, water.material, byKind.water, (cell) => deterministicRotation(cell.x, cell.z)));
  group.add(buildKindMesh(road.geometry, road.material, byKind.road, (cell) => roadRotation(cell, roadCells)));
  return group;
}
