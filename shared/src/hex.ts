// A real (not just visual) hex-grid layer for the overworld: pointy-top axial (q, r) coordinates
// sized to match client/src/game/HexGround.ts's tile mesh exactly, plus a deterministic terrain
// classifier (grass/water/road, each with an elevation level) derived purely from already-authored
// content (STRUCTURES/NPCS/WAYPOINTS/SPAWN_POINTS/BOSS_ARENA_*/PORTAL_POSITION below) plus optional
// hand-painted overrides - no per-cell content is required to exist. Water is the one kind with a
// real gameplay effect (isHexPassable, consumed by CombatEngine's movement resolution); road and
// elevation are purely visual/cosmetic (elevation has no collision effect, matching this game's
// x/z-only collision system).
import {
  BOSS_ARENA_CENTER,
  BOSS_ARENA_RADIUS,
  ENEMY_WANDER_RADIUS,
  HEX_TILE_OVERRIDES,
  NPCS,
  PORTAL_POSITION,
  SPAWN_POINTS,
  STRUCTURES,
  WAYPOINTS,
} from "./types.js";

export const HEX_TILE_SCALE = 2; // must stay in lockstep with HexGround.ts's own TILE_SCALE
export const HEX_CIRCUMRADIUS = 1.1547 * HEX_TILE_SCALE; // native hex_grass circumradius (~1.1547) at scale 1

export interface AxialHex {
  q: number;
  r: number;
}

// The 6 pointy-top axial neighbor offsets, in a fixed order - used both for HexGround.ts's
// road-tile rotation (bearing toward a road-neighbor) and available to any future neighbor-aware
// logic (e.g. coast dressing).
export const AXIAL_DIRECTIONS: AxialHex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

function hexKey(q: number, r: number): string {
  return `${q},${r}`;
}

export function hexToWorld(q: number, r: number): { x: number; z: number } {
  return { x: HEX_CIRCUMRADIUS * Math.sqrt(3) * (q + r / 2), z: HEX_CIRCUMRADIUS * 1.5 * r };
}

// Standard cube-coordinate rounding (axial q,r <-> cube x=q, y=-q-r, z=r) - rounding each
// component independently can violate x+y+z=0, so the component with the largest rounding error
// gets recomputed from the other two instead of also being rounded.
function cubeRound(x: number, y: number, z: number): AxialHex {
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const xDiff = Math.abs(rx - x);
  const yDiff = Math.abs(ry - y);
  const zDiff = Math.abs(rz - z);
  if (xDiff > yDiff && xDiff > zDiff) rx = -ry - rz;
  else if (yDiff > zDiff) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}

export function worldToHex(x: number, z: number): AxialHex {
  const rFrac = z / (HEX_CIRCUMRADIUS * 1.5);
  const qFrac = x / (HEX_CIRCUMRADIUS * Math.sqrt(3)) - rFrac / 2;
  return cubeRound(qFrac, -qFrac - rFrac, rFrac);
}

export function hexDistance(a: AxialHex, b: AxialHex): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

function hexLine(a: AxialHex, b: AxialHex): AxialHex[] {
  const n = hexDistance(a, b);
  const cells: AxialHex[] = [];
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    const q = a.q + (b.q - a.q) * t;
    const r = a.r + (b.r - a.r) * t;
    cells.push(cubeRound(q, -q - r, r));
  }
  return cells;
}

// "river" is hand-painted only (via HEX_TILE_OVERRIDES, same as any other override) - no
// procedural generation channel decides it. Blocks movement like water (see isHexPassable) and,
// like road, renders as its own connected-network piece (see classifyRiverPieces) with grass
// already baked into the piece's own border, not a separate base tile underneath.
// The coastCornerLight/coastNarrowEdge/coastHalf/coastMostly kinds are hand-painted shoreline
// dressing pieces (KayKit hex_coast_A/B/C/D) - not blocking, walked over like plain grass. Unlike
// every other kind, these read a per-cell rotation stored on the override itself (see
// HexTileOverrideDef.rotation) rather than computing one from neighbors - there's no automatic
// placement for coast tiles at all, they're placed and rotated entirely by hand in the admin map
// editor (an earlier automatic-placement system existed here and was removed - it kept needing
// one-off fixes for edge cases that hand-placement sidesteps entirely).
export type HexTerrainKind =
  | "grass"
  | "water"
  | "road"
  | "river"
  | "coastCornerLight"
  | "coastNarrowEdge"
  | "coastHalf"
  | "coastMostly";

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function terrainHash(ix: number, iz: number, hashA: number, hashB: number): number {
  const s = Math.sin(ix * hashA + iz * hashB) * 43758.5453123;
  return s - Math.floor(s);
}

// Bilinear-interpolated value noise at one frequency, in [0,1) - a generic version of the noise
// technique the old (now-removed) continuous terrain-height system used, parameterized by hash
// constants so independent "channels" (lakes, hills) never correlate with each other.
function valueNoise2D(x: number, z: number, hashA: number, hashB: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const sx = smoothstep(x - x0);
  const sz = smoothstep(z - z0);
  const n00 = terrainHash(x0, z0, hashA, hashB);
  const n10 = terrainHash(x0 + 1, z0, hashA, hashB);
  const n01 = terrainHash(x0, z0 + 1, hashA, hashB);
  const n11 = terrainHash(x0 + 1, z0 + 1, hashA, hashB);
  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sz;
}

// Own hash constants/phase per channel so lakes and hills never correlate with each other.
const LAKE_HASH_A = 157.3;
const LAKE_HASH_B = 271.9;
const LAKE_WAVELENGTH = 45; // world units per noise feature - tuned for pond-sized lakes, not oceans
const LAKE_WATER_THRESHOLD = 0.28; // fraction of the map's "wilderness" area that ends up water

const HILL_HASH_A = 89.7;
const HILL_HASH_B = 193.1;
const HILL_WAVELENGTH = 55; // broader than lakes - a handful of rounded hill regions, not a fine jagged pattern
// Nested thresholds against the same noise value - since each band's region is a strict subset of
// the one below it (higher noise value implies every lower threshold is also cleared), this
// naturally produces terraced, contour-ring hills where a cell's neighbor is almost always the
// same level or one level different, matching the one ramp asset's fixed one-level-rise shape (see
// HEX_MAX_ELEVATION/classify below). [0] matches the original single-tier HILL_THRESHOLD, roughly
// preserving how much of the map reads as "hilly" at all; each band above it is progressively
// rarer/smaller, like a real hill's summit being narrower than its base.
const HILL_LEVEL_THRESHOLDS = [0.62, 0.74, 0.86];
export const HEX_MAX_ELEVATION = HILL_LEVEL_THRESHOLDS.length; // 3 - 4 total bands (0-3)

function hillElevationFromNoise(noise: number): number {
  let level = 0;
  for (const threshold of HILL_LEVEL_THRESHOLDS) {
    if (noise <= threshold) break;
    level++;
  }
  return level;
}

interface PointLike {
  x: number;
  z: number;
}
interface StructureLike extends PointLike {
  width: number;
  depth: number;
}

// Everything the classifier reads content from, bundled so it can be overridden - the live game
// (server/client) always uses the default (the STRUCTURES/NPCS/WAYPOINTS/SPAWN_POINTS/BOSS_ARENA_*/
// PORTAL_POSITION bindings below, populated by loadGameContent), but the admin map editor previews
// maps that aren't necessarily the currently-ACTIVE one loadGameContent filters everything to - it
// passes its own fetched-and-filtered content instead, the same explicit-parameter/live-default
// pattern getTerrainHeight already uses for STRUCTURES.
interface OverrideLike {
  q: number;
  r: number;
  kind: HexTerrainKind;
  rotation?: number;
  // Unset means "flat, ground level" (0) - the same default this cell would already have had
  // before elevation overrides existed, so a tile painted without ever touching this field looks
  // identical to before. Applies to any kind - only classifyElevationRamps' ramp mesh is
  // grass-specific, a raised water/road/river/coast tile just sits at its own height instead.
  elevation?: number;
  // Only meaningful on a "grass" cell with elevation > 0 - overrides classifyElevationRamps' own
  // automatic direction-finding (findAllLowNeighborDirs) with a single admin-chosen direction
  // instead, for a cell whose auto-computed ramp doesn't face the way it should (or that has no
  // qualifying lower neighbor to auto-ramp toward at all). Unset means "keep computing
  // automatically" - the same default behavior a cell already had before this field existed, so a
  // tile painted without ever touching this field looks identical to before. Deliberately not
  // reusing the `rotation` field above - that one's already coast-specific, and 0 is a valid ramp
  // direction, so the two need to stay distinguishable as "unset" vs "explicitly facing index 0".
  rampRotation?: number;
}

export interface HexTerrainContent {
  structures: StructureLike[];
  npcs: PointLike[];
  waypoints: PointLike[];
  spawns: PointLike[];
  bossArenaCenter: PointLike;
  bossArenaRadius: number;
  portalPosition: PointLike;
  // Hand-painted cells (admin/src/mapEditor's tile palette) - see classify()'s "overrides win
  // first" ordering. Defaults to none if omitted, so every existing HexTerrainContent-builder
  // that predates this field still compiles and behaves exactly as before.
  overrides?: OverrideLike[];
}

function liveContent(): HexTerrainContent {
  return {
    structures: STRUCTURES,
    npcs: Object.values(NPCS),
    waypoints: WAYPOINTS,
    spawns: SPAWN_POINTS,
    bossArenaCenter: BOSS_ARENA_CENTER,
    bossArenaRadius: BOSS_ARENA_RADIUS,
    portalPosition: PORTAL_POSITION,
    overrides: HEX_TILE_OVERRIDES,
  };
}

// Guarantees land within a buffer of everything already hand-placed, so no existing town/spawn/
// waypoint/quest content ever gets a lake dropped on it. Buffers mirror TERRAIN_FLATTEN_RADIUS
// (types.ts), the same "6 units past the footprint" convention already used for the old
// structure-flattening pass.
const CONTENT_LAND_BUFFER = 6;
const PORTAL_LAND_BUFFER = 8; // a fresh character's overworld spawn point - never water

function isNearProtectedContent(x: number, z: number, content: HexTerrainContent): boolean {
  for (const s of content.structures) {
    if (Math.hypot(x - s.x, z - s.z) <= Math.max(s.width, s.depth) / 2 + CONTENT_LAND_BUFFER) return true;
  }
  for (const n of content.npcs) {
    if (Math.hypot(x - n.x, z - n.z) <= CONTENT_LAND_BUFFER) return true;
  }
  for (const w of content.waypoints) {
    if (Math.hypot(x - w.x, z - w.z) <= CONTENT_LAND_BUFFER) return true;
  }
  for (const spawn of content.spawns) {
    if (Math.hypot(x - spawn.x, z - spawn.z) <= ENEMY_WANDER_RADIUS + 4) return true;
  }
  const arena = content.bossArenaCenter;
  if (Math.hypot(x - arena.x, z - arena.z) <= content.bossArenaRadius + CONTENT_LAND_BUFFER) return true;
  const portal = content.portalPosition;
  if (Math.hypot(x - portal.x, z - portal.z) <= PORTAL_LAND_BUFFER) return true;
  return false;
}

// Connects every waypoint location (one per town/landmark) via a minimum spanning tree (Prim's -
// trivial at the handful of waypoints this game has) so the road network touches every town with
// no redundant crossings, then draws each MST edge into hex cells via a straight hex line.
function computeRoadCells(waypoints: PointLike[]): Set<string> {
  const nodes = waypoints.map((w) => worldToHex(w.x, w.z));
  const cells = new Set<string>();
  if (nodes.length >= 2) {
    const inTree = new Set<number>([0]);
    while (inTree.size < nodes.length) {
      let bestFrom = -1;
      let bestTo = -1;
      let bestDist = Infinity;
      for (const i of inTree) {
        for (let j = 0; j < nodes.length; j++) {
          if (inTree.has(j)) continue;
          const dist = hexDistance(nodes[i], nodes[j]);
          if (dist < bestDist) {
            bestDist = dist;
            bestFrom = i;
            bestTo = j;
          }
        }
      }
      if (bestTo === -1) break;
      for (const cell of hexLine(nodes[bestFrom], nodes[bestTo])) cells.add(hexKey(cell.q, cell.r));
      inTree.add(bestTo);
    }
  }
  return cells;
}

interface OverrideEntry {
  kind: HexTerrainKind;
  rotation: number;
  elevation: number;
  // Left as undefined (not defaulted like the fields above) when the admin never set it - see
  // OverrideLike.rampRotation's own doc comment for why "unset" and "explicitly 0" must stay
  // distinguishable here.
  rampRotation: number | undefined;
}

function buildOverridesMap(overrides: OverrideLike[] | undefined): Map<string, OverrideEntry> {
  const map = new Map<string, OverrideEntry>();
  for (const o of overrides ?? []) {
    map.set(hexKey(o.q, o.r), { kind: o.kind, rotation: o.rotation ?? 0, elevation: o.elevation ?? 0, rampRotation: o.rampRotation });
  }
  return map;
}

// Cached wrappers over the live bindings only (WAYPOINTS / HEX_TILE_OVERRIDES) - see
// resetHexTerrainCache. Admin's per-map preview (computeHexTerrainGrid with an explicit `content`)
// recomputes both fresh each call instead, since it may be a different, non-live map.
let roadCellsCache: Set<string> | null = null;
let overridesCache: Map<string, OverrideEntry> | null = null;

function getLiveRoadCells(): Set<string> {
  if (!roadCellsCache) roadCellsCache = computeRoadCells(WAYPOINTS);
  return roadCellsCache;
}

function getLiveOverrides(): Map<string, OverrideEntry> {
  if (!overridesCache) overridesCache = buildOverridesMap(HEX_TILE_OVERRIDES);
  return overridesCache;
}

// An admin's hand-painted cell wins first (even over the procedural road network - it's a
// deliberate, authoritative placement), then roads (so a road can cross what would otherwise be
// lake territory without a gap), then the land-buffer guarantee, then noise-based lake placement
// for whatever's left. Elevation applies to a genuine wilderness grass cell via a second,
// independent noise channel (see hillElevationFromNoise), or to a hand-painted override that set
// its own elevation explicitly (see OverrideLike's own doc comment) - never to road/river/coast/
// protected-content grass, which always sit at the baseline.
interface Classified {
  kind: HexTerrainKind;
  elevation: number; // 0 (baseline) .. HEX_MAX_ELEVATION
  // Only ever non-zero for a hand-painted coast* override - see HexTileOverrideDef's own doc
  // comment. Every procedurally classified cell (grass/water/road/river/hill noise) is 0.
  rotation: number;
  // Set only by a hand-painted override that explicitly chose a manual ramp direction (see
  // OverrideLike.rampRotation) - undefined everywhere else, including every procedurally
  // classified cell, so classifyElevationRamps below knows to keep auto-computing for them.
  rampRotation?: number;
}

function classify(
  q: number,
  r: number,
  content: HexTerrainContent,
  roadCells: Set<string>,
  overrides: Map<string, OverrideEntry>,
): Classified {
  const overridden = overrides.get(hexKey(q, r));
  if (overridden) {
    return {
      kind: overridden.kind,
      elevation: overridden.elevation,
      rotation: overridden.rotation,
      rampRotation: overridden.rampRotation,
    };
  }
  if (roadCells.has(hexKey(q, r))) return { kind: "road", elevation: 0, rotation: 0 };
  const { x, z } = hexToWorld(q, r);
  if (isNearProtectedContent(x, z, content)) return { kind: "grass", elevation: 0, rotation: 0 };
  const isWater = valueNoise2D(x / LAKE_WAVELENGTH, z / LAKE_WAVELENGTH, LAKE_HASH_A, LAKE_HASH_B) < LAKE_WATER_THRESHOLD;
  if (isWater) return { kind: "water", elevation: 0, rotation: 0 };
  const hillNoise = valueNoise2D(x / HILL_WAVELENGTH, z / HILL_WAVELENGTH, HILL_HASH_A, HILL_HASH_B);
  return { kind: "grass", elevation: hillElevationFromNoise(hillNoise), rotation: 0 };
}

// The live game's classified cell for (q, r) - always the currently-ACTIVE map's own content
// (STRUCTURES etc.), cached (see resetHexTerrainCache). Backs classifyHexTerrain, isHexPassable,
// and getHexElevation's live (no-content-override) path, so a cell already classified for one
// purpose isn't reclassified for another.
const classifiedCache = new Map<string, Classified>();

function getLiveClassified(q: number, r: number): Classified {
  const key = hexKey(q, r);
  let cached = classifiedCache.get(key);
  if (!cached) {
    cached = classify(q, r, liveContent(), getLiveRoadCells(), getLiveOverrides());
    classifiedCache.set(key, cached);
  }
  return cached;
}

export function classifyHexTerrain(q: number, r: number): HexTerrainKind {
  return getLiveClassified(q, r).kind;
}

// A coast piece's water dip isn't a straight cut in reality (KayKit's own meshes have an
// irregular shoreline curve per piece), but a single straight line through the cell - at a
// per-kind depth chosen so the blocked area matches that piece's REAL water-vs-land triangle
// area from its own mesh (measured directly off each hex_coast_*.gltf's top-surface faces, then
// converted to this cutline via numeric integration over a regular hex) - reads close enough in
// play to the actual shoreline, without needing full per-triangle collision against 4 separate
// meshes on every movement tick. All 4 pieces share one native-orientation convention (water
// sits toward local +Z at rotation 0, mirroring how ramps treat local -X as their own "high"
// side - see getHexElevation), which the placed cell's own `rotation` field then reorients same
// as everything else about a coast tile already does.
const COAST_WATER_LOCAL_Z_THRESHOLD: Record<"coastCornerLight" | "coastNarrowEdge" | "coastHalf" | "coastMostly", number> = {
  coastCornerLight: 0.24,
  coastNarrowEdge: -0.38,
  coastHalf: -0.57,
  coastMostly: -0.88,
};

export function isHexPassable(x: number, z: number): boolean {
  const { q, r } = worldToHex(x, z);
  const here = getLiveClassified(q, r);
  if (here.kind === "water" || here.kind === "river") return false;

  const threshold = (COAST_WATER_LOCAL_Z_THRESHOLD as Record<string, number | undefined>)[here.kind];
  if (threshold === undefined) return true;

  // Same world-delta -> rotated-local-frame transform getHexElevation's ramp interpolation
  // already uses for localX (dx*cos - dz*sin) - localZ is that same rotation matrix's other row.
  const center = hexToWorld(q, r);
  const dx = x - center.x;
  const dz = z - center.z;
  const cos = Math.cos(here.rotation);
  const sin = Math.sin(here.rotation);
  const localZ = (dx * sin + dz * cos) / HEX_TILE_SCALE;
  return localZ <= threshold;
}

// content omitted: the live (cached) elevation at this world position. content provided: freshly
// computed against that content instead - the admin map editor's per-map preview, which may not
// be the currently-ACTIVE map (see HexTerrainContent's own doc comment on why that matters).
//
// Smoothly interpolated within a ramp cell, rather than the flat integer level a plain per-cell
// lookup would give - otherwise a player's Y position would snap a full level the instant
// worldToHex rounds them onto the elevated cell, instead of climbing the slope they're actually
// walking across. Non-ramp cells (flat baseline, or fully interior to a hill) still return a
// plain integer level - there's nothing to interpolate there.
export function getHexElevation(x: number, z: number, content?: HexTerrainContent): number {
  const { q, r } = worldToHex(x, z);
  const roadCells = content ? computeRoadCells(content.waypoints) : getLiveRoadCells();
  const overrides = content ? buildOverridesMap(content.overrides) : getLiveOverrides();
  const classifyAt = (cq: number, cr: number): Classified =>
    content ? classify(cq, cr, content, roadCells, overrides) : getLiveClassified(cq, cr);

  const here = classifyAt(q, r);
  if (here.kind !== "grass" || here.elevation <= 0) return here.elevation;
  // No ramp here unless an admin explicitly placed one (see classifyElevationRamps' own doc
  // comment) - a plain elevated cell with no override is a flat top, nothing to interpolate.
  if (here.rampRotation === undefined) return here.elevation;
  const rotation = here.rampRotation;

  // Undo the ramp mesh's own placement (rotation, then HEX_TILE_SCALE) to get the position in the
  // ramp's local frame, matching GRASS_RAMP_MODEL_PATH's own doc comment: flat (t=0) at local -X,
  // one full level up (t=1) at local +X, native x spanning [-1, 1].
  const center = hexToWorld(q, r);
  const dx = x - center.x;
  const dz = z - center.z;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const localX = (dx * cos - dz * sin) / HEX_TILE_SCALE;
  const t = Math.min(1, Math.max(0, (localX + 1) / 2));
  return here.elevation - 1 + t;
}

// Same content-optional pattern as getHexElevation above, but returns the whole classified cell
// (kind/elevation/rotation) rather than just an interpolated height - the admin map editor's
// raise/lower terrain tool uses this to read a cell's current elevation (procedural or already
// hand-painted) before incrementing/decrementing it, since it needs the plain per-cell integer
// level, not a ramp-interpolated in-between value.
export function classifyHexCell(q: number, r: number, content?: HexTerrainContent): Classified {
  if (!content) return getLiveClassified(q, r);
  return classify(q, r, content, computeRoadCells(content.waypoints), buildOverridesMap(content.overrides));
}

// Must be called whenever the content this classifier reads from changes - loadGameContent
// (types.ts) calls this after reassigning STRUCTURES/NPCS/WAYPOINTS/SPAWN_POINTS/BOSS_ARENA_*/
// PORTAL_POSITION, since reloadGameContent() runs live on every admin CRUD mutation, not just
// once at boot.
export function resetHexTerrainCache(): void {
  roadCellsCache = null;
  overridesCache = null;
  classifiedCache.clear();
}

export interface HexCellPlacement {
  q: number;
  r: number;
  x: number;
  z: number;
  kind: HexTerrainKind;
  elevation: number;
  rotation: number;
  rampRotation?: number;
}

// Native-unit rise per elevation level (matches hex_grass_sloped_high's own modeled height - see
// this module's file-level Scope notes), and the world-space equivalent every renderer actually
// positions instances with (HEX_TILE_SCALE already applies to x/z, elevation needs the same factor).
export const HEX_ELEVATION_STEP = 1;
export const HEX_ELEVATION_STEP_WORLD = HEX_ELEVATION_STEP * HEX_TILE_SCALE;

// Model paths both client/src/game/HexGround.ts and admin/src/mapEditor's tile preview load - the
// same files live under each app's own public/models/hexagon/ (see each app's own README/comment
// on why: two static-asset roots, one Vite dev server each, no cross-app serving).
export const GRASS_MODEL_PATH = "/models/hexagon/hex_grass.gltf";
export const WATER_MODEL_PATH = "/models/hexagon/hex_water.gltf";
// A single tile whose top surface is flat (y=0) at its local -X edge (AXIAL_DIRECTIONS index 3)
// and one full level up (y=+1) at its local +X edge (index 0) - vertex-inspected directly since
// the pack ships no metadata. hex_grass_sloped_low (a shorter, half-level ramp) exists too but is
// unused - this game only has one elevation tier, see this module's Scope notes.
export const GRASS_RAMP_MODEL_PATH = "/models/hexagon/hex_grass_sloped_high.gltf";

// The pack's 13 lettered road pieces have no descriptive metadata - which edges each one connects
// was determined empirically (rendered every letter with a marker on each of the 6 axial
// directions, then dense-sampled which edges the road texture actually touches at each marker,
// the same technique used for coast pieces). All 13 turn out to exactly cover every possible
// neighbor-count/arrangement up to rotation (proved by enumerating every composition of 6 into
// 1-6 positive parts and matching each to one of these 13 direction-sets), keyed here by the
// *default* (unrotated) set of AXIAL_DIRECTIONS indices each one connects:
// - deadEnd (M): a single edge (a stub ending mid-tile) - 1 neighbor.
// - bend60 (C)/bend120 (B)/straight (A): edges 60/120/180 degrees apart - 2 neighbors.
// - yJunction (D): 3 edges 120 degrees apart (symmetric Y) - 3 neighbors, gap pattern (2,2,2).
// - wideFork (G): 3 consecutive edges spanning 120 degrees - 3 neighbors, gap pattern (1,1,4).
// - tBranchA (E) / tBranchB (F): a straight-through pair plus one branch offset to one side - 3
//   neighbors, gap pattern (1,2,3) - the one genuinely chiral case in this set (its mirror image
//   is NOT reachable by rotating the same mesh), which is exactly why the pack ships both: F's
//   direction-set is precisely E's mirrored across the 0-3 axis. No geometric flipping needed -
//   picking whicheverof E/F actually matches (see pickRoadPiece) covers both real-world cases.
// - fourWaySide (H): a straight-through pair plus two adjacent branches on one side - 4 neighbors,
//   gap pattern (2,1,1,2).
// - fourWayDiamond (I): every direction except one opposite pair - 4 neighbors, gap pattern
//   (1,2,1,2).
// - fourWayNearFull (J): every direction except one adjacent pair - 4 neighbors, gap pattern
//   (3,1,1,1).
// - fiveWay (K): every direction but one - 5 neighbors.
// - junction (L): all 6 edges - 6 neighbors (and the defensive fallback for anything unexpected).
export type RoadPieceKind =
  | "straight"
  | "bend120"
  | "bend60"
  | "deadEnd"
  | "junction"
  | "yJunction"
  | "wideFork"
  | "tBranchA"
  | "tBranchB"
  | "fourWaySide"
  | "fourWayDiamond"
  | "fourWayNearFull"
  | "fiveWay";

export const ROAD_PIECE_MODEL_PATHS: Record<RoadPieceKind, string> = {
  straight: "/models/hexagon/hex_road_A.gltf",
  bend120: "/models/hexagon/hex_road_B.gltf",
  bend60: "/models/hexagon/hex_road_C.gltf",
  yJunction: "/models/hexagon/hex_road_D.gltf",
  tBranchA: "/models/hexagon/hex_road_E.gltf",
  tBranchB: "/models/hexagon/hex_road_F.gltf",
  wideFork: "/models/hexagon/hex_road_G.gltf",
  fourWaySide: "/models/hexagon/hex_road_H.gltf",
  fourWayDiamond: "/models/hexagon/hex_road_I.gltf",
  fourWayNearFull: "/models/hexagon/hex_road_J.gltf",
  fiveWay: "/models/hexagon/hex_road_K.gltf",
  junction: "/models/hexagon/hex_road_L.gltf",
  deadEnd: "/models/hexagon/hex_road_M.gltf",
};

const ROAD_PIECE_DEFAULT_DIRS: Record<RoadPieceKind, number[]> = {
  straight: [0, 3],
  bend120: [1, 3],
  bend60: [2, 3],
  deadEnd: [3],
  junction: [0, 1, 2, 3, 4, 5],
  yJunction: [1, 3, 5],
  tBranchA: [0, 1, 3],
  tBranchB: [0, 3, 5],
  wideFork: [2, 3, 4],
  fourWaySide: [0, 2, 3, 4],
  fourWayDiamond: [1, 2, 4, 5],
  fourWayNearFull: [0, 3, 4, 5],
  fiveWay: [1, 2, 3, 4, 5],
};

// Finds the rotation step r (0-5, each step = 60 degrees) such that rotating a piece's default
// connected-direction set by r exactly reproduces targetDirs. A mesh rotation.y of r*(pi/3) shifts
// every connected AXIAL_DIRECTIONS index by +r (mod 6): rotation.y=theta sends local +X (index 0
// by convention) to world angle -theta, and AXIAL_DIRECTIONS index d sits at world angle -60*d, so
// the two conventions agree exactly on r = theta/60deg.
function findRoadRotationSteps(defaultDirs: number[], targetDirs: number[]): number {
  const targetSet = new Set(targetDirs);
  for (let r = 0; r < 6; r++) {
    const rotated = defaultDirs.map((d) => (d + r) % 6);
    if (rotated.length === targetSet.size && rotated.every((d) => targetSet.has(d))) return r;
  }
  return 0; // no exact match (only reachable for the junction catch-all, which needs no rotation)
}

// Same rotation search as findRoadRotationSteps, but distinguishes "matched at r=0" from "no
// rotation reproduces targetDirs at all" - needed by pickRoadPiece's 3/4/5-neighbor search below,
// which tries several candidate pieces per neighbor count and must know when to move on to the
// next one instead of wrongly accepting a size-only coincidence.
function findExactRotation(defaultDirs: number[], targetDirs: number[]): number | null {
  if (defaultDirs.length !== targetDirs.length) return null;
  const targetSet = new Set(targetDirs);
  for (let r = 0; r < 6; r++) {
    if (defaultDirs.every((d) => targetSet.has((d + r) % 6))) return r;
  }
  return null;
}

// Every RoadPieceKind whose neighbor count is 3, 4, or 5, in the order pickRoadPiece tries them -
// see ROAD_PIECE_MODEL_PATHS' doc comment for why exactly one of these always matches.
const THREE_WAY_KINDS: RoadPieceKind[] = ["yJunction", "wideFork", "tBranchA", "tBranchB"];
const FOUR_WAY_KINDS: RoadPieceKind[] = ["fourWaySide", "fourWayDiamond", "fourWayNearFull"];
const FIVE_WAY_KINDS: RoadPieceKind[] = ["fiveWay"];

// Picks which of the 13 road pieces fits a cell's actual road-neighbors, and the rotation to
// align it. A 2-neighbor cell's gap (1, 2, or 3 steps apart) maps 1:1 to bend60/bend120/straight;
// 3/4/5-neighbor cells search their respective candidate list (see ROAD_PIECE_MODEL_PATHS' doc
// comment - every real-world arrangement matches exactly one candidate, up to rotation); a
// 6-neighbor cell (or, defensively, anything that matches no candidate) always uses junction.
function pickRoadPiece(neighborDirs: number[]): { kind: RoadPieceKind; rotationSteps: number } {
  if (neighborDirs.length === 0) return { kind: "deadEnd", rotationSteps: 0 };
  if (neighborDirs.length === 1) {
    return { kind: "deadEnd", rotationSteps: findRoadRotationSteps(ROAD_PIECE_DEFAULT_DIRS.deadEnd, neighborDirs) };
  }
  if (neighborDirs.length === 2) {
    const [a, b] = neighborDirs;
    const diff = Math.abs(a - b);
    const gap = Math.min(diff, 6 - diff); // 1, 2, or 3
    const kind: RoadPieceKind = gap === 3 ? "straight" : gap === 2 ? "bend120" : "bend60";
    return { kind, rotationSteps: findRoadRotationSteps(ROAD_PIECE_DEFAULT_DIRS[kind], neighborDirs) };
  }
  const candidates =
    neighborDirs.length === 3 ? THREE_WAY_KINDS : neighborDirs.length === 4 ? FOUR_WAY_KINDS : FIVE_WAY_KINDS;
  for (const kind of candidates) {
    const rotationSteps = findExactRotation(ROAD_PIECE_DEFAULT_DIRS[kind], neighborDirs);
    if (rotationSteps !== null) return { kind, rotationSteps };
  }
  return { kind: "junction", rotationSteps: 0 };
}

export interface PlacedRoadPiece {
  cell: HexCellPlacement;
  pieceKind: RoadPieceKind;
  rotationRadians: number;
}

// Scans every road cell's own neighbors (within the same grid) to pick its piece + rotation - the
// one place this empirically-derived connectivity logic lives, so client/src/game/HexGround.ts and
// admin/src/mapEditor's tile preview render identically-connected roads instead of each
// implementing (and risking drifting out of sync on) their own copy.
export function classifyRoadPieces(grid: HexCellPlacement[]): PlacedRoadPiece[] {
  const roadCells = new Set<string>();
  for (const cell of grid) if (cell.kind === "road") roadCells.add(hexKey(cell.q, cell.r));

  const placed: PlacedRoadPiece[] = [];
  for (const cell of grid) {
    if (cell.kind !== "road") continue;
    const neighborDirs: number[] = [];
    AXIAL_DIRECTIONS.forEach((dir, index) => {
      if (roadCells.has(hexKey(cell.q + dir.q, cell.r + dir.r))) neighborDirs.push(index);
    });
    const { kind, rotationSteps } = pickRoadPiece(neighborDirs);
    placed.push({ cell, pieceKind: kind, rotationRadians: rotationSteps * (Math.PI / 3) });
  }
  return placed;
}

export interface PlacedElevationRamp {
  cell: HexCellPlacement;
  rotationRadians: number;
}

// A ramp (GRASS_RAMP_MODEL_PATH) only ever appears where an admin explicitly placed one via the
// map editor's Ramp tool + rotate gizmo (OverrideLike.rampRotation) - there is no automatic
// direction-finding anymore. A grass cell with elevation > 0 and no rampRotation set just renders
// as a flat elevated block with a bare cliff edge on every side (see the renderer, not here).
export function classifyElevationRamps(grid: HexCellPlacement[]): PlacedElevationRamp[] {
  const ramps: PlacedElevationRamp[] = [];
  for (const cell of grid) {
    // The ramp mesh is a grass-specific piece (GRASS_RAMP_MODEL_PATH) - a non-grass cell (e.g. a
    // hand-painted road override that happens to carry a leftover elevation value) must never
    // reach here, or the renderer would place a floating grass ramp on top of its own kind's mesh
    // (see HexGround.ts's per-kind instance loop, which only skips the flat grass instance for
    // cells in this list - it doesn't know or care what kind a ramp entry claims to be for).
    if (cell.kind !== "grass" || cell.elevation <= 0) continue;
    if (cell.rampRotation === undefined) continue;
    // Already a final mesh rotation in radians (set via the map editor's rotate gizmo, the same
    // way a coast tile's rotation already is), not a direction index to convert.
    ramps.push({ cell, rotationRadians: cell.rampRotation });
  }
  return ramps;
}

// The 4 coast shoreline pieces, now placed and rotated entirely by hand (see HexTerrainKind's own
// doc comment) - no connectivity/tier-selection logic left at all, just a plain kind->model map
// the renderer looks up directly. hex_coast_E (unused) turned out to carry zero water in it at
// all - a dry sand/dune patch, not a shoreline blend - so it was never worth exposing.
export const COAST_TILE_MODEL_PATHS: Record<"coastCornerLight" | "coastNarrowEdge" | "coastHalf" | "coastMostly", string> = {
  coastCornerLight: "/models/hexagon/hex_coast_A.gltf",
  coastNarrowEdge: "/models/hexagon/hex_coast_B.gltf",
  coastHalf: "/models/hexagon/hex_coast_C.gltf",
  coastMostly: "/models/hexagon/hex_coast_D.gltf",
};

// The pack's 12 lettered river pieces plus 2 road-crossing variants - researched with the exact
// same technique as the road pieces (directional markers + edge-sampling), and it turns out rivers
// use precisely the same 12 shapes roads do (straight/bend60/bend120/yJunction/wideFork/
// tBranchA+B/fourWaySide/fourWayDiamond/fourWayNearFull/fiveWay - see RoadPieceKind's own doc
// comment for what each shape covers), minus roads' single-edge deadEnd and all-6-edge junction
// (a river realistically never dead-ends or crosses itself 6 ways) plus one addition: A_curvy, a
// second "straight" mesh with a meandering rather than ruler-straight channel, for the same "don't
// stamp one shape everywhere" variety grass/water rotation already provides elsewhere.
export type RiverPieceKind =
  | "straight"
  | "straightCurvy"
  | "bend120"
  | "bend60"
  | "yJunction"
  | "wideFork"
  | "tBranchA"
  | "tBranchB"
  | "fourWaySide"
  | "fourWayDiamond"
  | "fourWayNearFull"
  | "fiveWay"
  | "crossing";

export const RIVER_PIECE_MODEL_PATHS: Record<RiverPieceKind, string> = {
  straight: "/models/hexagon/hex_river_A.gltf",
  straightCurvy: "/models/hexagon/hex_river_A_curvy.gltf",
  bend120: "/models/hexagon/hex_river_B.gltf",
  bend60: "/models/hexagon/hex_river_C.gltf",
  yJunction: "/models/hexagon/hex_river_D.gltf",
  tBranchA: "/models/hexagon/hex_river_E.gltf",
  tBranchB: "/models/hexagon/hex_river_F.gltf",
  wideFork: "/models/hexagon/hex_river_G.gltf",
  fourWaySide: "/models/hexagon/hex_river_H.gltf",
  fourWayDiamond: "/models/hexagon/hex_river_I.gltf",
  fourWayNearFull: "/models/hexagon/hex_river_J.gltf",
  fiveWay: "/models/hexagon/hex_river_K.gltf",
  // hex_river_crossing_B (unused) is the same idea but with the road visibly stopping short on
  // each bank instead of continuing across - presumably meant to be paired with a separately
  // admin-placed bridge structure (see Structure.ts's building_bridge_A/B, imported in this same
  // pass). crossing_A needs no extra placement, so it's the one used automatically here.
  crossing: "/models/hexagon/hex_river_crossing_A.gltf",
};

const RIVER_PIECE_DEFAULT_DIRS: Record<RiverPieceKind, number[]> = {
  straight: [0, 3],
  straightCurvy: [0, 3],
  bend120: [1, 3],
  bend60: [2, 3],
  yJunction: [1, 3, 5],
  tBranchA: [0, 1, 3],
  tBranchB: [0, 3, 5],
  wideFork: [2, 3, 4],
  fourWaySide: [0, 2, 3, 4],
  fourWayDiamond: [1, 2, 4, 5],
  fourWayNearFull: [0, 3, 4, 5],
  fiveWay: [1, 2, 3, 4, 5],
  crossing: [0, 3],
};

const RIVER_THREE_WAY_KINDS: RiverPieceKind[] = ["yJunction", "wideFork", "tBranchA", "tBranchB"];
const RIVER_FOUR_WAY_KINDS: RiverPieceKind[] = ["fourWaySide", "fourWayDiamond", "fourWayNearFull"];

// Picks which river piece fits a cell's actual river-neighbors, and the rotation to align it -
// structurally identical to pickRoadPiece (see its own doc comment), except: a 2-neighbor cell
// picks between straight/straightCurvy (a position hash, purely cosmetic variety, same trick
// deterministicRotation plays for plain grass/water) instead of always the one mesh, and there's
// no dedicated piece for 0/1/6 neighbors (see RiverPieceKind's own doc comment on why) - those
// defensively fall back to a straight piece, oriented toward the single neighbor if there is one.
function pickRiverPiece(
  neighborDirs: number[],
  cellX: number,
  cellZ: number,
): { kind: RiverPieceKind; rotationSteps: number } {
  if (neighborDirs.length === 0) return { kind: "straight", rotationSteps: 0 };
  if (neighborDirs.length === 1) {
    return { kind: "straight", rotationSteps: findRoadRotationSteps([3], neighborDirs) };
  }
  if (neighborDirs.length === 2) {
    const [a, b] = neighborDirs;
    const diff = Math.abs(a - b);
    const gap = Math.min(diff, 6 - diff);
    const kind: RiverPieceKind =
      gap === 3 ? (Math.abs(Math.round(cellX * 5 + cellZ * 11)) % 2 === 0 ? "straight" : "straightCurvy") : gap === 2 ? "bend120" : "bend60";
    return { kind, rotationSteps: findRoadRotationSteps(RIVER_PIECE_DEFAULT_DIRS[kind], neighborDirs) };
  }
  const candidates = neighborDirs.length === 3 ? RIVER_THREE_WAY_KINDS : neighborDirs.length === 4 ? RIVER_FOUR_WAY_KINDS : ["fiveWay" as const];
  for (const kind of candidates) {
    const rotationSteps = findExactRotation(RIVER_PIECE_DEFAULT_DIRS[kind], neighborDirs);
    if (rotationSteps !== null) return { kind, rotationSteps };
  }
  return { kind: "fiveWay", rotationSteps: 0 }; // 6-neighbor, or a defensive fallback
}

export interface PlacedRiverPiece {
  cell: HexCellPlacement;
  pieceKind: RiverPieceKind;
  rotationRadians: number;
}

// Scans every river cell's own neighbors (within the same grid) to pick its piece + rotation -
// mirrors classifyRoadPieces exactly, plus one addition: a river cell that's also part of the road
// network (see computeRoadCells) swaps in the crossing piece instead, so the road visually
// continues through it rather than just vanishing where the two networks meet. Only handles the
// 2-neighbor "straight" case - a river bend/junction/fork cell that happens to also be a road cell
// has no matching crossing asset (the pack ships none), so it defensively just renders as a normal
// river piece there (the road cosmetically breaks for that one cell - roads have no gameplay effect
// either way, see this module's own top-of-file doc comment).
export function classifyRiverPieces(grid: HexCellPlacement[], content?: HexTerrainContent): PlacedRiverPiece[] {
  const kindByKey = new Map<string, HexTerrainKind>();
  for (const cell of grid) kindByKey.set(hexKey(cell.q, cell.r), cell.kind);
  const roadCellKeys = content ? computeRoadCells(content.waypoints) : getLiveRoadCells();

  const placed: PlacedRiverPiece[] = [];
  for (const cell of grid) {
    if (cell.kind !== "river") continue;

    const neighborDirs: number[] = [];
    AXIAL_DIRECTIONS.forEach((dir, index) => {
      if (kindByKey.get(hexKey(cell.q + dir.q, cell.r + dir.r)) === "river") neighborDirs.push(index);
    });

    // The crossing asset only exists for the straight (opposite-edge) case - a bend/junction cell
    // that also happens to be a road cell has no matching crossing shape, so it's excluded here
    // and falls through to a normal river piece instead (see this function's own doc comment).
    const isStraight =
      neighborDirs.length === 2 && Math.min(Math.abs(neighborDirs[0] - neighborDirs[1]), 6 - Math.abs(neighborDirs[0] - neighborDirs[1])) === 3;
    const isCrossing = isStraight && roadCellKeys.has(hexKey(cell.q, cell.r));
    const { kind, rotationSteps } = isCrossing
      ? { kind: "crossing" as RiverPieceKind, rotationSteps: findRoadRotationSteps(RIVER_PIECE_DEFAULT_DIRS.crossing, neighborDirs) }
      : pickRiverPiece(neighborDirs, cell.x, cell.z);
    placed.push({ cell, pieceKind: kind, rotationRadians: rotationSteps * (Math.PI / 3) });
  }
  return placed;
}

// Every in-bounds hex cell for a map of this half-extent, classified - the same bounding-box scan
// HexGround.ts (client) used to do inline, now shared so the admin map editor's preview (which
// passes its own fetched-and-filtered `content` for whichever map it's currently showing, not
// necessarily the live ACTIVE one) can build the identical grid without duplicating this loop or
// the road-network computation.
export function computeHexTerrainGrid(halfExtent: number, content?: HexTerrainContent): HexCellPlacement[] {
  const resolvedContent = content ?? liveContent();
  const roadCells = content ? computeRoadCells(content.waypoints) : getLiveRoadCells();
  const overrides = content ? buildOverridesMap(content.overrides) : getLiveOverrides();

  const rowSpacing = HEX_CIRCUMRADIUS * 1.5;
  const colWidth = HEX_CIRCUMRADIUS * Math.sqrt(3);
  const cells: HexCellPlacement[] = [];

  const rMax = Math.ceil(halfExtent / rowSpacing) + 1;
  for (let r = -rMax; r <= rMax; r++) {
    const qMax = Math.ceil(halfExtent / colWidth) + 1 + Math.ceil(Math.abs(r) / 2);
    for (let q = -qMax; q <= qMax; q++) {
      const { x, z } = hexToWorld(q, r);
      if (Math.abs(x) > halfExtent || Math.abs(z) > halfExtent) continue;
      cells.push({ q, r, x, z, ...classify(q, r, resolvedContent, roadCells, overrides) });
    }
  }
  return cells;
}
