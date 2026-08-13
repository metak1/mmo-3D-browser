import * as THREE from "three";

const PORTAL_COLOR = 0x4ac0e8;
const PORTAL_EMISSIVE = 0x1a6a8a;
const RING_SPIN_SPEED = 0.6; // radians/sec - purely decorative

// A glowing ring + translucent disc, distinct from every NPC (capsule) and enemy (box/
// octahedron/icosahedron) shape already in the game - reads immediately as "not a unit."
export class PortalAvatar {
  readonly group = new THREE.Group();
  private readonly ring: THREE.Mesh;

  constructor() {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.2, 0.22, 12, 32),
      new THREE.MeshStandardMaterial({ color: PORTAL_COLOR, emissive: PORTAL_EMISSIVE, emissiveIntensity: 0.8 }),
    );
    ring.position.y = 1.3;
    this.ring = ring;
    this.group.add(ring);

    const core = new THREE.Mesh(
      new THREE.CircleGeometry(1.0, 32),
      new THREE.MeshBasicMaterial({ color: PORTAL_COLOR, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
    );
    core.position.y = 1.3;
    this.group.add(core);
  }

  setPosition(x: number, z: number) {
    this.group.position.set(x, 0, z);
  }

  update(dt: number) {
    this.ring.rotation.z += dt * RING_SPIN_SPEED;
  }

  addTo(scene: THREE.Scene) {
    scene.add(this.group);
  }

  removeFrom(scene: THREE.Scene) {
    scene.remove(this.group);
  }
}
