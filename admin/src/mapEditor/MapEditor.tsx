import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import {
  findStructureLoops,
  FurnitureKind,
  getHexElevation,
  HexTerrainContent,
  HexTerrainKind,
  HEX_ELEVATION_STEP_WORLD,
  setTerrainFlat,
  StructureDef,
  worldToHex,
} from "@mmo/shared";
import { ENTITIES } from "../entities";
import { EntityForm } from "../EntityForm";
import { createEntity, deleteEntity, listEntities, updateEntity } from "../api";
import { BUILDING_MODEL_PATH, buildEnclosureShape, buildStructureShape, populateBuildingShape } from "./structureGeometry";
import { populateFurnitureShape } from "./furnitureGeometry";
import { buildHexTerrainPreview } from "./hexTerrainPreview";

type RowData = Record<string, unknown>;
type SelectableType = "structures" | "npcs" | "enemy-spawns" | "waypoints" | "furniture" | "hex-tiles";
type GizmoMode = "translate" | "rotate" | "scale";

interface Selected {
  type: SelectableType;
  row: RowData;
}

// A "tool" is what a click in the 3D view does while it's active: paint/erase a hex tile, or drop
// a new furniture piece - a real placement tool (Unity tile-palette/prefab-drop style), not the
// existing "+ button creates at (0,0), then drag it" round-trip every other entity still uses.
// null means normal click-to-select behavior.
type ActiveTool =
  | { mode: "tile"; tileKind: HexTerrainKind | "erase" }
  | { mode: "furniture"; furnitureKind: FurnitureKind }
  | { mode: "structure"; structureModelId: string }
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

const STRUCTURE_KINDS = ["wall", "door", "tower", "gate"] as const;

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
const NPC_MARKER_COLOR = 0xf5d76e;
const SPAWN_MARKER_COLOR = 0xe05a4e;
const WAYPOINT_MARKER_COLOR = 0xf5c451;
const GROUND_COLOR = 0x241a2e; // dungeon-only now - the overworld ground is the hex mosaic instead
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
}

export function MapEditor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const threeRef = useRef<ThreeContext | null>(null);

  const [maps, setMaps] = useState<RowData[]>([]);
  const [mapId, setMapId] = useState<string>("");
  const [structures, setStructures] = useState<RowData[]>([]);
  const [npcs, setNpcs] = useState<RowData[]>([]);
  const [spawns, setSpawns] = useState<RowData[]>([]);
  const [waypoints, setWaypoints] = useState<RowData[]>([]);
  const [furniture, setFurniture] = useState<RowData[]>([]);
  const [hexTiles, setHexTiles] = useState<RowData[]>([]);
  const [enemyTypes, setEnemyTypes] = useState<RowData[]>([]);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>("translate");
  const [activeTool, setActiveTool] = useState<ActiveTool>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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
  }, []);

  const reloadContent = useCallback(() => {
    if (!mapId) return;
    listEntities<RowData>("structures").then((res) => setStructures(res.items.filter((s) => s.map_id === mapId)));
    listEntities<RowData>("npcs").then((res) => setNpcs(res.items.filter((n) => n.map_id === mapId)));
    listEntities<RowData>("enemy-spawns").then((res) => setSpawns(res.items.filter((s) => s.map_id === mapId)));
    listEntities<RowData>("waypoints").then((res) => setWaypoints(res.items.filter((w) => w.map_id === mapId)));
    listEntities<RowData>("furniture").then((res) => setFurniture(res.items.filter((f) => f.map_id === mapId)));
    listEntities<RowData>("hex-tiles").then((res) => setHexTiles(res.items.filter((h) => h.map_id === mapId)));
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

    threeRef.current = { renderer, scene, camera, orbit, transform, content, ground, grid, raycaster, pickPlane };

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
  const waypointsRef = useRef<RowData[]>([]);
  const furnitureRef = useRef<RowData[]>([]);
  const hexTilesRef = useRef<RowData[]>([]);
  // Bumped every time the ground-rebuild block below starts a new async model load - see its own
  // comment for why a stale resolution needs to be discarded rather than clobbering newer content.
  const groundGenerationRef = useRef(0);
  structuresRef.current = structures;
  npcsRef.current = npcs;
  spawnsRef.current = spawns;
  waypointsRef.current = waypoints;
  furnitureRef.current = furniture;
  hexTilesRef.current = hexTiles;

  function refsByType(type: SelectableType): RowData[] {
    switch (type) {
      case "structures":
        return structuresRef.current;
      case "npcs":
        return npcsRef.current;
      case "enemy-spawns":
        return spawnsRef.current;
      case "waypoints":
        return waypointsRef.current;
      case "furniture":
        return furnitureRef.current;
      case "hex-tiles":
        return hexTilesRef.current;
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
    } else if ((sel.type === "structures" || sel.type === "furniture") && gizmoModeRef.current === "rotate") {
      changes.rotation_y = round(mesh.rotation.y, 3);
    } else {
      changes.x = round(mesh.position.x);
      changes.z = round(mesh.position.z);
      // Only structures/npcs/furniture have a y_offset column (see the translate showY gate
      // above) - the drag may have moved the mesh vertically, so re-derive the offset from the
      // ground height at its (possibly also just-moved) x/z rather than assuming only y changed.
      if (sel.type === "structures" || sel.type === "npcs" || sel.type === "furniture") {
        const structureDefs = sel.type === "structures" ? toStructureDefs(structuresRef.current) : [];
        const groundY =
          activeMap?.kind === "overworld"
            ? getHexElevation(mesh.position.x, mesh.position.z, buildHexContent(structureDefs)) * HEX_ELEVATION_STEP_WORLD
            : 0;
        changes.y_offset = round(mesh.position.y - groundY);
      }
    }

    updateEntity(sel.type, String(sel.row.id), changes).then(() => reloadContent());
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

    const isOverworld = activeMap.kind === "overworld";
    const halfExtent = Number(activeMap.half_extent) || 50;
    const size = halfExtent * 2;

    // Dungeons have no elevation at all (Scene.ts's own isDungeon branch is the live-game
    // equivalent) - the overworld does, via the discrete ramp-covered hex system below.
    setTerrainFlat(!isOverworld);

    // getHexElevation's flattening-under-buildings needs the actual structure list - admin never
    // calls loadGameContent (it reads the REST API directly, not the live-game content snapshot),
    // so the shared STRUCTURES binding it'd otherwise default to is always empty here. Built once
    // per sync and threaded through every elevation lookup below.
    const structureDefs = toStructureDefs(structures);
    const hexContent = buildHexContent(structureDefs);
    const terrainY = (x: number, z: number) => (isOverworld ? getHexElevation(x, z, hexContent) * HEX_ELEVATION_STEP_WORLD : 0);

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

    if (isOverworld) {
      // Loading the real tile models is async - a generation token guards against a stale load
      // (from a sync that's since been superseded by a newer one, e.g. rapid map/content changes)
      // landing its result on top of whatever the latest sync already built.
      const myGeneration = ++groundGenerationRef.current;
      buildHexTerrainPreview(halfExtent, hexContent).then((hexPreview) => {
        if (groundGenerationRef.current !== myGeneration || !threeRef.current) return;
        clearGround();
        three.ground.add(hexPreview);
      });
    } else {
      // Dungeons have no hex terrain of their own - a plain flat quad, same as the live game's
      // dungeon floor (Scene.ts's isDungeon branch).
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ color: GROUND_COLOR }));
      plane.rotation.x = -Math.PI / 2;
      three.ground.add(plane);
    }

    three.scene.remove(three.grid);
    three.grid.geometry.dispose();
    (three.grid.material as THREE.Material).dispose();
    three.grid = new THREE.GridHelper(size, Math.max(2, Math.round(size / 4)), GRID_COLOR, GRID_COLOR_DARK);
    // A square reference grid only makes sense over a flat quad - the overworld's hex mosaic
    // provides its own tiling reference, and the two grids z-fight against each other (both sit
    // at y=0) since the hex tiles no longer form one continuous mesh (see Scene.ts's identical
    // dungeon-only-grid reasoning, now doubly true here with the hex tiles' small inter-tile gaps).
    if (!isOverworld) three.scene.add(three.grid);

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
      const marker = buildMarker(NPC_MARKER_COLOR);
      const x = Number(row.x);
      const z = Number(row.z);
      const yOffset = Number(row.y_offset ?? 0);
      marker.position.set(x, terrainY(x, z) + yOffset, z);
      marker.userData = { entityType: "npcs", entityId: String(row.id) };
      three.content.add(marker);
    }

    for (const row of spawns) {
      const marker = buildMarker(SPAWN_MARKER_COLOR);
      const x = Number(row.x);
      const z = Number(row.z);
      marker.position.set(x, terrainY(x, z), z);
      marker.userData = { entityType: "enemy-spawns", entityId: String(row.id) };
      three.content.add(marker);
    }

    for (const row of waypoints) {
      const marker = buildMarker(WAYPOINT_MARKER_COLOR);
      const x = Number(row.x);
      const z = Number(row.z);
      marker.position.set(x, terrainY(x, z), z);
      marker.userData = { entityType: "waypoints", entityId: String(row.id) };
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
              : type === "waypoints"
                ? waypoints
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
  }, [structures, npcs, spawns, waypoints, furniture, hexTiles, activeMap]);

  // --- Attach the gizmo to the current selection + set its mode/axis constraints ---
  // (Separate from the scene-sync effect below: that one only re-runs when the fetched content
  // changes, so a plain click-to-select - which changes nothing about structures/npcs/spawns -
  // would otherwise update the inspector panel but never actually attach the gizmo.)

  useEffect(() => {
    const three = threeRef.current;
    if (!three) return;

    if (!selected) {
      three.transform.detach();
      return;
    }

    const match = three.content.children.find(
      (obj) => obj.userData.entityType === selected.type && obj.userData.entityId === String(selected.row.id),
    );
    // A selected hex tile has no match here at all (see the pointerdown handler's own comment on
    // why) - detach explicitly rather than leaving a stale gizmo attached to whatever was
    // previously selected.
    if (match) three.transform.attach(match);
    else three.transform.detach();

    // Furniture supports rotate (orienting a chair toward a table matters) but not scale - it has
    // no width/depth/height column to persist a scale change to (see commitTransformRef).
    const canRotate = selected.type === "structures" || selected.type === "furniture";
    const mode: GizmoMode = selected.type === "structures" ? gizmoMode : canRotate && gizmoMode === "rotate" ? "rotate" : "translate";
    three.transform.setMode(mode);
    if (mode === "translate") {
      three.transform.showX = true;
      // Structures/NPCs/furniture are static in the live game and have a y_offset field to carry
      // a manual vertical adjustment on top of the auto-computed terrain height - enemy spawns
      // don't (the enemy that spawns there moves and re-derives its height dynamically every
      // frame, so a y_offset on the spawn point would have no visible effect in game - not worth
      // exposing).
      three.transform.showY = selected.type === "structures" || selected.type === "npcs" || selected.type === "furniture";
      three.transform.showZ = true;
    } else if (mode === "rotate") {
      three.transform.showX = false;
      three.transform.showY = true; // only yaw exists in this game (StructureDef.rotationY)
      three.transform.showZ = false;
    } else {
      three.transform.showX = true;
      three.transform.showY = true;
      three.transform.showZ = true;
    }
  }, [selected, gizmoMode]);

  // --- Toolbar: create new content ---

  // Selecting the row we just created directly (rather than re-fetching and searching for it)
  // sidesteps a real timing hazard: the *Ref mirrors below are only updated on render, so a
  // freshly-fetched list wouldn't be visible to them until after this callback already returned.
  function createStructure(kind: (typeof STRUCTURE_KINDS)[number]) {
    if (!mapId) return;
    // wall/door default to a thin, wall-length box (place several end-to-end and drag their
    // translate/rotate gizmos to close a loop); tower/gate keep the old boxier default.
    const isWallLike = kind === "wall" || kind === "door";
    const row: RowData = {
      id: `structure_${Date.now()}`,
      name: `New ${kind}`,
      map_id: mapId,
      kind,
      x: 0,
      z: 0,
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
  }

  function createNpc() {
    if (!mapId) return;
    const row: RowData = { id: `npc_${Date.now()}`, name: "New NPC", x: 0, z: 0, map_id: mapId };
    createEntity("npcs", row).then(() => {
      reloadContent();
      setSelected({ type: "npcs", row });
    });
  }

  function createSpawn() {
    if (!mapId || enemyTypes.length === 0) return;
    const row: RowData = {
      id: `spawn_${Date.now()}`,
      map_id: mapId,
      enemy_type_id: String(enemyTypes[0].id),
      x: 0,
      z: 0,
    };
    createEntity("enemy-spawns", row).then(() => {
      reloadContent();
      setSelected({ type: "enemy-spawns", row });
    });
  }

  function createWaypoint() {
    if (!mapId) return;
    const row: RowData = { id: `waypoint_${Date.now()}`, name: "New Waypoint", map_id: mapId, x: 0, z: 0 };
    createEntity("waypoints", row).then(() => {
      reloadContent();
      setSelected({ type: "waypoints", row });
    });
  }

  // Toggling an already-active item back off returns to normal click-to-select; picking a
  // different one switches tools directly. Activating a tool also clears any current selection -
  // matching Unity's "an active tool owns viewport clicks" convention rather than mixing the two.
  function toggleTileTool(tileKind: HexTerrainKind | "erase") {
    setSelected(null);
    setActiveTool((prev) => (prev?.mode === "tile" && prev.tileKind === tileKind ? null : { mode: "tile", tileKind }));
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

  // --- Inspector panel (reuses the same EntityForm every table view uses) ---

  async function handleFormSubmit(data: RowData) {
    if (!selected) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const { id: _id, ...rest } = data;
      await updateEntity(selected.type, String(selected.row.id), rest);
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
    await deleteEntity(selected.type, String(selected.row.id));
    setSelected(null);
    reloadContent();
  }

  const inspectorSchema = selected ? ENTITIES.find((e) => e.key === selected.type) : undefined;

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
        <span className="map-editor-toolbar-group">
          {STRUCTURE_KINDS.map((kind) => (
            <button key={kind} onClick={() => createStructure(kind)} disabled={!mapId}>
              + {kind}
            </button>
          ))}
          <button onClick={createNpc} disabled={!mapId}>
            + NPC
          </button>
          <button onClick={createSpawn} disabled={!mapId || enemyTypes.length === 0}>
            + Enemy Spawn
          </button>
          <button onClick={createWaypoint} disabled={!mapId}>
            + Waypoint
          </button>
        </span>
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
      </div>

      <div className="map-editor-body">
        <div className="map-editor-canvas" ref={containerRef} />
        <div className="map-editor-right">
          <div className="map-editor-palette">
            <h3>Tiles</h3>
            <div className="palette-grid">
              {TILE_PALETTE.map((item) => (
                <button
                  key={item.tileKind}
                  className={activeTool?.mode === "tile" && activeTool.tileKind === item.tileKind ? "palette-item active" : "palette-item"}
                  onClick={() => toggleTileTool(item.tileKind)}
                  disabled={!mapId || activeMap?.kind !== "overworld"}
                  title={activeMap?.kind !== "overworld" ? "Dungeons have no hex terrain" : undefined}
                >
                  {item.thumbnail ? (
                    <img src={item.thumbnail} alt={item.label} className="palette-thumb" />
                  ) : (
                    <span className="palette-swatch palette-swatch-erase" />
                  )}
                  {item.label}
                </button>
              ))}
            </div>
            <h3>Furniture</h3>
            <div className="palette-grid">
              {FURNITURE_PALETTE.map((item) => (
                <button
                  key={item.furnitureKind}
                  className={
                    activeTool?.mode === "furniture" && activeTool.furnitureKind === item.furnitureKind
                      ? "palette-item active"
                      : "palette-item"
                  }
                  onClick={() => toggleFurnitureTool(item.furnitureKind)}
                  disabled={!mapId}
                >
                  <img src={item.thumbnail} alt={item.label} className="palette-thumb" />
                  {item.label}
                </button>
              ))}
            </div>
            <h3>Buildings</h3>
            <div className="palette-grid">
              {BUILDING_PALETTE.map((item) => (
                <button
                  key={item.modelId}
                  className={
                    activeTool?.mode === "structure" && activeTool.structureModelId === item.modelId
                      ? "palette-item active"
                      : "palette-item"
                  }
                  onClick={() => toggleStructureTool(item.modelId)}
                  disabled={!mapId}
                >
                  <img src={item.thumbnail} alt={item.label} className="palette-thumb" />
                  {item.label}
                </button>
              ))}
            </div>
            <h3>Decoration</h3>
            <div className="palette-grid">
              {DECORATION_PALETTE.map((item) => (
                <button
                  key={item.furnitureKind}
                  className={
                    activeTool?.mode === "furniture" && activeTool.furnitureKind === item.furnitureKind
                      ? "palette-item active"
                      : "palette-item"
                  }
                  onClick={() => toggleFurnitureTool(item.furnitureKind)}
                  disabled={!mapId || activeMap?.kind !== "overworld"}
                  title={activeMap?.kind !== "overworld" ? "Dungeons have no outdoor decoration" : item.title}
                >
                  <img src={item.thumbnail} alt={item.label} className="palette-thumb" />
                  {item.label}
                </button>
              ))}
            </div>
            <h3>Nature</h3>
            <div className="palette-grid">
              {NATURE_PALETTE.map((item) => (
                <button
                  key={item.furnitureKind}
                  className={
                    activeTool?.mode === "furniture" && activeTool.furnitureKind === item.furnitureKind
                      ? "palette-item active"
                      : "palette-item"
                  }
                  onClick={() => toggleFurnitureTool(item.furnitureKind)}
                  disabled={!mapId || activeMap?.kind !== "overworld"}
                  title={activeMap?.kind !== "overworld" ? "Dungeons have no outdoor decoration" : item.title}
                >
                  <img src={item.thumbnail} alt={item.label} className="palette-thumb" />
                  {item.label}
                </button>
              ))}
            </div>
            <h3>Props</h3>
            <div className="palette-grid">
              {PROPS_PALETTE.map((item) => (
                <button
                  key={item.furnitureKind}
                  className={
                    activeTool?.mode === "furniture" && activeTool.furnitureKind === item.furnitureKind
                      ? "palette-item active"
                      : "palette-item"
                  }
                  onClick={() => toggleFurnitureTool(item.furnitureKind)}
                  disabled={!mapId}
                >
                  <img src={item.thumbnail} alt={item.label} className="palette-thumb" />
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          {selected && inspectorSchema && (
            <div className="map-editor-inspector">
              <div className="entity-table-header">
                <h3>{inspectorSchema.label.replace(/s$/, "")}</h3>
                <button onClick={handleDelete}>Delete</button>
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
