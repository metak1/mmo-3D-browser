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
  HexTerrainContent,
  HexTerrainKind,
  HEX_ELEVATION_STEP_WORLD,
  HEX_TILE_SCALE,
  RiverPieceKind,
  RIVER_PIECE_MODEL_PATHS,
  ROAD_PIECE_MODEL_PATHS,
  RoadPieceKind,
  WATER_MODEL_PATH,
} from "@mmo/shared";
import { loadModelGeometry } from "./modelLoader";

// The real KayKit tile models (same ones client/src/game/HexGround.ts renders in the live game),
// not the flat colored placeholders this file used before - built the same way HexGround.ts is,
// down to reusing the exact same shared road-piece-connectivity logic, so a road painted here
// looks identical to (and previews exactly) what players will actually see.

type CoastTileKind = "coastCornerLight" | "coastNarrowEdge" | "coastHalf" | "coastMostly";
const COAST_TILE_KINDS: CoastTileKind[] = ["coastCornerLight", "coastNarrowEdge", "coastHalf", "coastMostly"];

const ROTATION_STEPS = [0, 1, 2, 3, 4, 5].map((n) => (n * Math.PI) / 3);

function deterministicRotation(x: number, z: number): number {
  return ROTATION_STEPS[Math.abs(Math.round(x * 3 + z * 7)) % ROTATION_STEPS.length];
}

// Mirrors client/src/game/HexGround.ts's identical helper - elevation applies to any kind, not
// just grass. Only the ramp mesh (grassRamp below) is grass-specific.
function elevationY(cell: HexCellPlacement): number {
  return cell.elevation * HEX_ELEVATION_STEP_WORLD;
}

function buildKindMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  cells: HexCellPlacement[],
  // Index is passed alongside the cell (most callers ignore it) so a caller whose `cells` array
  // can legitimately contain the SAME cell object more than once - the elevation ramp mesh below,
  // one entry per qualifying low-facing side - can still tell those repeated entries apart. A
  // plain cell->value Map would collapse them all into whichever one was inserted last.
  rotationOf: (cell: HexCellPlacement, index: number) => number,
  yOf: (cell: HexCellPlacement, index: number) => number = () => 0,
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
    position.set(cell.x, yOf(cell, i), cell.z);
    euler.set(0, rotationOf(cell, i), 0);
    quaternion.setFromEuler(euler);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(i, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (cells.length > 0) mesh.computeBoundingSphere();
  return mesh;
}

// Builds the whole preview (real tile models, grouped into one InstancedMesh per kind/piece) for
// a map of this half-extent, classified against `content` - the caller's own fetched-and-filtered
// structures/npcs/waypoints/spawns/boss-arena/portal/hex-tile-overrides for whichever map is
// currently being edited (which may not be the live-active one - see computeHexTerrainGrid's own
// doc comment on why this can't just use the shared live bindings the way HexGround.ts does).
export async function buildHexTerrainPreview(halfExtent: number, content: HexTerrainContent): Promise<THREE.Group> {
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

  const grid = computeHexTerrainGrid(halfExtent, content);

  // A cell can appear more than once in `ramps` (one entry per qualifying low-facing side - see
  // classifyElevationRamps' own doc comment), so rotation is read back by INDEX into this same
  // array below, not through a cell->rotation Map, which would collapse repeated entries for the
  // same cell into whichever one happened to be inserted last.
  const ramps = classifyElevationRamps(grid);
  const rampCellKeys = new Set(ramps.map(({ cell }) => `${cell.q},${cell.r}`));

  const rivers = classifyRiverPieces(grid, content);
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
      elevationY,
    ),
  );
  group.add(
    buildKindMesh(
      grassRamp.geometry,
      grassRamp.material,
      ramps.map(({ cell }) => cell),
      (_cell, i) => ramps[i].rotationRadians,
      // The ramp mesh spans from the LOWER of the two levels it bridges up to the cell's own
      // elevation (see getHexElevation's identical "elevation - 1" math) - not just cell.elevation
      // like every other kind's flat instance, or a ramp between (say) level 2 and 3 would sit at
      // the wrong height, floating at ground level instead of one level up.
      (cell) => (cell.elevation - 1) * HEX_ELEVATION_STEP_WORLD,
    ),
  );
  // See HexGround.ts's identical line - hex_water's wave-crest detail isn't rotationally
  // symmetric like grass's, so every water tile keeps one fixed orientation instead of the
  // per-tile random rotation grass uses for variety.
  group.add(buildKindMesh(water.geometry, water.material, byKind.water, () => 0, elevationY));
  for (const kind of Object.keys(roadCellsByPiece) as RoadPieceKind[]) {
    const placed = roadCellsByPiece[kind];
    const { geometry, material } = roadGeometry[kind];
    const rotationByCell = new Map(placed.map(({ cell, rotation }) => [cell, rotation]));
    group.add(buildKindMesh(geometry, material, placed.map((p) => p.cell), (cell) => rotationByCell.get(cell) ?? 0, elevationY));
  }
  // Coast tiles are hand-placed and hand-rotated (see HexTerrainKind's own doc comment) - each
  // cell already carries its own stored rotation directly, no piece-selection/connectivity step
  // needed at all.
  for (const kind of COAST_TILE_KINDS) {
    group.add(buildKindMesh(coastGeometry[kind].geometry, coastGeometry[kind].material, byKind[kind], (cell) => cell.rotation, elevationY));
  }
  for (const kind of Object.keys(riverCellsByPiece) as RiverPieceKind[]) {
    const cells = riverCellsByPiece[kind];
    const { geometry, material } = riverGeometry[kind];
    group.add(buildKindMesh(geometry, material, cells, (cell) => riverByCell.get(cell)?.rotationRadians ?? 0, elevationY));
  }
  return group;
}
