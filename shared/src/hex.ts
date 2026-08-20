// A real (not just visual) hex-grid layer for the overworld: pointy-top axial (q, r) coordinates
// sized to match client/src/game/HexGround.ts's tile mesh exactly, plus a deterministic terrain
// classifier (grass/water/road) derived purely from already-authored content (STRUCTURES/NPCS/
// WAYPOINTS/SPAWN_POINTS/BOSS_ARENA_*/PORTAL_POSITION below) - no new DB table, no hand-authored
// per-cell content. Water is the one kind with a real gameplay effect (isHexPassable, consumed by
// CombatEngine's movement resolution); road is purely a visual/cosmetic distinction. Elevation is
// deliberately not part of this - see Scene.ts's setTerrainFlat(true) for why.
import {
  BOSS_ARENA_CENTER,
  BOSS_ARENA_RADIUS,
  ENEMY_WANDER_RADIUS,
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

export type HexTerrainKind = "grass" | "water" | "road";

// A second, independent value-noise field from the old elevation noise (rawTerrainHeight in
// types.ts, frozen/irrelevant now that terrain is always flat) - own hash constants and phase, so
// lake placement doesn't accidentally correlate with where hills used to be.
const LAKE_HASH_A = 157.3;
const LAKE_HASH_B = 271.9;
const LAKE_WAVELENGTH = 45; // world units per noise feature - tuned for pond-sized lakes, not oceans
const LAKE_WATER_THRESHOLD = 0.28; // fraction of the map's "wilderness" area that ends up water

function lakeHash(ix: number, iz: number): number {
  const s = Math.sin(ix * LAKE_HASH_A + iz * LAKE_HASH_B) * 43758.5453123;
  return s - Math.floor(s);
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lakeNoise(x: number, z: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const sx = smoothstep(x - x0);
  const sz = smoothstep(z - z0);
  const n00 = lakeHash(x0, z0);
  const n10 = lakeHash(x0 + 1, z0);
  const n01 = lakeHash(x0, z0 + 1);
  const n11 = lakeHash(x0 + 1, z0 + 1);
  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sz;
}

// Guarantees land within a buffer of everything already hand-placed, so no existing town/spawn/
// waypoint/quest content ever gets a lake dropped on it. Buffers mirror TERRAIN_FLATTEN_RADIUS
// (types.ts), the same "6 units past the footprint" convention already used for the old
// structure-flattening pass.
const CONTENT_LAND_BUFFER = 6;
const PORTAL_LAND_BUFFER = 8; // a fresh character's overworld spawn point - never water

function isNearProtectedContent(x: number, z: number): boolean {
  for (const s of STRUCTURES) {
    if (Math.hypot(x - s.x, z - s.z) <= Math.max(s.width, s.depth) / 2 + CONTENT_LAND_BUFFER) return true;
  }
  for (const n of Object.values(NPCS)) {
    if (Math.hypot(x - n.x, z - n.z) <= CONTENT_LAND_BUFFER) return true;
  }
  for (const w of WAYPOINTS) {
    if (Math.hypot(x - w.x, z - w.z) <= CONTENT_LAND_BUFFER) return true;
  }
  for (const spawn of SPAWN_POINTS) {
    if (Math.hypot(x - spawn.x, z - spawn.z) <= ENEMY_WANDER_RADIUS + 4) return true;
  }
  if (Math.hypot(x - BOSS_ARENA_CENTER.x, z - BOSS_ARENA_CENTER.z) <= BOSS_ARENA_RADIUS + CONTENT_LAND_BUFFER) return true;
  if (Math.hypot(x - PORTAL_POSITION.x, z - PORTAL_POSITION.z) <= PORTAL_LAND_BUFFER) return true;
  return false;
}

// Connects every WAYPOINTS location (one per town/landmark) via a minimum spanning tree (Prim's -
// trivial at the handful of waypoints this game has) so the road network touches every town with
// no redundant crossings, then draws each MST edge into hex cells via a straight hex line. Pure
// function of WAYPOINTS, recomputed lazily and cached - see resetHexTerrainCache.
let roadCellsCache: Set<string> | null = null;

function getRoadCells(): Set<string> {
  if (roadCellsCache) return roadCellsCache;

  const nodes = WAYPOINTS.map((w) => worldToHex(w.x, w.z));
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

  roadCellsCache = cells;
  return cells;
}

// Roads win first (so a road can cross what would otherwise be lake territory without a gap),
// then the land-buffer guarantee, then noise-based lake placement for whatever's left.
export function classifyHexTerrain(q: number, r: number): HexTerrainKind {
  if (getRoadCells().has(hexKey(q, r))) return "road";
  const { x, z } = hexToWorld(q, r);
  if (isNearProtectedContent(x, z)) return "grass";
  return lakeNoise(x / LAKE_WAVELENGTH, z / LAKE_WAVELENGTH) < LAKE_WATER_THRESHOLD ? "water" : "grass";
}

const passabilityCache = new Map<string, boolean>();

export function isHexPassable(x: number, z: number): boolean {
  const { q, r } = worldToHex(x, z);
  const key = hexKey(q, r);
  let cached = passabilityCache.get(key);
  if (cached === undefined) {
    cached = classifyHexTerrain(q, r) !== "water";
    passabilityCache.set(key, cached);
  }
  return cached;
}

// Must be called whenever the content this classifier reads from changes - loadGameContent
// (types.ts) calls this after reassigning STRUCTURES/NPCS/WAYPOINTS/SPAWN_POINTS/BOSS_ARENA_*/
// PORTAL_POSITION, since reloadGameContent() runs live on every admin CRUD mutation, not just
// once at boot.
export function resetHexTerrainCache(): void {
  roadCellsCache = null;
  passabilityCache.clear();
}
