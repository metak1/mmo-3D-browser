import * as THREE from "three";
import { EffectShape } from "@mmo/shared";

const SEGMENTS = 48; // circle/cone arc smoothness
const COLOR = 0xe0503c; // same red already meaningful elsewhere (low HP, aggro-on-me)
const OPACITY = 0.35;
const Y_OFFSET = 0.03; // clears z-fighting with the terrain plane

function buildCircleGeometry(): THREE.BufferGeometry {
  return new THREE.CircleGeometry(1, SEGMENTS);
}

// A flat wedge (apex at the caster, "forward" along local +Z, matching this codebase's own
// atan2(dx,dz) facing convention everywhere else) spanning `angleDeg` out to `radius` - the same
// shape server-side unitMatchesShape's cone branch tests against, so what's drawn here lines up
// with who actually takes the hit.
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

// A flat rectangle from the caster (local origin) to `length` along local +Z, `width` wide -
// matches server-side unitMatchesShape's line branch (a caster->impact segment with a perpendicular
// half-width band).
function buildLineGeometry(length: number, width: number): THREE.BufferGeometry {
  const half = width / 2;
  const positions = [-half, 0, 0, half, 0, 0, half, 0, length, -half, 0, length];
  const indices = [0, 1, 2, 0, 2, 3];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

// A translucent ground decal previewing an EffectShape - generalizes what used to be AoeCircle
// (circle-only) so a boss ability or ground-targeted spell using any composable shape gets a
// telegraph "for free" with no new per-shape client code (see main.ts's updateEnemyTelegraph,
// which now just reads whatever shape the ability/spell actually has). Not scene-aware itself
// (mirrors HealthBar's shape) - the caller adds/removes `mesh` and repositions it every frame.
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

  // Rebuilds the mesh's geometry to match `shape`. `facingRadians` (only meaningful for cone/line,
  // ignored otherwise) is the same atan2(dx,dz) toward the impact point used everywhere else in
  // this codebase - pass the caster->impact direction so what's drawn matches the server's own
  // "aimed at the impact point" cone/line math. singleTarget/randomPoints have no fixed area to
  // preview (randomPoints' actual landing spots are randomized server-side per cast, so any fixed
  // preview would lie) - hide() is the caller's job for those, this just no-ops geometry-wise.
  setShape(shape: EffectShape, facingRadians = 0) {
    this.mesh.geometry.dispose();
    if (shape.kind === "circle") {
      this.mesh.geometry = buildCircleGeometry();
      this.mesh.rotation.x = -Math.PI / 2;
      this.mesh.rotation.y = 0;
      this.mesh.scale.setScalar(Math.max(shape.radius, 0.0001));
    } else if (shape.kind === "cone") {
      this.mesh.geometry = buildConeGeometry(shape.radius, shape.angleDeg);
      this.mesh.rotation.x = 0; // already flat in the XZ plane, unlike CircleGeometry's native XY plane
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
