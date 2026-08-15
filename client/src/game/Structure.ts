import * as THREE from "three";
import {
  STRUCTURE_DOOR_WIDTH_FRACTION,
  STRUCTURE_GATE_PILLAR_FRACTION,
  STRUCTURE_MAX_DOOR_WIDTH,
  STRUCTURE_WALL_THICKNESS,
  StructureDef,
} from "@mmo/shared";

// Fixed regardless of an individual structure's wall color, so roofs/caps always read clearly
// against whatever color an admin picks for the walls.
const ROOF_COLOR = 0x4a3626;
const FLOOR_COLOR = 0x6b4a30;
const PROP_COLOR = 0x3d2a1a;

// How translucent a house/shop's roof gets once the player is well inside its footprint, and how
// many world units beyond the footprint the fade transitions over (WoW-style "walk under the
// roof") - walls stay solid always, see buildHouse's doorway gap for how you actually get in.
const FADE_MIN_OPACITY = 0.12;
const FADE_MARGIN = 3;

function pyramidRoof(width: number, depth: number, height: number): { mesh: THREE.Mesh; material: THREE.MeshStandardMaterial } {
  const material = new THREE.MeshStandardMaterial({ color: ROOF_COLOR, transparent: true });
  const mesh = new THREE.Mesh(new THREE.ConeGeometry((Math.max(width, depth) / 2) * 1.15, height, 4), material);
  mesh.rotation.y = Math.PI / 4;
  return { mesh, material };
}

// A bare floor + a single prop, just enough that "inside" doesn't read as an empty void once the
// walls/roof fade out - not a real furnished room, this game has no interior content system.
function buildInterior(def: StructureDef): THREE.Object3D {
  const group = new THREE.Group();

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(def.width * 0.85, def.depth * 0.85),
    new THREE.MeshStandardMaterial({ color: FLOOR_COLOR }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.02;
  group.add(floor);

  const propSize = Math.min(def.width, def.depth) * 0.25;
  const prop = new THREE.Mesh(new THREE.BoxGeometry(propSize, 0.4, propSize), new THREE.MeshStandardMaterial({ color: PROP_COLOR }));
  prop.position.y = 0.2;
  group.add(prop);

  return group;
}

interface BuiltStructure {
  object: THREE.Object3D;
  // Materials that fade as the player approaches - empty for kinds with no walkable interior.
  fadeMaterials: THREE.MeshStandardMaterial[];
}

// Four separate wall segments rather than one solid box, so the walls can stay fully solid
// (a real building silhouette from every angle) while the front one leaves an actual gap to
// walk through - the doorway - instead of relying on fading to get inside. Local -z is the
// front/entrance side by convention; a structure's rotationY reorients the whole doorway with it.
function buildHouse(def: StructureDef): BuiltStructure {
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

  const { mesh: roof, material: roofMaterial } = pyramidRoof(def.width, def.depth, def.height * 0.4);
  roof.position.y = wallHeight + (def.height * 0.4) / 2;
  group.add(roof);

  group.add(buildInterior(def));

  return { object: group, fadeMaterials: [roofMaterial] };
}

function buildWall(def: StructureDef): BuiltStructure {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(def.width, def.height, def.depth),
    new THREE.MeshStandardMaterial({ color: def.color }),
  );
  mesh.position.y = def.height / 2;
  return { object: mesh, fadeMaterials: [] };
}

function buildTower(def: StructureDef): BuiltStructure {
  const group = new THREE.Group();
  const bodyHeight = def.height * 0.85;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(def.width, bodyHeight, def.depth),
    new THREE.MeshStandardMaterial({ color: def.color }),
  );
  body.position.y = bodyHeight / 2;
  group.add(body);

  const { mesh: cap } = pyramidRoof(def.width, def.depth, def.height * 0.25);
  cap.position.y = bodyHeight + (def.height * 0.25) / 2;
  group.add(cap);
  return { object: group, fadeMaterials: [] };
}

function buildGate(def: StructureDef): BuiltStructure {
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
  return { object: group, fadeMaterials: [] };
}

// Every existing avatar in this codebase (Player/Npc/Enemy) is simple procedural Three.js
// geometry with no asset loading - structures follow the same convention. kind selects one of
// these hardcoded shape builders; everything else (position/size/color/rotation) is admin content.
// Walls/pillars are solid and actually block the player server-side (see shared's
// getStructureColliders/resolveStructureCollisions) - houses/shops leave a real doorway gap to
// walk through, and their roof fades out once inside so the interior stays visible under the
// angled camera (see update()).
export class StructureAvatar {
  readonly group = new THREE.Group();
  private readonly fadeMaterials: THREE.MeshStandardMaterial[];
  private readonly fadeInnerRadius: number;

  constructor(private readonly def: StructureDef) {
    let built: BuiltStructure;
    switch (def.kind) {
      case "house":
      case "shop":
        built = buildHouse(def);
        break;
      case "wall":
        built = buildWall(def);
        break;
      case "tower":
        built = buildTower(def);
        break;
      case "gate":
        built = buildGate(def);
        break;
    }
    this.group.add(built.object);
    this.group.position.set(def.x, 0, def.z);
    this.group.rotation.y = def.rotationY;

    this.fadeMaterials = built.fadeMaterials;
    this.fadeInnerRadius = Math.max(def.width, def.depth) / 2;
  }

  // Called every frame with the local player's world position - a no-op for kinds with nothing
  // to fade (wall/tower/gate never build any fadeMaterials).
  update(playerX: number, playerZ: number) {
    if (this.fadeMaterials.length === 0) return;

    const dist = Math.hypot(playerX - this.def.x, playerZ - this.def.z);
    const t = Math.min(1, Math.max(0, (dist - this.fadeInnerRadius) / FADE_MARGIN));
    const opacity = FADE_MIN_OPACITY + (1 - FADE_MIN_OPACITY) * t;
    for (const material of this.fadeMaterials) material.opacity = opacity;
  }

  addTo(scene: THREE.Scene) {
    scene.add(this.group);
  }

  removeFrom(scene: THREE.Scene) {
    scene.remove(this.group);
  }
}
