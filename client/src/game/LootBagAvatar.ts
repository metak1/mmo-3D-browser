import * as THREE from "three";
import { getTerrainHeight } from "@mmo/shared";

const BAG_COLOR = 0x8b6b3d;

export class LootBagAvatar {
  readonly group = new THREE.Group();

  constructor() {
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 8, 6),
      new THREE.MeshStandardMaterial({ color: BAG_COLOR }),
    );
    body.scale.set(1, 0.75, 1);
    body.position.y = 0.24;
    this.group.add(body);

    const tie = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.12, 0.14, 8),
      new THREE.MeshStandardMaterial({ color: 0x5c4526 }),
    );
    tie.position.y = 0.44;
    this.group.add(tie);
  }

  setPosition(x: number, z: number) {
    this.group.position.set(x, getTerrainHeight(x, z), z);
  }

  addTo(scene: THREE.Scene) {
    scene.add(this.group);
  }

  removeFrom(scene: THREE.Scene) {
    scene.remove(this.group);
  }
}
