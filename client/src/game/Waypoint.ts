import * as THREE from "three";
import { getTerrainHeight } from "@mmo/shared";

const BEACON_COLOR = 0xf5c451;
const BEACON_EMISSIVE = 0x8a5a10;
const BOB_SPEED = 1.4; // radians/sec - purely decorative
const BOB_HEIGHT = 0.12;

// A tall glowing obelisk with a bobbing orb on top - distinct from PortalAvatar's ring (dungeon
// entry) and every unit shape, so a waypoint reads immediately as "a fast-travel point," not a
// dungeon portal or an NPC. Static shared content (no hp, never moves), spawned once from
// WAYPOINTS the same way NPCs/structures are - see main.ts.
export class WaypointAvatar {
  readonly group = new THREE.Group();
  private readonly orb: THREE.Mesh;
  private readonly baseOrbY: number;
  private age = 0;

  constructor() {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.18, 2.2, 8),
      new THREE.MeshStandardMaterial({ color: 0x3a3428 }),
    );
    post.position.y = 1.1;
    this.group.add(post);

    this.baseOrbY = 2.4;
    this.orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 16, 16),
      new THREE.MeshStandardMaterial({ color: BEACON_COLOR, emissive: BEACON_EMISSIVE, emissiveIntensity: 1.1 }),
    );
    this.orb.position.y = this.baseOrbY;
    this.group.add(this.orb);

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 16, 16),
      new THREE.MeshBasicMaterial({ color: BEACON_COLOR, transparent: true, opacity: 0.25 }),
    );
    glow.position.y = this.baseOrbY;
    this.group.add(glow);
  }

  setPosition(x: number, z: number) {
    this.group.position.set(x, getTerrainHeight(x, z), z);
  }

  update(dt: number) {
    this.age += dt;
    this.orb.position.y = this.baseOrbY + Math.sin(this.age * BOB_SPEED) * BOB_HEIGHT;
  }

  addTo(scene: THREE.Scene) {
    scene.add(this.group);
  }

  removeFrom(scene: THREE.Scene) {
    scene.remove(this.group);
  }
}
