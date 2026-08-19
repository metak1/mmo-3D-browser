import * as THREE from "three";
import { FurnitureDef, getTerrainHeight } from "@mmo/shared";
import { woodTexture } from "./textures";
import { softTint } from "./textureTint";

// Every piece is a fixed-proportion low-poly shape (no admin-set size, unlike a structure) - kind
// alone picks the silhouette, softTint(def.color) is the only per-instance variation, same
// division of responsibility Player/Npc/Enemy already use for their own fixed-size bodies.

// The build*() functions below are dimensioned close to real-world furniture scale, which reads
// as noticeably undersized next to MODEL_HEIGHT (1.7) once actually seen next to a player in this
// game's fixed isometric camera - bumped up so a chair/table registers as "sized for someone
// about this tall" instead of dollhouse furniture.
const FURNITURE_SCALE = 1.6;

function woodMaterial(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: softTint(color), map: woodTexture(1, 1) });
}

function buildTable(color: string): THREE.Object3D {
  const group = new THREE.Group();
  const material = woodMaterial(color);

  const top = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.8), material);
  top.position.y = 0.75;
  group.add(top);

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.72, 0.08), material);
      leg.position.set(sx * 0.52, 0.36, sz * 0.32);
      group.add(leg);
    }
  }
  return group;
}

function buildChair(color: string): THREE.Object3D {
  const group = new THREE.Group();
  const material = woodMaterial(color);

  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.07, 0.42), material);
  seat.position.y = 0.45;
  group.add(seat);

  const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.06), material);
  back.position.set(0, 0.7, -0.18);
  group.add(back);

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.06), material);
      leg.position.set(sx * 0.17, 0.225, sz * 0.17);
      group.add(leg);
    }
  }
  return group;
}

function buildBarrel(color: string): THREE.Object3D {
  const group = new THREE.Group();
  const bodyMaterial = woodMaterial(color);
  const bandMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2117 });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.65, 12), bodyMaterial);
  body.position.y = 0.325;
  group.add(body);

  for (const y of [0.15, 0.5]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.325, 0.025, 6, 16), bandMaterial);
    band.rotation.x = Math.PI / 2;
    band.position.y = y;
    group.add(band);
  }
  return group;
}

function buildCrate(color: string): THREE.Object3D {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), woodMaterial(color));
  mesh.position.y = 0.3;
  return mesh;
}

function buildBookshelf(color: string): THREE.Object3D {
  const group = new THREE.Group();
  const material = woodMaterial(color);

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.6, 0.3), material);
  body.position.y = 0.8;
  group.add(body);

  // Three shelf lines (thin darker strips on the front face) hint at what would otherwise just
  // be a plain box - enough to read as "bookshelf" from the fixed overhead camera without going
  // as far as modeling individual books.
  const shelfMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2117 });
  for (const y of [0.5, 0.9, 1.3]) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.04, 0.28), shelfMaterial);
    shelf.position.set(0, y, 0.01);
    group.add(shelf);
  }
  return group;
}

// Every existing avatar in this codebase (Player/Npc/Enemy/Structure) is simple procedural
// Three.js geometry with no asset loading - furniture follows the same convention. Purely
// decorative: never collides, never interacted with, exists only to dress an enclosed room (see
// StructureEnclosureAvatar) so it doesn't read as an empty box.
export class FurnitureAvatar {
  readonly group = new THREE.Group();

  constructor(def: FurnitureDef) {
    let object: THREE.Object3D;
    switch (def.kind) {
      case "table":
        object = buildTable(def.color);
        break;
      case "chair":
        object = buildChair(def.color);
        break;
      case "barrel":
        object = buildBarrel(def.color);
        break;
      case "crate":
        object = buildCrate(def.color);
        break;
      case "bookshelf":
        object = buildBookshelf(def.color);
        break;
      default:
        object = new THREE.Group(); // unrecognized kind (e.g. stale data) - render nothing rather than crash
    }
    object.scale.setScalar(FURNITURE_SCALE);
    this.group.add(object);
    this.group.position.set(def.x, getTerrainHeight(def.x, def.z) + def.yOffset, def.z);
    this.group.rotation.y = def.rotationY;
  }

  addTo(scene: THREE.Scene) {
    scene.add(this.group);
  }

  removeFrom(scene: THREE.Scene) {
    scene.remove(this.group);
  }
}
