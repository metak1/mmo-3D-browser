import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import {
  classifyHexCell,
  COAST_TILE_MODEL_PATHS,
  findStructureLoops,
  FurnitureKind,
  getHexElevation,
  GRASS_RAMP_MODEL_PATH,
  hexToWorld,
  HexTerrainContent,
  HexTerrainKind,
  HEX_ELEVATION_STEP_WORLD,
  HEX_MAX_ELEVATION,
  HEX_TILE_SCALE,
  setTerrainMode,
  StructureDef,
  worldToHex,
} from "@mmo/shared";
import { ENTITIES } from "../entities";
import { EntityForm } from "../EntityForm";
import { createEntity, deleteEntity, listEntities, updateEntity } from "../api";
import { BUILDING_MODEL_PATH, buildEnclosureShape, buildStructureShape, populateBuildingShape } from "./structureGeometry";
import { populateFurnitureShape } from "./furnitureGeometry";
import { populateNpcShape } from "./npcGeometry";
import { loadModelGeometry } from "./modelLoader";
import { buildHexTerrainPreview } from "./hexTerrainPreview";

type RowData = Record<string, unknown>;
type SelectableType =
  | "structures"
  | "npcs"
  | "enemy-spawns"
  | "enemy-spawn-zones"
  | "waypoints"
  | "respawn-points"
  | "furniture"
  | "hex-tiles"
  | "gathering-nodes"
  // Not list entities like the others - each is one of the active map's own single point fields
  // (portal_x/z or spawn_x/z), always rendered rather than placed/deleted (see the two always-on
  // markers built in the content-sync effect below and their special-cased commitTransformRef
  // branches, since a drag here PATCHes "maps", not a list row of its own). Two distinct
  // SelectableTypes rather than one generic "maps" so the marker/inspector/commit code can tell
  // which field a given drag/edit belongs to - see mapPointField().
  | "map-portal"
  | "map-spawn";
type GizmoMode = "translate" | "rotate" | "scale";

interface Selected {
  type: SelectableType;
  row: RowData;
}

// Both "map-portal" and "map-spawn" resolve to the same "maps" table/entity underneath (they're
// two fields on one map row, not rows of their own) - centralizing that mapping here so every
// call site that needs the real table name (updateEntity/ENTITIES lookup) or the field pair to
// read/write agrees, rather than re-deriving it ad hoc in four different places.
function isMapPointType(type: SelectableType): type is "map-portal" | "map-spawn" {
  return type === "map-portal" || type === "map-spawn";
}
function mapEntityKey(type: SelectableType): string {
  return isMapPointType(type) ? "maps" : type;
}

// A "tool" is what a click in the 3D view does while it's active: paint/erase a hex tile, or drop
// a new furniture piece - a real placement tool (Unity tile-palette/prefab-drop style), not the
// existing "+ button creates at (0,0), then drag it" round-trip every other entity still uses.
// null means normal click-to-select behavior.
type ActiveTool =
  | { mode: "tile"; tileKind: HexTerrainKind | "erase" }
  | { mode: "furniture"; furnitureKind: FurnitureKind }
  | { mode: "structure"; structureModelId: string }
  | { mode: "lamp"; lampModelId: string }
  | { mode: "wallKind"; wallKind: (typeof STRUCTURE_KINDS)[number] }
  | { mode: "marker"; markerKind: "npc" | "enemy-spawn" | "waypoint" | "respawn-point" | "gathering-node" }
  | { mode: "zone" }
  | { mode: "elevation"; level: number }
  | { mode: "ramp" }
  | null;

// Thumbnails are real renders of the actual placed model/tile (same offline three.js-preview
// technique used all session for asset research), not colored placeholders - so the palette shows
// players what they're actually about to place. Erase has no 3D representation, so it keeps a
// plain swatch/icon instead of a thumbnail image.
// The 4 coast tiles paint at rotation 0 (the model's own default orientation) - to actually face
// the water, click the placed tile (once no tool is active - see the pointerdown handler's
// hex-tile-selection fallback) and set its Rotation field in the inspector that appears. There's
// no automatic placement/rotation for these at all - see HexTerrainKind's own doc comment on why.
const TILE_PALETTE: { tileKind: HexTerrainKind | "erase"; label: string; thumbnail?: string }[] = [
  { tileKind: "grass", label: "Grass", thumbnail: "/thumbnails/thumb_grass.png" },
  { tileKind: "water", label: "Water", thumbnail: "/thumbnails/thumb_water.png" },
  { tileKind: "road", label: "Road", thumbnail: "/thumbnails/thumb_road.png" },
  { tileKind: "river", label: "River", thumbnail: "/thumbnails/thumb_river.png" },
  { tileKind: "coastCornerLight", label: "Coast (Corner)", thumbnail: "/thumbnails/thumb_coastCornerLight.png" },
  { tileKind: "coastNarrowEdge", label: "Coast (Narrow)", thumbnail: "/thumbnails/thumb_coastNarrowEdge.png" },
  { tileKind: "coastHalf", label: "Coast (Half)", thumbnail: "/thumbnails/thumb_coastHalf.png" },
  { tileKind: "coastMostly", label: "Coast (Mostly)", thumbnail: "/thumbnails/thumb_coastMostly.png" },
  { tileKind: "erase", label: "Erase" },
];

// One button per height band (0..HEX_MAX_ELEVATION) - clicking sets a cell directly to that level
// (see placeAtRef's "elevation" branch), rather than nudging it up/down one click at a time. Works
// on any tile kind (grass, water, road, river, coast) - only the kind's own vertical position
// changes, whatever it already was stays as it was. Swatch colors form a light-to-dark ramp so the
// palette itself reads as a little height key; they have no other meaning. Only a "grass" cell
// ever gets a sloped ramp toward a lower neighbor (the only ramp shape the asset pack has) - every
// other kind, and any grass cell set more than one level away from a neighbor, just renders as a
// flat instance at its own height with a plain (unramped) edge, so building a smooth grass hill
// still means working outward one band at a time (see each button's title).
const ELEVATION_LEVEL_COLORS = ["#5a6b3a", "#7ec850", "#a3e068", "#c8f080", "#e8f5a8", "#fff7c0"];
const ELEVATION_LEVEL_PALETTE: { level: number; label: string; color: string; title: string }[] = Array.from(
  { length: HEX_MAX_ELEVATION + 1 },
  (_, level) => ({
    level,
    label: level === 0 ? "Ground Level" : `Elevation ${level}`,
    color: ELEVATION_LEVEL_COLORS[level % ELEVATION_LEVEL_COLORS.length],
    title:
      level === 0
        ? "Sets the clicked cell to flat ground level, whatever kind it already is."
        : `Sets the clicked cell to elevation ${level}, whatever kind it already is - only grass gets a ramp toward a neighbor one level lower; a bigger gap or a non-grass tile just gets a plain unramped edge.`,
  }),
);

const FURNITURE_PALETTE: { furnitureKind: FurnitureKind; label: string; thumbnail: string }[] = [
  { furnitureKind: "table", label: "Table", thumbnail: "/thumbnails/thumb_table.png" },
  { furnitureKind: "chair", label: "Chair", thumbnail: "/thumbnails/thumb_chair.png" },
  { furnitureKind: "barrel", label: "Barrel", thumbnail: "/thumbnails/thumb_barrel.png" },
  { furnitureKind: "crate", label: "Crate", thumbnail: "/thumbnails/thumb_crate.png" },
  { furnitureKind: "bookshelf", label: "Bookshelf", thumbnail: "/thumbnails/thumb_bookshelf.png" },
];

// Nature decoration - placed exactly like furniture (same FurnitureKind values, same DB
// table/route, same click-to-place tool), just a visually separate palette section since these
// are outdoor overworld dressing rather than indoor dungeon props. Every kind in this palette (and
// NATURE_PALETTE/PROPS_PALETTE below) blocks movement - see shared's FURNITURE_FOOTPRINT/
// getFurnitureColliders - unlike FURNITURE_PALETTE's indoor kinds, which stay walk-through.
const DECORATION_PALETTE: { furnitureKind: FurnitureKind; label: string; thumbnail: string; title?: string }[] = [
  { furnitureKind: "hill", label: "Hill", thumbnail: "/thumbnails/thumb_hill.png" },
  { furnitureKind: "rock", label: "Rock A", thumbnail: "/thumbnails/thumb_rock.png" },
  { furnitureKind: "rockB", label: "Rock B", thumbnail: "/thumbnails/thumb_rockB.png" },
  { furnitureKind: "rockC", label: "Rock C", thumbnail: "/thumbnails/thumb_rockC.png" },
  { furnitureKind: "rockD", label: "Rock D", thumbnail: "/thumbnails/thumb_rockD.png" },
  { furnitureKind: "rockE", label: "Rock E", thumbnail: "/thumbnails/thumb_rockE.png" },
  { furnitureKind: "tree", label: "Tree", thumbnail: "/thumbnails/thumb_tree.png" },
  { furnitureKind: "mountainA", label: "Mountain A", thumbnail: "/thumbnails/thumb_mountainA.png" },
  { furnitureKind: "mountainB", label: "Mountain B", thumbnail: "/thumbnails/thumb_mountainB.png" },
  { furnitureKind: "mountainC", label: "Mountain C", thumbnail: "/thumbnails/thumb_mountainC.png" },
];

// Bigger terrain-dressing pieces (multi-hill clusters, tree clusters, mountain+grass/trees
// variants, clouds, water-surface plants) - split out from DECORATION_PALETTE into its own section
// purely to keep that one scannable, not because these place any differently (still
// toggleFurnitureTool + the same furniture-mode click-to-place path). Every kind here blocks
// movement (see DECORATION_PALETTE's own doc comment) except cloudBig/cloudSmall - floating sky
// decoration stays walk-through, see shared's FURNITURE_FOOTPRINT for why.
const NATURE_PALETTE: { furnitureKind: FurnitureKind; label: string; thumbnail: string; title?: string }[] = [
  { furnitureKind: "hillB", label: "Hill B", thumbnail: "/thumbnails/thumb_hillB.png" },
  { furnitureKind: "hillC", label: "Hill C", thumbnail: "/thumbnails/thumb_hillC.png" },
  { furnitureKind: "hillsA", label: "Hills A", thumbnail: "/thumbnails/thumb_hillsA.png" },
  { furnitureKind: "hillsATrees", label: "Hills A (Trees)", thumbnail: "/thumbnails/thumb_hillsATrees.png" },
  { furnitureKind: "hillsB", label: "Hills B", thumbnail: "/thumbnails/thumb_hillsB.png" },
  { furnitureKind: "hillsBTrees", label: "Hills B (Trees)", thumbnail: "/thumbnails/thumb_hillsBTrees.png" },
  { furnitureKind: "hillsC", label: "Hills C", thumbnail: "/thumbnails/thumb_hillsC.png" },
  { furnitureKind: "hillsCTrees", label: "Hills C (Trees)", thumbnail: "/thumbnails/thumb_hillsCTrees.png" },
  { furnitureKind: "treeB", label: "Tree B", thumbnail: "/thumbnails/thumb_treeB.png" },
  { furnitureKind: "treeACut", label: "Tree A Stump", thumbnail: "/thumbnails/thumb_treeACut.png" },
  { furnitureKind: "treeBCut", label: "Tree B Stump", thumbnail: "/thumbnails/thumb_treeBCut.png" },
  { furnitureKind: "treesACut", label: "Trees A (Cut)", thumbnail: "/thumbnails/thumb_treesACut.png" },
  { furnitureKind: "treesALarge", label: "Trees A (Large)", thumbnail: "/thumbnails/thumb_treesALarge.png" },
  { furnitureKind: "treesAMedium", label: "Trees A (Medium)", thumbnail: "/thumbnails/thumb_treesAMedium.png" },
  { furnitureKind: "treesASmall", label: "Trees A (Small)", thumbnail: "/thumbnails/thumb_treesASmall.png" },
  { furnitureKind: "treesBCut", label: "Trees B (Cut)", thumbnail: "/thumbnails/thumb_treesBCut.png" },
  { furnitureKind: "treesBLarge", label: "Trees B (Large)", thumbnail: "/thumbnails/thumb_treesBLarge.png" },
  { furnitureKind: "treesBMedium", label: "Trees B (Medium)", thumbnail: "/thumbnails/thumb_treesBMedium.png" },
  { furnitureKind: "treesBSmall", label: "Trees B (Small)", thumbnail: "/thumbnails/thumb_treesBSmall.png" },
  {
    furnitureKind: "mountainAGrass",
    label: "Mountain A (Grass)",
    thumbnail: "/thumbnails/thumb_mountainAGrass.png",
    title: "Blocks movement",
  },
  {
    furnitureKind: "mountainAGrassTrees",
    label: "Mountain A (Grass+Trees)",
    thumbnail: "/thumbnails/thumb_mountainAGrassTrees.png",
    title: "Blocks movement",
  },
  {
    furnitureKind: "mountainBGrass",
    label: "Mountain B (Grass)",
    thumbnail: "/thumbnails/thumb_mountainBGrass.png",
    title: "Blocks movement",
  },
  {
    furnitureKind: "mountainBGrassTrees",
    label: "Mountain B (Grass+Trees)",
    thumbnail: "/thumbnails/thumb_mountainBGrassTrees.png",
    title: "Blocks movement",
  },
  {
    furnitureKind: "mountainCGrass",
    label: "Mountain C (Grass)",
    thumbnail: "/thumbnails/thumb_mountainCGrass.png",
    title: "Blocks movement",
  },
  {
    furnitureKind: "mountainCGrassTrees",
    label: "Mountain C (Grass+Trees)",
    thumbnail: "/thumbnails/thumb_mountainCGrassTrees.png",
    title: "Blocks movement",
  },
  { furnitureKind: "cloudBig", label: "Cloud (Big)", thumbnail: "/thumbnails/thumb_cloudBig.png" },
  { furnitureKind: "cloudSmall", label: "Cloud (Small)", thumbnail: "/thumbnails/thumb_cloudSmall.png" },
  { furnitureKind: "waterlilyA", label: "Waterlily A", thumbnail: "/thumbnails/thumb_waterlilyA.png" },
  { furnitureKind: "waterlilyB", label: "Waterlily B", thumbnail: "/thumbnails/thumb_waterlilyB.png" },
  { furnitureKind: "waterplantA", label: "Water Plant A", thumbnail: "/thumbnails/thumb_waterplantA.png" },
  { furnitureKind: "waterplantB", label: "Water Plant B", thumbnail: "/thumbnails/thumb_waterplantB.png" },
  { furnitureKind: "waterplantC", label: "Water Plant C", thumbnail: "/thumbnails/thumb_waterplantC.png" },
];

// KayKit Medieval Hexagon Pack's own standalone prop set - distinct FurnitureKind names from the
// Dungeon Pack's barrel/crate (see FurnitureKind's own doc comment) since they're visually a
// different pack, but placed exactly the same way.
const PROPS_PALETTE: { furnitureKind: FurnitureKind; label: string; thumbnail: string }[] = [
  { furnitureKind: "hexBarrel", label: "Barrel", thumbnail: "/thumbnails/thumb_hexBarrel.png" },
  { furnitureKind: "bucketArrows", label: "Bucket (Arrows)", thumbnail: "/thumbnails/thumb_bucketArrows.png" },
  { furnitureKind: "bucketEmpty", label: "Bucket (Empty)", thumbnail: "/thumbnails/thumb_bucketEmpty.png" },
  { furnitureKind: "bucketWater", label: "Bucket (Water)", thumbnail: "/thumbnails/thumb_bucketWater.png" },
  { furnitureKind: "hexCrateBigA", label: "Crate A (Big)", thumbnail: "/thumbnails/thumb_hexCrateBigA.png" },
  { furnitureKind: "hexCrateSmallA", label: "Crate A (Small)", thumbnail: "/thumbnails/thumb_hexCrateSmallA.png" },
  { furnitureKind: "hexCrateBigB", label: "Crate B (Big)", thumbnail: "/thumbnails/thumb_hexCrateBigB.png" },
  { furnitureKind: "hexCrateSmallB", label: "Crate B (Small)", thumbnail: "/thumbnails/thumb_hexCrateSmallB.png" },
  { furnitureKind: "hexCrateLongA", label: "Crate (Long A)", thumbnail: "/thumbnails/thumb_hexCrateLongA.png" },
  { furnitureKind: "hexCrateLongB", label: "Crate (Long B)", thumbnail: "/thumbnails/thumb_hexCrateLongB.png" },
  { furnitureKind: "hexCrateLongC", label: "Crate (Long C)", thumbnail: "/thumbnails/thumb_hexCrateLongC.png" },
  { furnitureKind: "hexCrateLongEmpty", label: "Crate (Long, Empty)", thumbnail: "/thumbnails/thumb_hexCrateLongEmpty.png" },
  { furnitureKind: "hexCrateOpen", label: "Crate (Open)", thumbnail: "/thumbnails/thumb_hexCrateOpen.png" },
  { furnitureKind: "flagBlue", label: "Flag (Blue)", thumbnail: "/thumbnails/thumb_flagBlue.png" },
  { furnitureKind: "flagGreen", label: "Flag (Green)", thumbnail: "/thumbnails/thumb_flagGreen.png" },
  { furnitureKind: "flagRed", label: "Flag (Red)", thumbnail: "/thumbnails/thumb_flagRed.png" },
  { furnitureKind: "flagYellow", label: "Flag (Yellow)", thumbnail: "/thumbnails/thumb_flagYellow.png" },
  { furnitureKind: "ladder", label: "Ladder", thumbnail: "/thumbnails/thumb_ladder.png" },
  { furnitureKind: "pallet", label: "Pallet", thumbnail: "/thumbnails/thumb_pallet.png" },
  { furnitureKind: "resourceLumber", label: "Lumber", thumbnail: "/thumbnails/thumb_resourceLumber.png" },
  { furnitureKind: "resourceStone", label: "Stone", thumbnail: "/thumbnails/thumb_resourceStone.png" },
  { furnitureKind: "sack", label: "Sack", thumbnail: "/thumbnails/thumb_sack.png" },
  { furnitureKind: "archeryTarget", label: "Target", thumbnail: "/thumbnails/thumb_archeryTarget.png" },
  { furnitureKind: "tent", label: "Tent", thumbnail: "/thumbnails/thumb_tent.png" },
  { furnitureKind: "weaponrack", label: "Weapon Rack", thumbnail: "/thumbnails/thumb_weaponrack.png" },
  { furnitureKind: "wheelbarrow", label: "Wheelbarrow", thumbnail: "/thumbnails/thumb_wheelbarrow.png" },
];

// "lamp" isn't here - it has its own LAMP_PALETTE/toggleLampTool instead, since (unlike
// wall/door/tower/gate's single interchangeable shape) it has two distinct visual variants an
// admin needs to see and pick between. wall/door/tower/gate share this one list/swatch-based
// WALL_PALETTE below (see its own comment) rather than each getting a real thumbnail, since
// they're plain tinted boxes with no distinct geometry to render.
const STRUCTURE_KINDS = ["wall", "door", "tower", "gate"] as const;

// Swatch tint per kind purely so the four buttons are visually distinguishable at a glance in the
// palette grid - these colors have no other meaning (the actual placed structure always starts
// with the shared "#8a6d4b" wood-brown default, same as before this list existed).
const WALL_KIND_SWATCH: Record<(typeof STRUCTURE_KINDS)[number], string> = {
  wall: "#6b7a99",
  door: "#8a6d4b",
  tower: "#7d6b99",
  gate: "#c9a63c",
};

const WALL_PALETTE: { wallKind: (typeof STRUCTURE_KINDS)[number]; label: string }[] = STRUCTURE_KINDS.map((wallKind) => ({
  wallKind,
  label: wallKind[0].toUpperCase() + wallKind.slice(1),
}));

// Enemy spawns/waypoints/gathering nodes are just a position - no footprint, no visual variety of
// their own - so this palette mirrors their in-scene marker balls (buildMarker/SPAWN_MARKER_COLOR
// etc.) with a round swatch instead of a thumbnail, same reasoning WALL_PALETTE uses flat swatches
// over renders. NPCs get a real model in-scene (populateNpcShape) but keep the same round swatch
// here in the placement toolbar - a tiny yellow ball is still a fine "place an NPC" tool icon.
const MARKER_PALETTE: { markerKind: "npc" | "enemy-spawn" | "waypoint" | "respawn-point" | "gathering-node"; label: string; color: string }[] = [
  { markerKind: "npc", label: "NPC", color: "#f5d76e" },
  { markerKind: "enemy-spawn", label: "Enemy Spawn", color: "#e05a4e" },
  { markerKind: "waypoint", label: "Waypoint", color: "#f5c451" },
  { markerKind: "respawn-point", label: "Respawn Point", color: "#a78bfa" },
  { markerKind: "gathering-node", label: "Gathering Node", color: "#7bc47f" },
];

// A zone is placed with these defaults and then configured in the inspector (pick its enemy type
// pool, tune population/radius) - the same "place then configure" flow buildings/lamps already
// use, rather than asking for every field up front. Radius/population land somewhere reasonable
// for a small cluster; enemy_type_ids starts empty (spawnZoneMember on the server treats an empty
// pool as "not configured yet" and simply spawns nothing until the admin picks types).
const ZONE_DEFAULT_RADIUS = 6;
const ZONE_DEFAULT_MAX_POPULATION = 3;
const ZONE_MARKER_COLOR = 0xe0503c;

// Generated from BUILDING_MODEL_PATH's own keys rather than hand-typed, so a future model added
// there automatically appears here too. Labels are derived, not hand-authored, for the same
// reason - see prettifyBuildingLabel below.
const BUILDING_COLOR_WORDS = new Set(["blue", "green", "red", "yellow"]);
const BUILDING_WORD_ALIASES: Record<string, string> = {
  archeryrange: "Archery Range",
  lumbermill: "Lumber Mill",
  watermill: "Water Mill",
};

function prettifyBuildingLabel(modelId: string): string {
  const parts = modelId.replace(/^building_/, "").split("_");
  const color = parts.length > 1 && BUILDING_COLOR_WORDS.has(parts[parts.length - 1]) ? parts.pop()! : null;
  const words = parts.map(
    (w) => BUILDING_WORD_ALIASES[w] ?? (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)),
  );
  const base = words.join(" ");
  return color ? `${base} (${color[0].toUpperCase()}${color.slice(1)})` : base;
}

const BUILDING_PALETTE: { modelId: string; label: string; thumbnail: string }[] = Object.keys(BUILDING_MODEL_PATH).map(
  (modelId) => ({ modelId, label: prettifyBuildingLabel(modelId), thumbnail: `/thumbnails/thumb_${modelId}.png` }),
);

// Lamps are procedural (see structureGeometry.ts's buildLamp), not a real loaded model like
// BUILDING_PALETTE's entries - but placed the exact same click-to-place way, via the same
// kind:"structure" DB row shape (see placeAtRef's own "lamp" tool branch), just with kind:"lamp"
// and modelId picking which of the two procedural variants to build instead of which glTF to load.
const LAMP_PALETTE: { modelId: string; label: string; thumbnail: string; width: number; depth: number; height: number; yOffset: number }[] = [
  { modelId: "lampPost", label: "Lamp Post", thumbnail: "/thumbnails/thumb_lampPost.png", width: 0.5, depth: 0.5, height: 3.5, yOffset: 0 },
  // Defaults already lifted off the ground (see buildLampCeiling's own comment on why a lamp with
  // no post needs yOffset raised to actually read as "hanging" rather than floating at ground
  // level) - an admin can still drag it up/down further via the gizmo afterward.
  { modelId: "lampCeiling", label: "Ceiling Lamp", thumbnail: "/thumbnails/thumb_lampCeiling.png", width: 0.3, depth: 0.3, height: 2, yOffset: 2.5 },
];

const SPAWN_MARKER_COLOR = 0xe05a4e;
const WAYPOINT_MARKER_COLOR = 0xf5c451;
const RESPAWN_POINT_MARKER_COLOR = 0xa78bfa;
const PORTAL_MARKER_COLOR = 0x4ac0e8; // matches PortalAvatar's own in-game color (client/src/game/Portal.ts)
const CHARACTER_SPAWN_MARKER_COLOR = 0xffa552;
const GATHERING_NODE_MARKER_COLOR = 0x7bc47f;
const GRID_COLOR = 0x4a5578;
const GRID_COLOR_DARK = 0x3a4260;

function round(n: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

function toStructureDefs(rows: RowData[]): StructureDef[] {
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ""),
    mapId: String(row.map_id),
    kind: row.kind as StructureDef["kind"],
    x: Number(row.x),
    z: Number(row.z),
    rotationY: Number(row.rotation_y ?? 0),
    width: Number(row.width),
    depth: Number(row.depth),
    height: Number(row.height),
    color: String(row.color ?? "#8a6d4b"),
    yOffset: Number(row.y_offset ?? 0),
    modelId: row.model_id != null ? String(row.model_id) : undefined,
    lightIntensity: row.light_intensity != null ? Number(row.light_intensity) : undefined,
  }));
}

// One small colored marker (no fancy glyph texture like the game's NpcAvatar - this is a
// placement tool, not the game itself) for entities that are just a position, no footprint.
// Wrapped in a group (mesh kept at a local offset) so the caller can position the group's own
// y from terrain height without clobbering the "float above ground" offset.
function buildMarker(color: number): THREE.Group {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), new THREE.MeshStandardMaterial({ color }));
  mesh.position.y = 0.6;
  group.add(mesh);
  return group;
}

// A translucent flat disc (the zone's actual radius, for at-a-glance sizing) plus a small marker
// ball at its center (buildMarker's own shape, reused so a zone is precisely click-selectable
// even at a radius too small to comfortably click the disc's edge). Rebuilt from scratch whenever
// `radius` changes (this whole group is torn down and readded every scene-sync pass, same as
// every other piece of content here), so drag-resizing the radius gizmo is what visibly grows it.
function buildZoneShape(color: number, radius: number): THREE.Group {
  const group = new THREE.Group();
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.03; // just above the ground to avoid z-fighting with the hex mosaic/grid
  group.add(disc);
  group.add(buildMarker(color));
  return group;
}

// A single palette-grid button's rendering data, produced from whichever *_PALETTE array a
// section wraps (TILE_PALETTE, WALL_PALETTE, ...) - lets every section share one rendering path
// (PaletteSection below) instead of seven near-identical JSX blocks that only differ in which
// array they map and which ActiveTool variant they compare against.
interface PaletteEntry {
  key: string;
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  thumbnail?: string;
  // Only used when there's no thumbnail (wall/door/tower/gate, NPC/spawn/waypoint, and "erase") -
  // a flat CSS color swatch instead, see WALL_PALETTE/MARKER_PALETTE's own comments on why those
  // have no real render to show.
  swatchColor?: string;
  swatchClassName?: string;
}

// Collapsed/expanded state per section persists in the parent (openSections/setOpenSections)
// rather than locally, so it survives this component unmounting when its own entries list
// disappears (e.g. Decoration/Nature/Props while a dungeon map is selected - the whole palette
// still renders those sections, just disabled, so this doesn't actually happen today, but keeping
// state lifted avoids relying on that).
// While `filter` is non-empty every section is forced open (and hidden entirely if nothing in it
// matches) so a search always shows its results regardless of prior collapse state; manual
// collapse/expand clicks are ignored during that time rather than fighting the forced-open state.
function PaletteSection({
  id,
  title,
  entries,
  filter,
  openSections,
  setOpenSections,
}: {
  id: string;
  title: string;
  entries: PaletteEntry[];
  filter: string;
  openSections: Record<string, boolean>;
  setOpenSections: (updater: (s: Record<string, boolean>) => Record<string, boolean>) => void;
}) {
  const needle = filter.trim().toLowerCase();
  const visible = needle ? entries.filter((e) => e.label.toLowerCase().includes(needle)) : entries;
  if (needle && visible.length === 0) return null;

  return (
    <details
      className="palette-section"
      open={needle ? true : (openSections[id] ?? true)}
      onToggle={(event) => {
        if (needle) return;
        const next = event.currentTarget.open;
        setOpenSections((s) => (s[id] === next ? s : { ...s, [id]: next }));
      }}
    >
      <summary>
        {title}
        <span className="palette-section-count">{visible.length}</span>
      </summary>
      <div className="palette-grid">
        {visible.map((entry) => (
          <button
            key={entry.key}
            className={entry.active ? "palette-item active" : "palette-item"}
            onClick={entry.onClick}
            disabled={entry.disabled}
            title={entry.title}
          >
            {entry.thumbnail ? (
              <img src={entry.thumbnail} alt={entry.label} className="palette-thumb" />
            ) : (
              <span
                className={entry.swatchClassName ?? "palette-swatch"}
                style={entry.swatchColor ? { background: entry.swatchColor } : undefined}
              />
            )}
            {entry.label}
          </button>
        ))}
      </div>
    </details>
  );
}

type CoastKind = keyof typeof COAST_TILE_MODEL_PATHS;
// Rotation is only stored/meaningful for the coast kinds (see HexTileOverrideDef's own doc
// comment) - grass/water/road/river either auto-orient from neighbor connectivity or don't care.
function isCoastKind(kind: string): kind is CoastKind {
  return kind in COAST_TILE_MODEL_PATHS;
}

// A grass cell only gets a ramp mesh at all once it has elevation - see classifyElevationRamps
// (shared/src/hex.ts). Rotation is only ever meaningful/rotatable here once that's true, mirroring
// isCoastKind's own role for coast tiles just above.
function isRampEligible(kind: string, elevation: number): boolean {
  return kind === "grass" && elevation > 0;
}

// Human-readable label for the toolbar's "Placing: X" status readout (see the return JSX) -
// looks the active tool's id back up in whichever *_PALETTE array owns it, so the label always
// matches what's shown on the palette button itself instead of a second hand-typed copy.
function describeActiveTool(tool: ActiveTool): string {
  if (!tool) return "";
  switch (tool.mode) {
    case "tile":
      return TILE_PALETTE.find((t) => t.tileKind === tool.tileKind)?.label ?? tool.tileKind;
    case "furniture":
      return (
        FURNITURE_PALETTE.find((f) => f.furnitureKind === tool.furnitureKind)?.label ??
        DECORATION_PALETTE.find((f) => f.furnitureKind === tool.furnitureKind)?.label ??
        NATURE_PALETTE.find((f) => f.furnitureKind === tool.furnitureKind)?.label ??
        PROPS_PALETTE.find((f) => f.furnitureKind === tool.furnitureKind)?.label ??
        tool.furnitureKind
      );
    case "structure":
      return BUILDING_PALETTE.find((b) => b.modelId === tool.structureModelId)?.label ?? tool.structureModelId;
    case "lamp":
      return LAMP_PALETTE.find((l) => l.modelId === tool.lampModelId)?.label ?? tool.lampModelId;
    case "wallKind":
      return WALL_PALETTE.find((w) => w.wallKind === tool.wallKind)?.label ?? tool.wallKind;
    case "marker":
      return MARKER_PALETTE.find((m) => m.markerKind === tool.markerKind)?.label ?? tool.markerKind;
    case "zone":
      return "Enemy Spawn Zone";
    case "elevation":
      return tool.level === 0 ? "Ground Level" : `Elevation ${tool.level}`;
    case "ramp":
      return "Ramp";
  }
}

interface ThreeContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  orbit: OrbitControls;
  transform: TransformControls;
  content: THREE.Group;
  ground: THREE.Group;
  grid: THREE.GridHelper;
  raycaster: THREE.Raycaster;
  // A large, fully-transparent (not visible:false - Three's raycaster skips invisible objects
  // entirely) flat plane at y=0, intersected whenever a placement tool is active to get the exact
  // world (x, z) under the cursor regardless of what's actually rendered there.
  pickPlane: THREE.Mesh;
  // Drives every placed NPC's idle animation (see populateNpcShape) - reset to empty and repopulated
  // each time the content-sync effect rebuilds `content` from scratch, same lifecycle as the
  // markers/models themselves.
  mixers: THREE.AnimationMixer[];
  clock: THREE.Clock;
}

export function MapEditor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const threeRef = useRef<ThreeContext | null>(null);

  const [maps, setMaps] = useState<RowData[]>([]);
  const [mapId, setMapId] = useState<string>("");
  const [structures, setStructures] = useState<RowData[]>([]);
  const [npcs, setNpcs] = useState<RowData[]>([]);
  const [spawns, setSpawns] = useState<RowData[]>([]);
  const [zones, setZones] = useState<RowData[]>([]);
  const [waypoints, setWaypoints] = useState<RowData[]>([]);
  const [respawnPoints, setRespawnPoints] = useState<RowData[]>([]);
  const [furniture, setFurniture] = useState<RowData[]>([]);
  const [hexTiles, setHexTiles] = useState<RowData[]>([]);
  const [enemyTypes, setEnemyTypes] = useState<RowData[]>([]);
  const [gatheringNodes, setGatheringNodes] = useState<RowData[]>([]);
  const [gatheringNodeTypes, setGatheringNodeTypes] = useState<RowData[]>([]);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>("translate");
  const [activeTool, setActiveTool] = useState<ActiveTool>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Palette UX: a search box that filters every section's items by label (see PaletteSection),
  // and per-section collapse state - the two big always-scrolling palettes (Nature/Props, ~25
  // items each) default closed so the panel opens on something scannable; the rest default open.
  const [paletteFilter, setPaletteFilter] = useState("");
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    nature: false,
    props: false,
  });

  // Mirrors of state the persistent (set-up-once) event handlers below need to read without
  // re-binding on every render - the classic stale-closure trap for imperative/React hybrids.
  const selectedRef = useRef<Selected | null>(null);
  const gizmoModeRef = useRef<GizmoMode>("translate");
  const activeToolRef = useRef<ActiveTool>(null);
  selectedRef.current = selected;
  gizmoModeRef.current = gizmoMode;
  activeToolRef.current = activeTool;

  const activeMap = maps.find((m) => String(m.id) === mapId);

  // --- Data loading ---

  useEffect(() => {
    listEntities<RowData>("maps").then((res) => {
      setMaps(res.items);
      const active = res.items.find((m) => m.kind === "overworld" && m.is_active) ?? res.items[0];
      if (active) setMapId(String(active.id));
    });
    listEntities<RowData>("enemy-types").then((res) => setEnemyTypes(res.items));
    listEntities<RowData>("gathering-node-types").then((res) => setGatheringNodeTypes(res.items));
  }, []);

  const reloadContent = useCallback(() => {
    if (!mapId) return;
    // Doesn't touch mapId itself (unlike the mount effect above, which also auto-selects the
    // active overworld map on first load) - just refreshes each row's own fields, so a portal/
    // spawn marker drag/save (the "map-portal"/"map-spawn" SelectableTypes - see
    // commitTransformRef/handleFormSubmit) actually shows its new position instead of the marker/
    // form silently reverting to stale portal_x/z or spawn_x/z on the next render.
    listEntities<RowData>("maps").then((res) => setMaps(res.items));
    listEntities<RowData>("structures").then((res) => setStructures(res.items.filter((s) => s.map_id === mapId)));
    listEntities<RowData>("npcs").then((res) => setNpcs(res.items.filter((n) => n.map_id === mapId)));
    listEntities<RowData>("enemy-spawns").then((res) => setSpawns(res.items.filter((s) => s.map_id === mapId)));
    listEntities<RowData>("enemy-spawn-zones").then((res) => setZones(res.items.filter((z) => z.map_id === mapId)));
    listEntities<RowData>("waypoints").then((res) => setWaypoints(res.items.filter((w) => w.map_id === mapId)));
    listEntities<RowData>("respawn-points").then((res) => setRespawnPoints(res.items.filter((r) => r.map_id === mapId)));
    listEntities<RowData>("furniture").then((res) => setFurniture(res.items.filter((f) => f.map_id === mapId)));
    listEntities<RowData>("hex-tiles").then((res) => setHexTiles(res.items.filter((h) => h.map_id === mapId)));
    listEntities<RowData>("gathering-nodes").then((res) => setGatheringNodes(res.items.filter((n) => n.map_id === mapId)));
  }, [mapId]);

  useEffect(() => {
    setSelected(null);
    reloadContent();
  }, [reloadContent]);

  // --- Three.js setup (once) ---

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x10121a);

    const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 2000);
    camera.position.set(35, 45, 45);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xfff2d9, 1.1);
    sun.position.set(20, 30, 15);
    scene.add(sun);

    // Rebuilt from scratch on every content sync below (a flat colored quad for dungeons, the
    // grass/water/road hex mosaic for the overworld) - starts empty, populated once the active
    // map is known.
    const ground = new THREE.Group();
    scene.add(ground);

    const grid = new THREE.GridHelper(1, 1, GRID_COLOR, GRID_COLOR_DARK);
    scene.add(grid);

    const content = new THREE.Group();
    scene.add(content);

    const pickPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    pickPlane.rotation.x = -Math.PI / 2;
    scene.add(pickPlane);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.set(0, 0, 0);
    orbit.maxPolarAngle = Math.PI / 2 - 0.02; // stop just short of straight-down/underground

    const transform = new TransformControls(camera, renderer.domElement);
    scene.add(transform.getHelper());
    transform.addEventListener("dragging-changed", (event) => {
      orbit.enabled = !event.value;
      if (!event.value) commitTransformRef.current();
    });

    const raycaster = new THREE.Raycaster();
    const mixers: THREE.AnimationMixer[] = [];
    const clock = new THREE.Clock();

    threeRef.current = { renderer, scene, camera, orbit, transform, content, ground, grid, raycaster, pickPlane, mixers, clock };

    function onResize() {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    }
    window.addEventListener("resize", onResize);

    function onPointerDown(event: PointerEvent) {
      if (transform.dragging) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);

      if (activeToolRef.current) {
        const hit = raycaster.intersectObject(pickPlane)[0];
        if (hit) placeAtRef.current(hit.point.x, hit.point.z);
        return;
      }

      const hits = raycaster.intersectObjects(content.children, true);
      for (const hit of hits) {
        let obj: THREE.Object3D | null = hit.object;
        while (obj && !obj.userData.entityType) obj = obj.parent;
        if (obj) {
          selectByTag(obj.userData.entityType as SelectableType, obj.userData.entityId as string);
          return;
        }
      }

      // Hex tiles have no individual 3D object to hit-test (they're InstancedMesh, one mesh per
      // kind/piece covering the whole map, not one object per cell) - reuse the same pick-plane
      // raycast tile-painting already does, convert the hit to axial coords, and look up whether a
      // real hand-painted row exists there. This is how a placed coast tile becomes selectable/
      // editable (its Rotation field) despite never appearing in `content.children` above.
      const planeHit = raycaster.intersectObject(pickPlane)[0];
      if (planeHit) {
        const { q, r } = worldToHex(planeHit.point.x, planeHit.point.z);
        const tile = hexTilesRef.current.find((h) => Number(h.q) === q && Number(h.r) === r);
        if (tile) {
          selectByTag("hex-tiles", String(tile.id));
          return;
        }
      }

      setSelected(null);
      transform.detach();
    }
    renderer.domElement.addEventListener("pointerdown", onPointerDown);

    let raf = 0;
    function animate() {
      raf = requestAnimationFrame(animate);
      orbit.update();
      const delta = clock.getDelta();
      for (const mixer of mixers) mixer.update(delta);
      renderer.render(scene, camera);
    }
    animate();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      transform.dispose();
      orbit.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      threeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Selection helpers (defined with refs so the pointerdown handler above, bound once,
  // always sees current data) ---

  const structuresRef = useRef<RowData[]>([]);
  const npcsRef = useRef<RowData[]>([]);
  const spawnsRef = useRef<RowData[]>([]);
  const zonesRef = useRef<RowData[]>([]);
  const waypointsRef = useRef<RowData[]>([]);
  const respawnPointsRef = useRef<RowData[]>([]);
  const furnitureRef = useRef<RowData[]>([]);
  const hexTilesRef = useRef<RowData[]>([]);
  const gatheringNodesRef = useRef<RowData[]>([]);
  const mapsRef = useRef<RowData[]>([]);
  // Session-local overlay of hex-tile row ids not yet confirmed by a reload - see its one use
  // site, the "elevation" tool branch in placeAtRef, for why this exists (fixes a real race a
  // rapid click sequence on the same cell can hit against hexTilesRef alone: a second click
  // landing before the first one's create/update response comes back would read a stale "no row
  // yet" and fire a duplicate create against the same (map_id, q, r), which the DB's unique index
  // rejects as a 500).
  const pendingHexEditRef = useRef<Map<string, string>>(new Map());
  // A selected coast tile has no real object in three.content.children to attach the rotate
  // gizmo to (see the "Attach the gizmo" effect's own comment on why hex tiles never do) - this is
  // a standalone proxy mesh built just for that selection instead, removed again the moment the
  // selection changes. hexTileProxyGenerationRef guards its async model load the same way
  // groundGenerationRef guards the ground rebuild below: a fast reselect shouldn't let an earlier,
  // now-stale load attach itself over a newer one.
  const hexTileProxyRef = useRef<THREE.Object3D | null>(null);
  const hexTileProxyGenerationRef = useRef(0);
  // Bumped every time the ground-rebuild block below starts a new async model load - see its own
  // comment for why a stale resolution needs to be discarded rather than clobbering newer content.
  const groundGenerationRef = useRef(0);
  structuresRef.current = structures;
  npcsRef.current = npcs;
  spawnsRef.current = spawns;
  zonesRef.current = zones;
  waypointsRef.current = waypoints;
  respawnPointsRef.current = respawnPoints;
  mapsRef.current = maps;
  furnitureRef.current = furniture;
  hexTilesRef.current = hexTiles;
  gatheringNodesRef.current = gatheringNodes;

  function refsByType(type: SelectableType): RowData[] {
    switch (type) {
      case "structures":
        return structuresRef.current;
      case "npcs":
        return npcsRef.current;
      case "enemy-spawns":
        return spawnsRef.current;
      case "enemy-spawn-zones":
        return zonesRef.current;
      case "waypoints":
        return waypointsRef.current;
      case "respawn-points":
        return respawnPointsRef.current;
      case "furniture":
        return furnitureRef.current;
      case "hex-tiles":
        return hexTilesRef.current;
      case "gathering-nodes":
        return gatheringNodesRef.current;
      case "map-portal":
      case "map-spawn":
        return mapsRef.current;
    }
  }

  function selectByTag(type: SelectableType, id: string) {
    const row = refsByType(type).find((r) => String(r.id) === id);
    if (row) setSelected({ type, row });
  }

  // --- Elevation content helper (shared by the gizmo-commit handler below and the scene-sync
  // effect's ground/marker building) ---

  // Same content the live game's hex classifier reads (STRUCTURES/NPCS/WAYPOINTS/SPAWN_POINTS/
  // BOSS_ARENA_*/PORTAL_POSITION/hex tile overrides), but this map's own fetched-and-filtered rows
  // rather than those global bindings - admin may be previewing a map that isn't the currently-
  // active one, which loadGameContent's filtering would otherwise silently exclude (see hex.ts's
  // HexTerrainContent doc comment).
  function buildHexContent(structureDefs: StructureDef[]): HexTerrainContent {
    return {
      structures: structureDefs,
      npcs: npcs.map((n) => ({ x: Number(n.x), z: Number(n.z) })),
      waypoints: waypoints.map((w) => ({ x: Number(w.x), z: Number(w.z) })),
      spawns: spawns.map((s) => ({ x: Number(s.x), z: Number(s.z) })),
      bossArenaCenter: {
        x: activeMap?.boss_arena_x != null ? Number(activeMap.boss_arena_x) : 0,
        z: activeMap?.boss_arena_z != null ? Number(activeMap.boss_arena_z) : 0,
      },
      bossArenaRadius: activeMap?.boss_arena_radius != null ? Number(activeMap.boss_arena_radius) : 0,
      portalPosition: {
        x: activeMap?.portal_x != null ? Number(activeMap.portal_x) : 0,
        z: activeMap?.portal_z != null ? Number(activeMap.portal_z) : 0,
      },
      overrides: hexTiles.map((h) => ({
        q: Number(h.q),
        r: Number(h.r),
        kind: h.kind as HexTerrainKind,
        rotation: h.rotation != null ? Number(h.rotation) : undefined,
        elevation: h.elevation != null ? Number(h.elevation) : undefined,
        rampRotation: h.ramp_rotation != null ? Number(h.ramp_rotation) : undefined,
      })),
    };
  }

  // --- Commit a finished gizmo drag back to the server ---

  const commitTransformRef = useRef<() => void>(() => {});
  commitTransformRef.current = () => {
    const three = threeRef.current;
    const sel = selectedRef.current;
    const mesh = three?.transform.object;
    if (!three || !sel || !mesh) return;

    const changes: RowData = {};
    if (sel.type === "structures" && gizmoModeRef.current === "scale") {
      changes.width = round(Number(sel.row.width) * mesh.scale.x);
      changes.depth = round(Number(sel.row.depth) * mesh.scale.z);
      changes.height = round(Number(sel.row.height) * mesh.scale.y);
    } else if (sel.type === "enemy-spawn-zones" && gizmoModeRef.current === "scale") {
      // A zone is a flat circle, not a box - only the x-axis handle is meaningful (dragging it
      // scales the disc uniformly in the scene too, see the gizmo-attach effect's showZ: false
      // for this type), so radius is derived from scale.x alone.
      changes.radius = round(Number(sel.row.radius) * mesh.scale.x);
    } else if ((sel.type === "structures" || sel.type === "furniture") && gizmoModeRef.current === "rotate") {
      changes.rotation_y = round(mesh.rotation.y, 3);
    } else if (sel.type === "hex-tiles") {
      // Rotate is the only mode a hex tile ever uses (see the gizmo-attach effect) - normalized
      // into [0, 2*PI) since TransformControls' rotation snap can otherwise leave small negative
      // values after rotating past 0, which would still be numerically correct but an odd thing to
      // see in the inspector's own Rotation dropdown (whose options are all in [0, 2*PI)).
      const normalized = round(((mesh.rotation.y % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2), 3);
      const kind = String(sel.row.kind ?? "");
      const elevation = Number(sel.row.elevation) || 0;
      // A grass ramp and a coast tile are mutually exclusive kinds - whichever this selection
      // is drives which field the gizmo-attach effect built the proxy from, so it's also the one
      // this drag's result belongs to.
      if (isRampEligible(kind, elevation)) changes.ramp_rotation = normalized;
      else changes.rotation = normalized;
    } else if (sel.type === "map-portal" || sel.type === "map-spawn") {
      // The portal/spawn markers drag the active map's own portal_x/z or spawn_x/z fields
      // directly (see the two markers built in the content-sync effect below) - not a list row's
      // x/z like every other marker, so this branch writes different field names before falling
      // through to the same generic updateEntity(mapEntityKey(sel.type), ...) call every other
      // branch already ends in.
      if (sel.type === "map-portal") {
        changes.portal_x = round(mesh.position.x);
        changes.portal_z = round(mesh.position.z);
      } else {
        changes.spawn_x = round(mesh.position.x);
        changes.spawn_z = round(mesh.position.z);
      }
    } else {
      changes.x = round(mesh.position.x);
      changes.z = round(mesh.position.z);
      // Only structures/npcs/furniture have a y_offset column (see the translate showY gate
      // above) - the drag may have moved the mesh vertically, so re-derive the offset from the
      // ground height at its (possibly also just-moved) x/z rather than assuming only y changed.
      if (sel.type === "structures" || sel.type === "npcs" || sel.type === "furniture") {
        const structureDefs = sel.type === "structures" ? toStructureDefs(structuresRef.current) : [];
        const groundY = getHexElevation(mesh.position.x, mesh.position.z, buildHexContent(structureDefs)) * HEX_ELEVATION_STEP_WORLD;
        changes.y_offset = round(mesh.position.y - groundY);
      }
    }

    updateEntity(mapEntityKey(sel.type), String(sel.row.id), changes).then(() => reloadContent());
  };

  // --- Placement tools: a click in the 3D view while a palette item is active paints/erases a
  // hex tile or drops a new furniture piece, instead of selecting an existing entity (see
  // onPointerDown's activeToolRef branch above) ---

  const placeAtRef = useRef<(x: number, z: number) => void>(() => {});
  placeAtRef.current = (x: number, z: number) => {
    const tool = activeToolRef.current;
    if (!tool || !mapId) return;

    if (tool.mode === "tile") {
      const { q, r } = worldToHex(x, z);
      const existing = hexTilesRef.current.find((h) => Number(h.q) === q && Number(h.r) === r);
      if (tool.tileKind === "erase") {
        if (existing) deleteEntity("hex-tiles", String(existing.id)).then(() => reloadContent());
        return;
      }
      if (existing) {
        updateEntity("hex-tiles", String(existing.id), { kind: tool.tileKind }).then(() => reloadContent());
      } else {
        // Deterministic id so re-painting the same cell in quick succession (before a reload
        // completes and hexTilesRef would otherwise see the row) still targets the same row
        // instead of risking a duplicate.
        const row: RowData = { id: `hex_${mapId}_${q}_${r}`, map_id: mapId, q, r, kind: tool.tileKind };
        createEntity("hex-tiles", row).then(() => reloadContent());
      }
      return;
    }

    if (tool.mode === "elevation") {
      const { q, r } = worldToHex(x, z);
      const key = `${q},${r}`;
      // Sets the clicked cell directly to the palette's chosen level - see pendingHexEditRef's own
      // comment for why a session-local id overlay is still needed even for a direct set (avoids a
      // duplicate create if the same cell is clicked again before the first click's response
      // lands).
      const pendingId = pendingHexEditRef.current.get(key);
      const existingRow = hexTilesRef.current.find((h) => Number(h.q) === q && Number(h.r) === r);
      const existingId = pendingId ?? (existingRow ? String(existingRow.id) : undefined);
      pendingHexEditRef.current.set(key, existingId ?? `hex_${mapId}_${q}_${r}`);
      // Works on any tile kind, not just grass (see HexGround.ts's elevationY - every kind now
      // renders at its own height, only the ramp mesh stays grass-specific). An existing painted
      // tile only has its elevation touched, leaving its kind/rotation exactly as they were; a
      // never-painted cell inherits whatever kind it's CURRENTLY classified as (procedural or not)
      // instead of silently turning it to grass.
      if (existingId) {
        updateEntity("hex-tiles", existingId, { elevation: tool.level }).then(() => reloadContent());
      } else {
        const hexContent = buildHexContent(toStructureDefs(structuresRef.current));
        const current = classifyHexCell(q, r, hexContent);
        const row: RowData = {
          id: `hex_${mapId}_${q}_${r}`,
          map_id: mapId,
          q,
          r,
          kind: current.kind,
          rotation: current.rotation,
          elevation: tool.level,
        };
        createEntity("hex-tiles", row).then(() => reloadContent());
      }
      return;
    }

    if (tool.mode === "ramp") {
      const { q, r } = worldToHex(x, z);
      const key = `${q},${r}`;
      // Same duplicate-create race guard as the "elevation" tool above.
      const pendingId = pendingHexEditRef.current.get(key);
      const existingRow = hexTilesRef.current.find((h) => Number(h.q) === q && Number(h.r) === r);
      const existingId = pendingId ?? (existingRow ? String(existingRow.id) : undefined);
      pendingHexEditRef.current.set(key, existingId ?? `hex_${mapId}_${q}_${r}`);
      const hexContent = buildHexContent(toStructureDefs(structuresRef.current));
      const current = classifyHexCell(q, r, hexContent);
      // A ramp needs somewhere to slope from - bump flat ground up to the first level rather than
      // silently doing nothing (classifyElevationRamps never ramps an elevation-0 cell). Already-
      // elevated ground keeps its own height.
      const elevation = Math.max(1, current.elevation);
      if (existingId) {
        // Re-clicking an already-ramped cell just re-confirms kind/elevation - its existing
        // ramp_rotation (manual or still automatic) is left untouched rather than reset to 0.
        updateEntity("hex-tiles", existingId, { kind: "grass", elevation }).then(() => reloadContent());
      } else {
        // Starts facing direction 0 - the admin then drags the rotate gizmo (see the "Attach the
        // gizmo" effect) to aim it wherever it actually needs to go.
        const row: RowData = { id: `hex_${mapId}_${q}_${r}`, map_id: mapId, q, r, kind: "grass", elevation, ramp_rotation: 0 };
        createEntity("hex-tiles", row).then(() => reloadContent());
      }
      return;
    }

    if (tool.mode === "structure") {
      // width/depth/height/color are ignored for kind=building (see entities.ts's own field
      // labels) - a whole pre-made exterior model has no use for them, but the DB row still
      // carries the same shape as every other structure.
      const row: RowData = {
        id: `structure_${Date.now()}`,
        name: `New ${tool.structureModelId}`,
        map_id: mapId,
        kind: "building",
        model_id: tool.structureModelId,
        x: round(x),
        z: round(z),
        rotation_y: 0,
        width: 4,
        depth: 4,
        height: 4,
        color: "#8a6d4b",
      };
      createEntity("structures", row).then(() => {
        reloadContent();
        setSelected({ type: "structures", row });
      });
      return;
    }

    if (tool.mode === "lamp") {
      const preset = LAMP_PALETTE.find((item) => item.modelId === tool.lampModelId);
      const row: RowData = {
        id: `structure_${Date.now()}`,
        name: `New ${tool.lampModelId}`,
        map_id: mapId,
        kind: "lamp",
        model_id: tool.lampModelId,
        x: round(x),
        z: round(z),
        rotation_y: 0,
        width: preset?.width ?? 0.5,
        depth: preset?.depth ?? 0.5,
        height: preset?.height ?? 3.5,
        // Every other kind's color tints its own material; a lamp's color is its glow tint (see
        // structureGeometry.ts's buildLamp) - warm lamplight yellow reads better as a default than
        // the same brown every wall/tower/gate starts as.
        color: "#ffcf7a",
        y_offset: preset?.yOffset ?? 0,
      };
      createEntity("structures", row).then(() => {
        reloadContent();
        setSelected({ type: "structures", row });
      });
      return;
    }

    if (tool.mode === "wallKind") {
      // wall/door default to a thin, wall-length box (place several end-to-end and drag their
      // translate/rotate gizmos to close a loop); tower/gate keep the old boxier default - same
      // defaults createStructure used before this became a click-to-place tool.
      const isWallLike = tool.wallKind === "wall" || tool.wallKind === "door";
      const row: RowData = {
        id: `structure_${Date.now()}`,
        name: `New ${tool.wallKind}`,
        map_id: mapId,
        kind: tool.wallKind,
        x: round(x),
        z: round(z),
        rotation_y: 0,
        width: 4,
        depth: isWallLike ? 0.2 : 4,
        height: 3,
        color: "#8a6d4b",
      };
      createEntity("structures", row).then(() => {
        reloadContent();
        setSelected({ type: "structures", row });
      });
      return;
    }

    if (tool.mode === "marker") {
      if (tool.markerKind === "npc") {
        const row: RowData = { id: `npc_${Date.now()}`, name: "New NPC", map_id: mapId, x: round(x), z: round(z) };
        createEntity("npcs", row).then(() => {
          reloadContent();
          setSelected({ type: "npcs", row });
        });
      } else if (tool.markerKind === "enemy-spawn") {
        if (enemyTypes.length === 0) return;
        const row: RowData = {
          id: `spawn_${Date.now()}`,
          map_id: mapId,
          enemy_type_id: String(enemyTypes[0].id),
          x: round(x),
          z: round(z),
        };
        createEntity("enemy-spawns", row).then(() => {
          reloadContent();
          setSelected({ type: "enemy-spawns", row });
        });
      } else if (tool.markerKind === "waypoint") {
        const row: RowData = { id: `waypoint_${Date.now()}`, name: "New Waypoint", map_id: mapId, x: round(x), z: round(z) };
        createEntity("waypoints", row).then(() => {
          reloadContent();
          setSelected({ type: "waypoints", row });
        });
      } else if (tool.markerKind === "respawn-point") {
        const row: RowData = { id: `respawn_${Date.now()}`, name: "New Respawn Point", map_id: mapId, x: round(x), z: round(z) };
        createEntity("respawn-points", row).then(() => {
          reloadContent();
          setSelected({ type: "respawn-points", row });
        });
      } else {
        if (gatheringNodeTypes.length === 0) return;
        const row: RowData = {
          id: `gathernode_${Date.now()}`,
          map_id: mapId,
          node_type_id: String(gatheringNodeTypes[0].id),
          x: round(x),
          z: round(z),
        };
        createEntity("gathering-nodes", row).then(() => {
          reloadContent();
          setSelected({ type: "gathering-nodes", row });
        });
      }
      return;
    }

    if (tool.mode === "zone") {
      const row: RowData = {
        id: `zone_${Date.now()}`,
        map_id: mapId,
        x: round(x),
        z: round(z),
        radius: ZONE_DEFAULT_RADIUS,
        max_population: ZONE_DEFAULT_MAX_POPULATION,
        enemy_type_ids: [],
      };
      createEntity("enemy-spawn-zones", row).then(() => {
        reloadContent();
        setSelected({ type: "enemy-spawn-zones", row });
      });
      return;
    }

    const row: RowData = {
      id: `furniture_${Date.now()}`,
      name: "New Furniture",
      map_id: mapId,
      kind: tool.furnitureKind,
      x: round(x),
      z: round(z),
      color: "#8a6d4b",
    };
    // Tool stays active (see the palette toggle handlers below) so repeated clicks keep placing -
    // selecting what was just placed only updates the inspector, same as createFurniture() below.
    createEntity("furniture", row).then(() => {
      reloadContent();
      setSelected({ type: "furniture", row });
    });
  };

  // --- Sync the Three.js scene from current React state ---

  useEffect(() => {
    const three = threeRef.current;
    if (!three || !activeMap) return;

    const halfExtent = Number(activeMap.half_extent) || 50;

    // Both overworld and dungeon maps get the same hex mosaic + elevation preview now - see the
    // Dungeon Hex Terrain plan for why dungeons no longer get a flat quad.
    setTerrainMode(activeMap.kind === "overworld" ? "overworld" : "dungeon");

    // getHexElevation's flattening-under-buildings needs the actual structure list - admin never
    // calls loadGameContent (it reads the REST API directly, not the live-game content snapshot),
    // so the shared STRUCTURES binding it'd otherwise default to is always empty here. Built once
    // per sync and threaded through every elevation lookup below. buildHexContent already reads
    // whichever entity lists are currently loaded for `mapId` (see reloadContent), so this needs
    // no map-kind branching to work for a dungeon map too.
    const structureDefs = toStructureDefs(structures);
    const hexContent = buildHexContent(structureDefs);
    const terrainY = (x: number, z: number) => getHexElevation(x, z, hexContent) * HEX_ELEVATION_STEP_WORLD;

    const clearGround = () => {
      while (three.ground.children.length > 0) {
        const child = three.ground.children[0];
        three.ground.remove(child);
        child.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.geometry.dispose();
            if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
            else (obj.material as THREE.Material).dispose();
          }
        });
      }
    };
    clearGround();

    // Loading the real tile models is async - a generation token guards against a stale load
    // (from a sync that's since been superseded by a newer one, e.g. rapid map/content changes)
    // landing its result on top of whatever the latest sync already built.
    const myGeneration = ++groundGenerationRef.current;
    buildHexTerrainPreview(halfExtent, hexContent).then((hexPreview) => {
      if (groundGenerationRef.current !== myGeneration || !threeRef.current) return;
      clearGround();
      three.ground.add(hexPreview);
    });

    // A square reference grid only makes sense over a flat quad - the hex mosaic provides its own
    // tiling reference (and the two would z-fight, both sitting at y=0) - so the placeholder grid
    // from initial setup is removed once here and never rebuilt, now that both map kinds use the
    // mosaic.
    three.scene.remove(three.grid);

    while (three.content.children.length > 0) {
      const child = three.content.children[0];
      three.content.remove(child);
      child.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
    }
    three.mixers.length = 0;

    for (const def of structureDefs) {
      const group = new THREE.Group();
      group.add(buildStructureShape(def));
      if (def.kind === "building" && def.modelId) populateBuildingShape(group, def.modelId);
      group.position.set(def.x, terrainY(def.x, def.z) + def.yOffset, def.z);
      group.rotation.y = def.rotationY;
      group.userData = { entityType: "structures", entityId: def.id };
      three.content.add(group);
    }

    // Rooms aren't authored directly - they fall out of whichever wall/door segments happen to
    // form a closed loop (see shared's findStructureLoops), so there's no row/gizmo/selection for
    // these the way there is for a real structure - just a preview of what the client will render.
    for (const loop of findStructureLoops(structureDefs, halfExtent)) {
      three.content.add(buildEnclosureShape(loop));
    }

    for (const row of npcs) {
      const group = new THREE.Group();
      const x = Number(row.x);
      const z = Number(row.z);
      const yOffset = Number(row.y_offset ?? 0);
      group.position.set(x, terrainY(x, z) + yOffset, z);
      group.userData = { entityType: "npcs", entityId: String(row.id) };
      populateNpcShape(group, three.mixers);
      three.content.add(group);
    }

    for (const row of spawns) {
      const marker = buildMarker(SPAWN_MARKER_COLOR);
      const x = Number(row.x);
      const z = Number(row.z);
      marker.position.set(x, terrainY(x, z), z);
      marker.userData = { entityType: "enemy-spawns", entityId: String(row.id) };
      three.content.add(marker);
    }

    for (const row of zones) {
      const x = Number(row.x);
      const z = Number(row.z);
      const radius = Number(row.radius) || ZONE_DEFAULT_RADIUS;
      const shape = buildZoneShape(ZONE_MARKER_COLOR, radius);
      shape.position.set(x, terrainY(x, z), z);
      shape.userData = { entityType: "enemy-spawn-zones", entityId: String(row.id) };
      three.content.add(shape);
    }

    for (const row of waypoints) {
      const marker = buildMarker(WAYPOINT_MARKER_COLOR);
      const x = Number(row.x);
      const z = Number(row.z);
      marker.position.set(x, terrainY(x, z), z);
      marker.userData = { entityType: "waypoints", entityId: String(row.id) };
      three.content.add(marker);
    }

    for (const row of respawnPoints) {
      const marker = buildMarker(RESPAWN_POINT_MARKER_COLOR);
      const x = Number(row.x);
      const z = Number(row.z);
      marker.position.set(x, terrainY(x, z), z);
      marker.userData = { entityType: "respawn-points", entityId: String(row.id) };
      three.content.add(marker);
    }

    // The portal and spawn markers - unlike every marker above, neither is a list row of its own
    // (there's no "place one" tool, no create/delete): every map already has exactly one
    // portal_x/z pair and one spawn_x/z pair (each defaulting to 0,0), they've just been four
    // blind number fields on the map's own form until now. Always rendered so they're draggable
    // the moment a map is open. These are two DIFFERENT things easy to conflate (see
    // shared's PORTAL_POSITION/SPAWN_POSITION doc comments): the portal is the clickable
    // dungeon-entrance prop only the overworld ever renders in-game (client/src/game/Portal.ts),
    // while spawn is plain coordinates - where a character actually appears on join
    // (WorldRoom.onJoin/DungeonRoom.onJoin), with no world object of its own, on every map kind.
    if (activeMap) {
      const portalMarker = buildMarker(PORTAL_MARKER_COLOR);
      const px = activeMap.portal_x != null ? Number(activeMap.portal_x) : 0;
      const pz = activeMap.portal_z != null ? Number(activeMap.portal_z) : 0;
      portalMarker.position.set(px, terrainY(px, pz), pz);
      portalMarker.userData = { entityType: "map-portal", entityId: String(activeMap.id) };
      three.content.add(portalMarker);

      const spawnMarker = buildMarker(CHARACTER_SPAWN_MARKER_COLOR);
      const sx = activeMap.spawn_x != null ? Number(activeMap.spawn_x) : 0;
      const sz = activeMap.spawn_z != null ? Number(activeMap.spawn_z) : 0;
      spawnMarker.position.set(sx, terrainY(sx, sz), sz);
      spawnMarker.userData = { entityType: "map-spawn", entityId: String(activeMap.id) };
      three.content.add(spawnMarker);
    }

    for (const row of gatheringNodes) {
      const marker = buildMarker(GATHERING_NODE_MARKER_COLOR);
      const x = Number(row.x);
      const z = Number(row.z);
      marker.position.set(x, terrainY(x, z), z);
      marker.userData = { entityType: "gathering-nodes", entityId: String(row.id) };
      three.content.add(marker);
    }

    for (const row of furniture) {
      const group = new THREE.Group();
      const x = Number(row.x);
      const z = Number(row.z);
      const yOffset = Number(row.y_offset ?? 0);
      group.position.set(x, terrainY(x, z) + yOffset, z);
      group.rotation.y = Number(row.rotation_y ?? 0);
      group.userData = { entityType: "furniture", entityId: String(row.id) };
      populateFurnitureShape(group, row.kind as FurnitureKind, String(row.color ?? "#8a6d4b"));
      three.content.add(group);
    }

    // Re-attach the gizmo to whichever object is still selected (it was just rebuilt from
    // scratch above) and refresh its row data - otherwise the inspector form would keep
    // showing pre-drag values after a gizmo commit reloads fresh data from the server. Detach
    // if the row no longer exists at all (e.g. it just got deleted).
    if (selectedRef.current) {
      const { type, row } = selectedRef.current;
      const list =
        type === "structures"
          ? structures
          : type === "npcs"
            ? npcs
            : type === "enemy-spawns"
              ? spawns
              : type === "enemy-spawn-zones"
                ? zones
                : type === "waypoints"
                  ? waypoints
                  : type === "respawn-points"
                    ? respawnPoints
                    : type === "hex-tiles"
                      ? hexTiles
                      : type === "gathering-nodes"
                        ? gatheringNodes
                        : isMapPointType(type)
                          ? maps
                          : furniture;
      const freshRow = list.find((r) => String(r.id) === String(row.id));
      if (freshRow) {
        const match = three.content.children.find(
          (obj) => obj.userData.entityType === type && obj.userData.entityId === String(freshRow.id),
        );
        if (match) three.transform.attach(match);
        setSelected({ type, row: freshRow });
      } else {
        three.transform.detach();
        setSelected(null);
      }
    }
  }, [structures, npcs, spawns, zones, waypoints, respawnPoints, furniture, hexTiles, gatheringNodes, maps, activeMap]);

  // --- Attach the gizmo to the current selection + set its mode/axis constraints ---
  // (Separate from the scene-sync effect below: that one only re-runs when the fetched content
  // changes, so a plain click-to-select - which changes nothing about structures/npcs/spawns -
  // would otherwise update the inspector panel but never actually attach the gizmo.)

  useEffect(() => {
    const three = threeRef.current;
    if (!three) return;

    // Any previous coast-tile rotate proxy is invalidated the moment this effect re-runs for any
    // reason - a new selection, a deselection, or even a re-run for the SAME coast tile (its own
    // async load below builds a fresh one either way). Bumping the generation here also cancels
    // whichever load might still be in flight from an earlier run.
    hexTileProxyGenerationRef.current++;
    if (hexTileProxyRef.current) {
      three.scene.remove(hexTileProxyRef.current);
      // Only the material is disposed - it's an independent .clone() made when the proxy was
      // built. The geometry is NOT cloned (see the coast-tile branch below) - it's the same
      // BufferGeometry the real hex terrain's InstancedMesh is still actively using, so disposing
      // it here would break the live-rendered tiles, not just this proxy.
      const proxy = hexTileProxyRef.current;
      if (proxy instanceof THREE.Mesh) {
        if (Array.isArray(proxy.material)) proxy.material.forEach((m) => m.dispose());
        else proxy.material.dispose();
      }
      hexTileProxyRef.current = null;
    }
    three.transform.setRotationSnap(null);

    if (!selected) {
      three.transform.detach();
      return;
    }

    if (selected.type === "hex-tiles") {
      const kind = String(selected.row.kind ?? "");
      const elevation = Number(selected.row.elevation) || 0;
      const isCoast = isCoastKind(kind);
      const isRamp = !isCoast && isRampEligible(kind, elevation);
      if (!isCoast && !isRamp) {
        // Rotation isn't stored/meaningful for any other kind/state (see isCoastKind's and
        // isRampEligible's own comments) - nothing to attach a rotate gizmo to.
        three.transform.detach();
        return;
      }
      // Hex tiles are InstancedMesh batches, not individually selectable scene objects (see the
      // non-hex-tile match search below) - a coast or ramp tile gets a standalone proxy mesh built
      // just for this selection instead, so TransformControls has a real object to rotate. Guarded
      // by hexTileProxyGenerationRef (bumped above) so a fast reselect can't let a stale load land.
      // Built from the exact same raw geometry/material loadModelGeometry hands the real
      // InstancedMesh renderer (not loadStaticModel's full hierarchy clone), so the proxy matches
      // the actual tile's scale/orientation convention exactly instead of risking a mismatch from
      // whatever transform nodes the source glTF happens to wrap its mesh in.
      const myGeneration = hexTileProxyGenerationRef.current;
      const { x, z } = hexToWorld(Number(selected.row.q), Number(selected.row.r));
      // A ramp mesh sits at the LOWER of the two levels it bridges (see HexGround.ts's elevationY/
      // ramp yOf comment) - a coast tile's own flat instance sits at its own full elevation.
      const y = (isRamp ? elevation - 1 : elevation) * HEX_ELEVATION_STEP_WORLD;
      const rotationField = isRamp ? selected.row.ramp_rotation : selected.row.rotation;
      const rotation = rotationField != null ? Number(rotationField) : 0;
      const modelPath = isRamp ? GRASS_RAMP_MODEL_PATH : COAST_TILE_MODEL_PATHS[kind as CoastKind];
      loadModelGeometry(modelPath).then(({ geometry, material }) => {
        if (hexTileProxyGenerationRef.current !== myGeneration || !threeRef.current) return;
        const proxy = new THREE.Mesh(geometry, material.clone());
        proxy.scale.setScalar(HEX_TILE_SCALE);
        proxy.position.set(x, y, z);
        proxy.rotation.y = rotation;
        threeRef.current.scene.add(proxy);
        hexTileProxyRef.current = proxy;
        threeRef.current.transform.attach(proxy);
        threeRef.current.transform.setMode("rotate");
        // A hexagon's own outline only lines up flush with its neighbors every 60 degrees - see
        // entities.ts's Rotation field for the same constraint enforced there via a fixed dropdown.
        // TransformControls' built-in snap makes the drag itself feel like it's clicking into each
        // valid angle, instead of a free drag the admin then has to eyeball.
        threeRef.current.transform.setRotationSnap(Math.PI / 3);
        threeRef.current.transform.showX = false;
        threeRef.current.transform.showY = true;
        threeRef.current.transform.showZ = false;
      });
      return;
    }

    const match = three.content.children.find(
      (obj) => obj.userData.entityType === selected.type && obj.userData.entityId === String(selected.row.id),
    );
    if (match) three.transform.attach(match);
    else three.transform.detach();

    // Furniture supports rotate (orienting a chair toward a table matters) but not scale - it has
    // no width/depth/height column to persist a scale change to (see commitTransformRef). A zone
    // supports scale (radius) but not rotate - a circle has no orientation.
    const canRotate = selected.type === "structures" || selected.type === "furniture";
    const mode: GizmoMode =
      selected.type === "structures"
        ? gizmoMode
        : selected.type === "enemy-spawn-zones"
          ? gizmoMode === "scale"
            ? "scale"
            : "translate"
          : canRotate && gizmoMode === "rotate"
            ? "rotate"
            : "translate";
    three.transform.setMode(mode);
    if (mode === "translate") {
      three.transform.showX = true;
      // Structures/NPCs/furniture are static in the live game and have a y_offset field to carry
      // a manual vertical adjustment on top of the auto-computed terrain height - enemy spawns/
      // zones don't (an enemy spawned from either re-derives its own height every frame, so a
      // y_offset here would have no visible effect in game - not worth exposing).
      three.transform.showY = selected.type === "structures" || selected.type === "npcs" || selected.type === "furniture";
      three.transform.showZ = true;
    } else if (mode === "rotate") {
      three.transform.showX = false;
      three.transform.showY = true; // only yaw exists in this game (StructureDef.rotationY)
      three.transform.showZ = false;
    } else if (selected.type === "enemy-spawn-zones") {
      // A circle has one degree of freedom (radius) - only the x-handle is exposed, and
      // commitTransformRef's zone branch reads scale.x alone.
      three.transform.showX = true;
      three.transform.showY = false;
      three.transform.showZ = false;
    } else {
      three.transform.showX = true;
      three.transform.showY = true;
      three.transform.showZ = true;
    }
  }, [selected, gizmoMode]);

  // Escape backs out of whatever's active - a placement tool first (so a misclick doesn't have to
  // be re-clicked away on its own palette button), otherwise the current selection. Bound once
  // (empty deps) and reads through the same activeToolRef/selectedRef mirrors the pointerdown
  // handler already relies on, rather than closing over activeTool/selected directly.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (activeToolRef.current) setActiveTool(null);
      else if (selectedRef.current) setSelected(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // --- Palette tool toggles: every entity kind is placed by activating a palette button (click)
  // then clicking the 3D view (see placeAtRef above) - there is no more "+ button creates at
  // (0,0), then drag it into place" round-trip; that pattern is what used to live in the top
  // toolbar as createStructure/createNpc/createSpawn/createWaypoint, now replaced entirely by
  // WALL_PALETTE/MARKER_PALETTE + toggleWallTool/toggleMarkerTool below. ---

  // Toggling an already-active item back off returns to normal click-to-select; picking a
  // different one switches tools directly. Activating a tool also clears any current selection -
  // matching Unity's "an active tool owns viewport clicks" convention rather than mixing the two.
  function toggleTileTool(tileKind: HexTerrainKind | "erase") {
    setSelected(null);
    setActiveTool((prev) => (prev?.mode === "tile" && prev.tileKind === tileKind ? null : { mode: "tile", tileKind }));
  }

  function toggleElevationTool(level: number) {
    setSelected(null);
    setActiveTool((prev) => (prev?.mode === "elevation" && prev.level === level ? null : { mode: "elevation", level }));
  }

  function toggleRampTool() {
    setSelected(null);
    setActiveTool((prev) => (prev?.mode === "ramp" ? null : { mode: "ramp" }));
  }

  function toggleFurnitureTool(furnitureKind: FurnitureKind) {
    setSelected(null);
    setActiveTool((prev) => (prev?.mode === "furniture" && prev.furnitureKind === furnitureKind ? null : { mode: "furniture", furnitureKind }));
  }

  function toggleStructureTool(structureModelId: string) {
    setSelected(null);
    setActiveTool((prev) =>
      prev?.mode === "structure" && prev.structureModelId === structureModelId ? null : { mode: "structure", structureModelId },
    );
  }

  function toggleLampTool(lampModelId: string) {
    setSelected(null);
    setActiveTool((prev) => (prev?.mode === "lamp" && prev.lampModelId === lampModelId ? null : { mode: "lamp", lampModelId }));
  }

  function toggleWallTool(wallKind: (typeof STRUCTURE_KINDS)[number]) {
    setSelected(null);
    setActiveTool((prev) => (prev?.mode === "wallKind" && prev.wallKind === wallKind ? null : { mode: "wallKind", wallKind }));
  }

  function toggleMarkerTool(markerKind: "npc" | "enemy-spawn" | "waypoint" | "respawn-point" | "gathering-node") {
    setSelected(null);
    setActiveTool((prev) => (prev?.mode === "marker" && prev.markerKind === markerKind ? null : { mode: "marker", markerKind }));
  }

  function toggleZoneTool() {
    setSelected(null);
    setActiveTool((prev) => (prev?.mode === "zone" ? null : { mode: "zone" }));
  }

  // --- Inspector panel (reuses the same EntityForm every table view uses) ---

  async function handleFormSubmit(data: RowData) {
    if (!selected) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const { id: _id, ...rest } = data;
      await updateEntity(mapEntityKey(selected.type), String(selected.row.id), rest);
      reloadContent();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!selected) return;
    if (!confirm(`Delete "${selected.row.name ?? selected.row.id}"?`)) return;
    await deleteEntity(mapEntityKey(selected.type), String(selected.row.id));
    setSelected(null);
    reloadContent();
  }

  const inspectorSchema = selected ? ENTITIES.find((e) => e.key === mapEntityKey(selected.type)) : undefined;

  // --- Palette entries: every *_PALETTE array above reshaped into the generic PaletteEntry shape
  // PaletteSection renders, one map() per section rather than the seven near-duplicate JSX blocks
  // this used to be. ---

  const tileEntries: PaletteEntry[] = [
    ...TILE_PALETTE.map((item) => ({
      key: item.tileKind,
      label: item.label,
      thumbnail: item.thumbnail,
      swatchClassName: item.thumbnail ? undefined : "palette-swatch palette-swatch-erase",
      active: activeTool?.mode === "tile" && activeTool.tileKind === item.tileKind,
      disabled: !mapId,
      onClick: () => toggleTileTool(item.tileKind),
    })),
    // Click-to-sculpt elevation, grass only (see placeAtRef's "elevation" branch and
    // ELEVATION_LEVEL_PALETTE's own doc comment) - one button per height band, sets the clicked
    // cell directly to that level.
    ...ELEVATION_LEVEL_PALETTE.map((item) => ({
      key: `elevation-${item.level}`,
      label: item.label,
      swatchColor: item.color,
      active: activeTool?.mode === "elevation" && activeTool.level === item.level,
      disabled: !mapId,
      title: item.title,
      onClick: () => toggleElevationTool(item.level),
    })),
    // Places (or bumps an existing flat cell up to) the ramp/slope piece, then leaves its facing
    // direction editable via the rotate gizmo (see the gizmo-attach effect's isRampEligible
    // branch below) - see placeAtRef's "ramp" branch.
    {
      key: "ramp",
      label: "Ramp",
      swatchClassName: "palette-swatch palette-swatch-erase",
      active: activeTool?.mode === "ramp",
      disabled: !mapId,
      title: "Place a ramp; select it afterward to drag-rotate its facing direction",
      onClick: toggleRampTool,
    },
  ];

  const wallEntries: PaletteEntry[] = WALL_PALETTE.map((item) => ({
    key: item.wallKind,
    label: item.label,
    swatchColor: WALL_KIND_SWATCH[item.wallKind],
    active: activeTool?.mode === "wallKind" && activeTool.wallKind === item.wallKind,
    disabled: !mapId,
    onClick: () => toggleWallTool(item.wallKind),
  }));

  const markerEntries: PaletteEntry[] = MARKER_PALETTE.map((item) => ({
    key: item.markerKind,
    label: item.label,
    swatchColor: item.color,
    swatchClassName: "palette-swatch palette-swatch-circle",
    active: activeTool?.mode === "marker" && activeTool.markerKind === item.markerKind,
    disabled:
      !mapId ||
      (item.markerKind === "enemy-spawn" && enemyTypes.length === 0) ||
      (item.markerKind === "gathering-node" && gatheringNodeTypes.length === 0),
    title:
      item.markerKind === "enemy-spawn" && enemyTypes.length === 0
        ? "No enemy types defined yet"
        : item.markerKind === "gathering-node" && gatheringNodeTypes.length === 0
          ? "No gathering node types defined yet"
          : undefined,
    onClick: () => toggleMarkerTool(item.markerKind),
  }));

  const zoneEntries: PaletteEntry[] = [
    {
      key: "zone",
      label: "Enemy Spawn Zone",
      swatchColor: "#e0503c",
      swatchClassName: "palette-swatch palette-swatch-circle",
      active: activeTool?.mode === "zone",
      disabled: !mapId,
      onClick: toggleZoneTool,
    },
  ];

  const furnitureEntries: PaletteEntry[] = FURNITURE_PALETTE.map((item) => ({
    key: item.furnitureKind,
    label: item.label,
    thumbnail: item.thumbnail,
    active: activeTool?.mode === "furniture" && activeTool.furnitureKind === item.furnitureKind,
    disabled: !mapId,
    onClick: () => toggleFurnitureTool(item.furnitureKind),
  }));

  const buildingEntries: PaletteEntry[] = BUILDING_PALETTE.map((item) => ({
    key: item.modelId,
    label: item.label,
    thumbnail: item.thumbnail,
    active: activeTool?.mode === "structure" && activeTool.structureModelId === item.modelId,
    disabled: !mapId,
    onClick: () => toggleStructureTool(item.modelId),
  }));

  const lampEntries: PaletteEntry[] = LAMP_PALETTE.map((item) => ({
    key: item.modelId,
    label: item.label,
    thumbnail: item.thumbnail,
    active: activeTool?.mode === "lamp" && activeTool.lampModelId === item.modelId,
    disabled: !mapId,
    onClick: () => toggleLampTool(item.modelId),
  }));

  const decorationEntries: PaletteEntry[] = DECORATION_PALETTE.map((item) => ({
    key: item.furnitureKind,
    label: item.label,
    thumbnail: item.thumbnail,
    active: activeTool?.mode === "furniture" && activeTool.furnitureKind === item.furnitureKind,
    disabled: !mapId || activeMap?.kind !== "overworld",
    title: activeMap?.kind !== "overworld" ? "Dungeons have no outdoor decoration" : item.title,
    onClick: () => toggleFurnitureTool(item.furnitureKind),
  }));

  const natureEntries: PaletteEntry[] = NATURE_PALETTE.map((item) => ({
    key: item.furnitureKind,
    label: item.label,
    thumbnail: item.thumbnail,
    active: activeTool?.mode === "furniture" && activeTool.furnitureKind === item.furnitureKind,
    disabled: !mapId || activeMap?.kind !== "overworld",
    title: activeMap?.kind !== "overworld" ? "Dungeons have no outdoor decoration" : item.title,
    onClick: () => toggleFurnitureTool(item.furnitureKind),
  }));

  const propsEntries: PaletteEntry[] = PROPS_PALETTE.map((item) => ({
    key: item.furnitureKind,
    label: item.label,
    thumbnail: item.thumbnail,
    active: activeTool?.mode === "furniture" && activeTool.furnitureKind === item.furnitureKind,
    disabled: !mapId,
    onClick: () => toggleFurnitureTool(item.furnitureKind),
  }));

  return (
    <div className="map-editor">
      <div className="map-editor-toolbar">
        <select value={mapId} onChange={(e) => setMapId(e.target.value)}>
          {maps.map((m) => (
            <option key={String(m.id)} value={String(m.id)}>
              {String(m.name)} {m.is_active ? "(active)" : ""}
            </option>
          ))}
        </select>

        {activeTool ? (
          // Replaces the old top-toolbar "+wall/+door/+tower/+gate/+NPC/+Enemy Spawn/+Waypoint"
          // buttons, all of which are now palette tools instead (see WALL_PALETTE/MARKER_PALETTE
          // above) - while one is active, this status readout + stop button take that space
          // instead, so it's always visible what clicking the canvas will do right now.
          <span className="map-editor-tool-status">
            <span className="map-editor-tool-status-dot" />
            Placing <strong>{describeActiveTool(activeTool)}</strong> — click the map to place, click again for more
            <button onClick={() => setActiveTool(null)}>Stop (Esc)</button>
          </span>
        ) : (
          <>
            {selected?.type === "structures" && (
              <span className="map-editor-toolbar-group">
                {(["translate", "rotate", "scale"] as GizmoMode[]).map((mode) => (
                  <button key={mode} className={mode === gizmoMode ? "active" : ""} onClick={() => setGizmoMode(mode)}>
                    {mode}
                  </button>
                ))}
              </span>
            )}
            {selected?.type === "furniture" && (
              <span className="map-editor-toolbar-group">
                {(["translate", "rotate"] as GizmoMode[]).map((mode) => (
                  <button key={mode} className={mode === gizmoMode ? "active" : ""} onClick={() => setGizmoMode(mode)}>
                    {mode}
                  </button>
                ))}
              </span>
            )}
            {selected?.type === "enemy-spawn-zones" && (
              <span className="map-editor-toolbar-group">
                {(["translate", "scale"] as GizmoMode[]).map((mode) => (
                  <button key={mode} className={mode === gizmoMode ? "active" : ""} onClick={() => setGizmoMode(mode)}>
                    {mode === "scale" ? "resize" : mode}
                  </button>
                ))}
              </span>
            )}
          </>
        )}
      </div>

      <div className="map-editor-body">
        <div className="map-editor-canvas" ref={containerRef} />
        <div className="map-editor-right">
          <div className="map-editor-palette">
            <input
              type="text"
              className="palette-filter"
              placeholder="Search palette…"
              value={paletteFilter}
              onChange={(e) => setPaletteFilter(e.target.value)}
            />
            <PaletteSection id="tiles" title="Tiles" entries={tileEntries} filter={paletteFilter} openSections={openSections} setOpenSections={setOpenSections} />
            <PaletteSection id="structures" title="Structures" entries={wallEntries} filter={paletteFilter} openSections={openSections} setOpenSections={setOpenSections} />
            <PaletteSection id="markers" title="Markers" entries={markerEntries} filter={paletteFilter} openSections={openSections} setOpenSections={setOpenSections} />
            <PaletteSection id="zones" title="Spawn Zones" entries={zoneEntries} filter={paletteFilter} openSections={openSections} setOpenSections={setOpenSections} />
            <PaletteSection id="buildings" title="Buildings" entries={buildingEntries} filter={paletteFilter} openSections={openSections} setOpenSections={setOpenSections} />
            <PaletteSection id="lamps" title="Lamps" entries={lampEntries} filter={paletteFilter} openSections={openSections} setOpenSections={setOpenSections} />
            <PaletteSection id="furniture" title="Furniture" entries={furnitureEntries} filter={paletteFilter} openSections={openSections} setOpenSections={setOpenSections} />
            <PaletteSection id="decoration" title="Decoration" entries={decorationEntries} filter={paletteFilter} openSections={openSections} setOpenSections={setOpenSections} />
            <PaletteSection id="nature" title="Nature" entries={natureEntries} filter={paletteFilter} openSections={openSections} setOpenSections={setOpenSections} />
            <PaletteSection id="props" title="Props" entries={propsEntries} filter={paletteFilter} openSections={openSections} setOpenSections={setOpenSections} />
          </div>
          {selected && inspectorSchema && (
            <div className="map-editor-inspector">
              <div className="entity-table-header">
                {/* The portal/spawn markers' "row" is the whole active map, not a leaf marker of
                    their own (see isMapPointType's doc comment) - deleting a map is already a
                    dedicated, guarded flow from the Maps table, not something reachable by
                    dragging a point around, so this hides Delete rather than risk it reading as
                    "delete this point". */}
                <h3>
                  {selected.type === "map-portal"
                    ? "Dungeon Portal"
                    : selected.type === "map-spawn"
                      ? "Spawn Point"
                      : inspectorSchema.label.replace(/s$/, "")}
                </h3>
                {!isMapPointType(selected.type) && <button onClick={handleDelete}>Delete</button>}
              </div>
              <EntityForm
                // EntityForm seeds its internal state from `initial` only once, on mount (see its
                // useState lazy initializer) - keying on the row's own data forces a remount (and
                // therefore a fresh seed) whenever a gizmo drag changes it server-side, so the
                // form doesn't keep showing pre-drag values.
                key={JSON.stringify(selected.row)}
                schema={inspectorSchema}
                initial={selected.row}
                onSubmit={handleFormSubmit}
                onCancel={() => setSelected(null)}
                submitting={submitting}
                error={formError}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
