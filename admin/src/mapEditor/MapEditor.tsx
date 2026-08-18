import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { getTerrainHeight, StructureDef, terrainSegments } from "@mmo/shared";
import { ENTITIES } from "../entities";
import { EntityForm } from "../EntityForm";
import { createEntity, deleteEntity, listEntities, updateEntity } from "../api";
import { buildStructureShape } from "./structureGeometry";

type RowData = Record<string, unknown>;
type SelectableType = "structures" | "npcs" | "enemy-spawns";
type GizmoMode = "translate" | "rotate" | "scale";

interface Selected {
  type: SelectableType;
  row: RowData;
}

const STRUCTURE_KINDS = ["house", "shop", "wall", "tower", "gate"] as const;
const NPC_MARKER_COLOR = 0xf5d76e;
const SPAWN_MARKER_COLOR = 0xe05a4e;
const GROUND_COLOR = 0x2b3348;
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
  ground: THREE.Mesh;
  grid: THREE.GridHelper;
  raycaster: THREE.Raycaster;
}

export function MapEditor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const threeRef = useRef<ThreeContext | null>(null);

  const [maps, setMaps] = useState<RowData[]>([]);
  const [mapId, setMapId] = useState<string>("");
  const [structures, setStructures] = useState<RowData[]>([]);
  const [npcs, setNpcs] = useState<RowData[]>([]);
  const [spawns, setSpawns] = useState<RowData[]>([]);
  const [enemyTypes, setEnemyTypes] = useState<RowData[]>([]);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>("translate");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Mirrors of state the persistent (set-up-once) event handlers below need to read without
  // re-binding on every render - the classic stale-closure trap for imperative/React hybrids.
  const selectedRef = useRef<Selected | null>(null);
  const gizmoModeRef = useRef<GizmoMode>("translate");
  selectedRef.current = selected;
  gizmoModeRef.current = gizmoMode;

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

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({ color: GROUND_COLOR }),
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    const grid = new THREE.GridHelper(1, 1, GRID_COLOR, GRID_COLOR_DARK);
    scene.add(grid);

    const content = new THREE.Group();
    scene.add(content);

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

    threeRef.current = { renderer, scene, camera, orbit, transform, content, ground, grid, raycaster };

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
      const hits = raycaster.intersectObjects(content.children, true);
      for (const hit of hits) {
        let obj: THREE.Object3D | null = hit.object;
        while (obj && !obj.userData.entityType) obj = obj.parent;
        if (obj) {
          selectByTag(obj.userData.entityType as SelectableType, obj.userData.entityId as string);
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
  structuresRef.current = structures;
  npcsRef.current = npcs;
  spawnsRef.current = spawns;

  function selectByTag(type: SelectableType, id: string) {
    const list = type === "structures" ? structuresRef.current : type === "npcs" ? npcsRef.current : spawnsRef.current;
    const row = list.find((r) => String(r.id) === id);
    if (row) setSelected({ type, row });
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
    } else if (sel.type === "structures" && gizmoModeRef.current === "rotate") {
      changes.rotation_y = round(mesh.rotation.y, 3);
    } else {
      changes.x = round(mesh.position.x);
      changes.z = round(mesh.position.z);
      // Only structures/npcs have a y_offset column (see the translate showY gate above) - the
      // drag may have moved the mesh vertically, so re-derive the offset from the ground height
      // at its (possibly also just-moved) x/z rather than assuming only y changed.
      if (sel.type === "structures" || sel.type === "npcs") {
        const structureDefs = sel.type === "structures" ? toStructureDefs(structuresRef.current) : [];
        const halfExtent = Number(activeMap?.half_extent) || 50;
        const groundY = getTerrainHeight(mesh.position.x, mesh.position.z, structureDefs, halfExtent);
        changes.y_offset = round(mesh.position.y - groundY);
      }
    }

    updateEntity(sel.type, String(sel.row.id), changes).then(() => reloadContent());
  };

  // --- Sync the Three.js scene from current React state ---

  useEffect(() => {
    const three = threeRef.current;
    if (!three || !activeMap) return;

    const isOverworld = activeMap.kind === "overworld";
    const halfExtent = Number(activeMap.half_extent) || 50;
    const size = halfExtent * 2;

    // getTerrainHeight's flattening-under-buildings needs the actual structure list - admin
    // never calls loadGameContent (it reads the REST API directly, not the live-game content
    // snapshot), so the shared STRUCTURES binding it'd otherwise default to is always empty
    // here. Built once per sync and threaded through every getTerrainHeight call below.
    const structureDefs = toStructureDefs(structures);
    const terrainY = (x: number, z: number) => (isOverworld ? getTerrainHeight(x, z, structureDefs, halfExtent) : 0);

    three.ground.geometry.dispose();
    // Same technique as client/src/game/Scene.ts's setupGround - dungeons stay a flat quad, the
    // overworld gets real segments displaced by the same shared getTerrainHeight function, at the
    // same terrainSegments density, so this view always matches what the live game renders.
    const segments = isOverworld ? terrainSegments(halfExtent) : 1;
    const groundGeometry = new THREE.PlaneGeometry(size, size, segments, segments);
    if (isOverworld) {
      const pos = groundGeometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        pos.setZ(i, terrainY(pos.getX(i), -pos.getY(i)));
      }
      pos.needsUpdate = true;
      groundGeometry.computeVertexNormals();
    }
    three.ground.geometry = groundGeometry;

    three.scene.remove(three.grid);
    three.grid.geometry.dispose();
    (three.grid.material as THREE.Material).dispose();
    three.grid = new THREE.GridHelper(size, Math.max(2, Math.round(size / 4)), GRID_COLOR, GRID_COLOR_DARK);
    three.scene.add(three.grid);

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
      group.position.set(def.x, terrainY(def.x, def.z) + def.yOffset, def.z);
      group.rotation.y = def.rotationY;
      group.userData = { entityType: "structures", entityId: def.id };
      three.content.add(group);
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

    // Re-attach the gizmo to whichever object is still selected (it was just rebuilt from
    // scratch above) and refresh its row data - otherwise the inspector form would keep
    // showing pre-drag values after a gizmo commit reloads fresh data from the server. Detach
    // if the row no longer exists at all (e.g. it just got deleted).
    if (selectedRef.current) {
      const { type, row } = selectedRef.current;
      const list = type === "structures" ? structures : type === "npcs" ? npcs : spawns;
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
  }, [structures, npcs, spawns, activeMap]);

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
    if (match) three.transform.attach(match);

    const mode: GizmoMode = selected.type === "structures" ? gizmoMode : "translate";
    three.transform.setMode(mode);
    if (mode === "translate") {
      three.transform.showX = true;
      // Structures/NPCs are static in the live game and have a y_offset field to carry a manual
      // vertical adjustment on top of the auto-computed terrain height - enemy spawns don't (the
      // enemy that spawns there moves and re-derives its height dynamically every frame, so a
      // y_offset on the spawn point would have no visible effect in game - not worth exposing).
      three.transform.showY = selected.type === "structures" || selected.type === "npcs";
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
    const row: RowData = {
      id: `structure_${Date.now()}`,
      name: `New ${kind}`,
      map_id: mapId,
      kind,
      x: 0,
      z: 0,
      rotation_y: 0,
      width: 4,
      depth: 4,
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
      </div>

      <div className="map-editor-body">
        <div className="map-editor-canvas" ref={containerRef} />
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
  );
}
