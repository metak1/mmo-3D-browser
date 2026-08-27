import * as THREE from "three";
import { EffectShape } from "@mmo/shared";

// Verbatim copy of client/src/game/Telegraph.ts - admin isn't part of the same Vite app as
// client, so it can't import that file directly (same reasoning as mapEditor/modelLoader.ts's
// own mirror of client/src/game/models.ts). Keep the two in sync by hand if the shape math changes.

const SEGMENTS = 48; // circle/cone arc smoothness
const COLOR = 0xe0503c; // same red already meaningful elsewhere (low HP, aggro-on-me)
const OPACITY = 0.35;
const Y_OFFSET = 0.03; // clears z-fighting with the ground plane

function buildCircleGeometry(): THREE.BufferGeometry {
  return new THREE.CircleGeometry(1, SEGMENTS);
}

function buildConeGeometry(radius: number, angleDeg: number): THREE.BufferGeometry {
  const halfAngle = (angleDeg * Math.PI) / 180 / 2;
  const positions: number[] = [0, 0, 0];
  const indices: number[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const angle = -halfAngle + (i / SEGMENTS) * (halfAngle * 2);
    positions.push(radius * Math.sin(angle), 0, radius * Math.cos(angle));
    if (i > 0) indices.push(0, i, i + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

function buildLineGeometry(length: number, width: number): THREE.BufferGeometry {
  const half = width / 2;
  const positions = [-half, 0, 0, half, 0, 0, half, 0, length, -half, 0, length];
  const indices = [0, 1, 2, 0, 2, 3];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

// A translucent ground decal previewing an EffectShape - not scene-aware itself, the caller
// adds/removes `mesh` and repositions it.
export class Telegraph {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshBasicMaterial;

  constructor() {
    this.material = new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: OPACITY, depthWrite: false });
    this.mesh = new THREE.Mesh(buildCircleGeometry(), this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.visible = false;
    this.mesh.renderOrder = 4;
  }

  setShape(shape: EffectShape, facingRadians = 0) {
    this.mesh.geometry.dispose();
    if (shape.kind === "circle") {
      this.mesh.geometry = buildCircleGeometry();
      this.mesh.rotation.x = -Math.PI / 2;
      this.mesh.rotation.y = 0;
      this.mesh.scale.setScalar(Math.max(shape.radius, 0.0001));
    } else if (shape.kind === "cone") {
      this.mesh.geometry = buildConeGeometry(shape.radius, shape.angleDeg);
      this.mesh.rotation.x = 0;
      this.mesh.rotation.y = facingRadians;
      this.mesh.scale.setScalar(1);
    } else if (shape.kind === "line") {
      this.mesh.geometry = buildLineGeometry(shape.length, shape.width);
      this.mesh.rotation.x = 0;
      this.mesh.rotation.y = facingRadians;
      this.mesh.scale.setScalar(1);
    } else {
      this.mesh.geometry = buildCircleGeometry();
      this.mesh.scale.setScalar(0.0001);
    }
  }

  setPosition(x: number, z: number) {
    this.mesh.position.set(x, Y_OFFSET, z);
  }

  show() {
    this.mesh.visible = true;
  }

  hide() {
    this.mesh.visible = false;
  }
}
