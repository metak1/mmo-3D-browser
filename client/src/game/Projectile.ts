import * as THREE from "three";
import { getTerrainHeight } from "@mmo/shared";

const INTERPOLATION_LERP = 0.5;
const FLIGHT_HEIGHT = 0.7; // above the ground directly beneath the projectile's current x/z

export class ProjectileAvatar {
  readonly mesh: THREE.Mesh;
  private targetPosition = new THREE.Vector3();

  constructor(color: number, emissive: number) {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 8, 8),
      new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 0.6 }),
    );
  }

  // Rides the terrain contour at a fixed height above whatever ground is directly below it right
  // now (same self-sampling approach as every other avatar) rather than a fixed world-absolute
  // Y - a spell/arrow flying at a flat height would otherwise clip straight through hills now
  // that the overworld has real elevation (see shared's getTerrainHeight).
  setTarget(x: number, z: number) {
    this.targetPosition.set(x, getTerrainHeight(x, z) + FLIGHT_HEIGHT, z);
  }

  snapToTarget() {
    this.mesh.position.copy(this.targetPosition);
  }

  update() {
    this.mesh.position.lerp(this.targetPosition, INTERPOLATION_LERP);
  }
}
