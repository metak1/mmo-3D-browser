import * as THREE from "three";
import {
  classifyElevationRamps,
  classifyRiverPieces,
  classifyRoadPieces,
  computeHexTerrainGrid,
  COAST_TILE_MODEL_PATHS,
  GRASS_MODEL_PATH,
  GRASS_RAMP_MODEL_PATH,
  HexCellPlacement,
  HexTerrainKind,
  HEX_ELEVATION_STEP_WORLD,
  HEX_TILE_SCALE,
  RiverPieceKind,
  RIVER_PIECE_MODEL_PATHS,
  ROAD_PIECE_MODEL_PATHS,
  RoadPieceKind,
  WATER_MODEL_PATH,
} from "@mmo/shared";
import { loadModelGeometry } from "./models";

type CoastTileKind = "coastCornerLight" | "coastNarrowEdge" | "coastHalf" | "coastMostly";
const COAST_TILE_KINDS: CoastTileKind[] = ["coastCornerLight", "coastNarrowEdge", "coastHalf", "coastMostly"];

// The overworld floor is a mosaic of KayKit hex tiles, driven by shared/src/hex.ts's real (not
// just visual) axial coordinate system, terrain classifier, road-piece connectivity logic, and
// elevation-ramp connectivity logic - grass/water/road/elevation are a genuine gameplay layer
// (water blocks movement, see CombatEngine's blockWaterTerrain), not just paint, and can be
// hand-painted per cell via the admin map editor's tile palette (elevation is procedural-only for
// now). Different kinds/pieces need different geometry/material, so each gets its own
// THREE.InstancedMesh.

// The six 60-degree rotations a regular hexagon's outline is invariant under - applying one per
// grass/water tile (picked deterministically from its own position) breaks up the obvious
// repetition of a single tile model copied thousands of times, without ever producing a visible
// seam between neighbors.
const ROTATION_STEPS = [0, 1, 2, 3, 4, 5].map((n) => (n * Math.PI) / 3);

function deterministicRotation(x: number, z: number): number {
  return ROTATION_STEPS[Math.abs(Math.round(x * 3 + z * 7)) % ROTATION_STEPS.length];
}

function buildKindMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  cells: HexCellPlacement[],
  rotationOf: (cell: HexCellPlacement) => number,
  yOf: (cell: HexCellPlacement) => number = () => 0,
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
    position.set(cell.x, yOf(cell), cell.z);
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
  const [
    grass,
    grassRamp,
    water,
    straight,
    bend120,
    bend60,
    deadEnd,
    junction,
    yJunction,
    tBranchA,
    tBranchB,
    wideFork,
    fourWaySide,
    fourWayDiamond,
    fourWayNearFull,
    fiveWay,
    coastCornerLight,
    coastNarrowEdge,
    coastHalf,
    coastMostly,
    riverStraight,
    riverStraightCurvy,
    riverBend120,
    riverBend60,
    riverYJunction,
    riverTBranchA,
    riverTBranchB,
    riverWideFork,
    riverFourWaySide,
    riverFourWayDiamond,
    riverFourWayNearFull,
    riverFiveWay,
    riverCrossing,
  ] = await Promise.all([
    loadModelGeometry(GRASS_MODEL_PATH),
    loadModelGeometry(GRASS_RAMP_MODEL_PATH),
    loadModelGeometry(WATER_MODEL_PATH),
    loadModelGeometry(ROAD_PIECE_MODEL_PATHS.straight),
    loadModelGeometry(ROAD_PIECE_MODEL_PATHS.bend120),
    loadModelGeometry(ROAD_PIECE_MODEL_PATHS.bend60),
    loadModelGeometry(ROAD_PIECE_MODEL_PATHS.deadEnd),
    loadModelGeometry(ROAD_PIECE_MODEL_PATHS.junction),
    loadModelGeometry(ROAD_PIECE_MODEL_PATHS.yJunction),
    loadModelGeometry(ROAD_PIECE_MODEL_PATHS.tBranchA),
    loadModelGeometry(ROAD_PIECE_MODEL_PATHS.tBranchB),
    loadModelGeometry(ROAD_PIECE_MODEL_PATHS.wideFork),
    loadModelGeometry(ROAD_PIECE_MODEL_PATHS.fourWaySide),
    loadModelGeometry(ROAD_PIECE_MODEL_PATHS.fourWayDiamond),
    loadModelGeometry(ROAD_PIECE_MODEL_PATHS.fourWayNearFull),
    loadModelGeometry(ROAD_PIECE_MODEL_PATHS.fiveWay),
    loadModelGeometry(COAST_TILE_MODEL_PATHS.coastCornerLight),
    loadModelGeometry(COAST_TILE_MODEL_PATHS.coastNarrowEdge),
    loadModelGeometry(COAST_TILE_MODEL_PATHS.coastHalf),
    loadModelGeometry(COAST_TILE_MODEL_PATHS.coastMostly),
    loadModelGeometry(RIVER_PIECE_MODEL_PATHS.straight),
    loadModelGeometry(RIVER_PIECE_MODEL_PATHS.straightCurvy),
    loadModelGeometry(RIVER_PIECE_MODEL_PATHS.bend120),
    loadModelGeometry(RIVER_PIECE_MODEL_PATHS.bend60),
    loadModelGeometry(RIVER_PIECE_MODEL_PATHS.yJunction),
    loadModelGeometry(RIVER_PIECE_MODEL_PATHS.tBranchA),
    loadModelGeometry(RIVER_PIECE_MODEL_PATHS.tBranchB),
    loadModelGeometry(RIVER_PIECE_MODEL_PATHS.wideFork),
    loadModelGeometry(RIVER_PIECE_MODEL_PATHS.fourWaySide),
    loadModelGeometry(RIVER_PIECE_MODEL_PATHS.fourWayDiamond),
    loadModelGeometry(RIVER_PIECE_MODEL_PATHS.fourWayNearFull),
    loadModelGeometry(RIVER_PIECE_MODEL_PATHS.fiveWay),
    loadModelGeometry(RIVER_PIECE_MODEL_PATHS.crossing),
  ]);
  const roadGeometry: Record<RoadPieceKind, { geometry: THREE.BufferGeometry; material: THREE.Material }> = {
    straight,
    bend120,
    bend60,
    deadEnd,
    junction,
    yJunction,
    tBranchA,
    tBranchB,
    wideFork,
    fourWaySide,
    fourWayDiamond,
    fourWayNearFull,
    fiveWay,
  };
  const coastGeometry: Record<CoastTileKind, { geometry: THREE.BufferGeometry; material: THREE.Material }> = {
    coastCornerLight,
    coastNarrowEdge,
    coastHalf,
    coastMostly,
  };
  const riverGeometry: Record<RiverPieceKind, { geometry: THREE.BufferGeometry; material: THREE.Material }> = {
    straight: riverStraight,
    straightCurvy: riverStraightCurvy,
    bend120: riverBend120,
    bend60: riverBend60,
    yJunction: riverYJunction,
    tBranchA: riverTBranchA,
    tBranchB: riverTBranchB,
    wideFork: riverWideFork,
    fourWaySide: riverFourWaySide,
    fourWayDiamond: riverFourWayDiamond,
    fourWayNearFull: riverFourWayNearFull,
    fiveWay: riverFiveWay,
    crossing: riverCrossing,
  };

  const grid = computeHexTerrainGrid(halfExtent);

  const ramps = classifyElevationRamps(grid);
  const rampCellKeys = new Set(ramps.map(({ cell }) => `${cell.q},${cell.r}`));
  const rampRotationByCell = new Map(ramps.map(({ cell, rotationRadians }) => [cell, rotationRadians]));

  const rivers = classifyRiverPieces(grid);
  const riverByCell = new Map(rivers.map((r) => [r.cell, r]));

  const byKind: Record<HexTerrainKind, HexCellPlacement[]> = {
    grass: [],
    water: [],
    road: [],
    river: [],
    coastCornerLight: [],
    coastNarrowEdge: [],
    coastHalf: [],
    coastMostly: [],
  };
  for (const cell of grid) {
    if (cell.kind === "grass") {
      const key = `${cell.q},${cell.r}`;
      if (rampCellKeys.has(key)) continue; // rendered as a ramp piece instead, below
    }
    byKind[cell.kind].push(cell);
  }

  const roadCellsByPiece: Record<RoadPieceKind, { cell: HexCellPlacement; rotation: number }[]> = {
    straight: [],
    bend120: [],
    bend60: [],
    deadEnd: [],
    junction: [],
    yJunction: [],
    tBranchA: [],
    tBranchB: [],
    wideFork: [],
    fourWaySide: [],
    fourWayDiamond: [],
    fourWayNearFull: [],
    fiveWay: [],
  };
  for (const { cell, pieceKind, rotationRadians } of classifyRoadPieces(grid)) {
    roadCellsByPiece[pieceKind].push({ cell, rotation: rotationRadians });
  }

  const riverCellsByPiece: Record<RiverPieceKind, HexCellPlacement[]> = {
    straight: [],
    straightCurvy: [],
    bend120: [],
    bend60: [],
    yJunction: [],
    tBranchA: [],
    tBranchB: [],
    wideFork: [],
    fourWaySide: [],
    fourWayDiamond: [],
    fourWayNearFull: [],
    fiveWay: [],
    crossing: [],
  };
  for (const { cell, pieceKind } of rivers) riverCellsByPiece[pieceKind].push(cell);

  const group = new THREE.Group();
  group.add(
    buildKindMesh(
      grass.geometry,
      grass.material,
      byKind.grass,
      (cell) => deterministicRotation(cell.x, cell.z),
      (cell) => cell.elevation * HEX_ELEVATION_STEP_WORLD,
    ),
  );
  group.add(
    buildKindMesh(grassRamp.geometry, grassRamp.material, ramps.map(({ cell }) => cell), (cell) => rampRotationByCell.get(cell) ?? 0),
  );
  // Unlike grass's plain symmetric hexagon, hex_water's mesh has an off-center wave-crest detail
  // baked in - randomizing its rotation per tile (as grass does for variety) sends that crest
  // pointing a different direction on every tile, fracturing a lake into a field of stray dark
  // spikes instead of one continuous surface. A single fixed orientation for every water tile
  // keeps the crest direction consistent across a whole body of water instead.
  group.add(buildKindMesh(water.geometry, water.material, byKind.water, () => 0));
  for (const kind of Object.keys(roadCellsByPiece) as RoadPieceKind[]) {
    const placed = roadCellsByPiece[kind];
    const { geometry, material } = roadGeometry[kind];
    const rotationByCell = new Map(placed.map(({ cell, rotation }) => [cell, rotation]));
    group.add(buildKindMesh(geometry, material, placed.map((p) => p.cell), (cell) => rotationByCell.get(cell) ?? 0));
  }
  // Coast tiles are hand-placed and hand-rotated (see HexTerrainKind's own doc comment) - each
  // cell already carries its own stored rotation directly, no piece-selection/connectivity step
  // needed at all.
  for (const kind of COAST_TILE_KINDS) {
    group.add(buildKindMesh(coastGeometry[kind].geometry, coastGeometry[kind].material, byKind[kind], (cell) => cell.rotation));
  }
  for (const kind of Object.keys(riverCellsByPiece) as RiverPieceKind[]) {
    const cells = riverCellsByPiece[kind];
    const { geometry, material } = riverGeometry[kind];
    group.add(buildKindMesh(geometry, material, cells, (cell) => riverByCell.get(cell)?.rotationRadians ?? 0));
  }
  return group;
}
