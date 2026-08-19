import * as THREE from "three";
import { STRUCTURE_GATE_PILLAR_FRACTION, StructureDef, StructureLoop } from "@mmo/shared";

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

// Builds just the structure's own shape, unpositioned/unrotated (local origin at ground center,
// facing local -z) - the caller positions/rotates the returned group from the StructureDef's
// x/z/rotationY, same division of responsibility as client/src/game/Structure.ts's StructureAvatar.
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
      return new THREE.Group(); // unrecognized kind (e.g. stale data) - render nothing rather than crash
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
