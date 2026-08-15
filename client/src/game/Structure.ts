import * as THREE from "three";
import { StructureDef } from "@mmo/shared";

// Fixed regardless of an individual structure's wall color, so roofs/caps always read clearly
// against whatever color an admin picks for the walls.
const ROOF_COLOR = 0x4a3626;

function pyramidRoof(width: number, depth: number, height: number): THREE.Mesh {
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry((Math.max(width, depth) / 2) * 1.15, height, 4),
    new THREE.MeshStandardMaterial({ color: ROOF_COLOR }),
  );
  roof.rotation.y = Math.PI / 4;
  return roof;
}

function buildHouse(def: StructureDef): THREE.Object3D {
  const group = new THREE.Group();
  const wallHeight = def.height * 0.7;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(def.width, wallHeight, def.depth),
    new THREE.MeshStandardMaterial({ color: def.color }),
  );
  body.position.y = wallHeight / 2;
  group.add(body);

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
  const pillarWidth = def.width * 0.25;
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

// Every existing avatar in this codebase (Player/Npc/Enemy) is simple procedural Three.js
// geometry with no asset loading - structures follow the same convention. kind selects one of
// these hardcoded shape builders; everything else (position/size/color/rotation) is admin content.
// Purely decorative: nothing in this game has collision, so structures never block movement.
export class StructureAvatar {
  readonly group = new THREE.Group();

  constructor(def: StructureDef) {
    let shape: THREE.Object3D;
    switch (def.kind) {
      case "house":
      case "shop":
        shape = buildHouse(def);
        break;
      case "wall":
        shape = buildWall(def);
        break;
      case "tower":
        shape = buildTower(def);
        break;
      case "gate":
        shape = buildGate(def);
        break;
    }
    this.group.add(shape);
    this.group.position.set(def.x, 0, def.z);
    this.group.rotation.y = def.rotationY;
  }

  addTo(scene: THREE.Scene) {
    scene.add(this.group);
  }

  removeFrom(scene: THREE.Scene) {
    scene.remove(this.group);
  }
}
