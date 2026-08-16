import * as THREE from "three";
import {
  STRUCTURE_DOOR_WIDTH_FRACTION,
  STRUCTURE_GATE_PILLAR_FRACTION,
  STRUCTURE_MAX_DOOR_WIDTH,
  STRUCTURE_WALL_THICKNESS,
  StructureDef,
} from "@mmo/shared";

// Mirrors client/src/game/Structure.ts's geometry exactly (same shared wall/door/pillar
// constants), minus the fade-material bookkeeping - the editor always shows structures fully
// solid, there's no walk-in fading concept here. Kept as a separate file rather than imported
// from the client app or moved into @mmo/shared: admin has no other Three.js code today and
// shared is deliberately rendering-library-free (the server imports it too). The duplication is
// the ~80 lines of box/cone construction below, not the numbers that actually matter for
// correctness (those stay single-sourced in @mmo/shared).
const ROOF_COLOR = 0x4a3626;

function pyramidRoof(width: number, depth: number, height: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.ConeGeometry((Math.max(width, depth) / 2) * 1.15, height, 4),
    new THREE.MeshStandardMaterial({ color: ROOF_COLOR }),
  );
  mesh.rotation.y = Math.PI / 4;
  return mesh;
}

function buildHouse(def: StructureDef): THREE.Object3D {
  const group = new THREE.Group();
  const wallHeight = def.height * 0.7;
  const wallMaterial = new THREE.MeshStandardMaterial({ color: def.color });

  const doorWidth = Math.min(def.width * STRUCTURE_DOOR_WIDTH_FRACTION, STRUCTURE_MAX_DOOR_WIDTH);
  const frontSegmentWidth = (def.width - doorWidth) / 2;
  if (frontSegmentWidth > 0.05) {
    for (const sign of [-1, 1]) {
      const segment = new THREE.Mesh(new THREE.BoxGeometry(frontSegmentWidth, wallHeight, STRUCTURE_WALL_THICKNESS), wallMaterial);
      segment.position.set(sign * (doorWidth / 2 + frontSegmentWidth / 2), wallHeight / 2, -def.depth / 2);
      group.add(segment);
    }
  }

  const backWall = new THREE.Mesh(new THREE.BoxGeometry(def.width, wallHeight, STRUCTURE_WALL_THICKNESS), wallMaterial);
  backWall.position.set(0, wallHeight / 2, def.depth / 2);
  group.add(backWall);

  for (const sign of [-1, 1]) {
    const sideWall = new THREE.Mesh(new THREE.BoxGeometry(STRUCTURE_WALL_THICKNESS, wallHeight, def.depth), wallMaterial);
    sideWall.position.set((sign * def.width) / 2, wallHeight / 2, 0);
    group.add(sideWall);
  }

  const roof = pyramidRoof(def.width, def.depth, def.height * 0.4);
  roof.position.y = wallHeight + (def.height * 0.4) / 2;
  group.add(roof);

  return group;
}

function buildWall(def: StructureDef): THREE.Object3D {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(def.width, def.height, def.depth),
    new THREE.MeshStandardMaterial({ color: def.color }),
  );
  mesh.position.y = def.height / 2;
  return mesh;
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

  const cap = pyramidRoof(def.width, def.depth, def.height * 0.25);
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
    case "house":
    case "shop":
      return buildHouse(def);
    case "wall":
      return buildWall(def);
    case "tower":
      return buildTower(def);
    case "gate":
      return buildGate(def);
  }
}
