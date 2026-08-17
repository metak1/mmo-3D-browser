import * as THREE from "three";

const SEGMENTS = 48;
const COLOR = 0xe0503c; // same red already meaningful elsewhere (low HP, aggro-on-me)
const OPACITY = 0.35;
const Y_OFFSET = 0.03; // clears z-fighting with the terrain plane

// A translucent ground disc marking an AoE's danger/placement radius. One unit-radius geometry
// scaled per-instance (mesh.scale.setScalar) rather than regenerating geometry per radius change.
// Not scene-aware itself (mirrors HealthBar's shape) - the caller adds/removes `mesh` and
// repositions it every frame, since it often needs to track something other than its owner's own
// transform (e.g. a boss's splash centered on its target, not on the boss).
export class AoeCircle {
  readonly mesh: THREE.Mesh;

  constructor() {
    this.mesh = new THREE.Mesh(
      new THREE.CircleGeometry(1, SEGMENTS),
      new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: OPACITY, depthWrite: false }),
    );
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.visible = false;
    this.mesh.renderOrder = 4;
  }

  setRadius(radius: number) {
    this.mesh.scale.setScalar(Math.max(radius, 0.0001));
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
