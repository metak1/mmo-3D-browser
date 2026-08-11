import * as THREE from "three";

const INTERPOLATION_LERP = 0.5;

export class ProjectileAvatar {
  readonly mesh: THREE.Mesh;
  private targetPosition = new THREE.Vector3();

  constructor(color: number, emissive: number) {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 8, 8),
      new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 0.6 }),
    );
    this.mesh.position.y = 0.7;
  }

  setTarget(x: number, z: number) {
    this.targetPosition.set(x, 0.7, z);
  }

  snapToTarget() {
    this.mesh.position.copy(this.targetPosition);
  }

  update() {
    this.mesh.position.lerp(this.targetPosition, INTERPOLATION_LERP);
  }
}
