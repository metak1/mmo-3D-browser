import * as THREE from "three";

// No mount/animal 3D asset exists in this project (only class characters, dungeon furniture,
// hex-tile buildings, and nature scenery) - rather than sourcing a third-party GLTF blind
// (licensing/scale/rig risk), this is a small procedural low-poly mesh built from primitives,
// in the same blocky/toy spirit as the game's existing hex tiles and buildings.

const BODY_WIDTH = 0.55;
const BODY_HEIGHT = 0.55;
const BODY_LENGTH = 1.3;
const LEG_WIDTH = 0.14;
const LEG_LENGTH = 0.75;
const LEG_INSET_X = BODY_WIDTH / 2 - LEG_WIDTH / 2;
const LEG_INSET_Z = BODY_LENGTH / 2 - 0.15;
const NECK_LENGTH = 0.6;
const HEAD_SIZE = 0.3;

// Where the body sits above the ground, and (via PlayerAvatar) where the rider's feet rest -
// the top of the mount's back.
export const MOUNT_RIDE_HEIGHT = LEG_LENGTH + BODY_HEIGHT;

const BODY_COLOR = 0x8b5a2b;
const LEG_COLOR = 0x5c3a1e;
const MANE_COLOR = 0x2b1c10;

const GAIT_SPEED = 10; // radians/sec of the leg-swing sine wave while moving
const GAIT_AMPLITUDE = 0.5; // radians of hip swing at full stride
const IDLE_LERP = 0.15; // how quickly legs settle back to neutral when not moving

interface Leg {
  pivot: THREE.Group;
  phase: number; // 0 or Math.PI - diagonal pairs swing opposite each other (trot gait)
}

export class MountAvatar {
  readonly group = new THREE.Group();
  private readonly legs: Leg[] = [];
  private gaitClock = 0;

  constructor() {
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: BODY_COLOR });
    const legMaterial = new THREE.MeshStandardMaterial({ color: LEG_COLOR });
    const maneMaterial = new THREE.MeshStandardMaterial({ color: MANE_COLOR });

    const body = new THREE.Mesh(new THREE.BoxGeometry(BODY_WIDTH, BODY_HEIGHT, BODY_LENGTH), bodyMaterial);
    body.position.y = LEG_LENGTH + BODY_HEIGHT / 2;
    this.group.add(body);

    // Neck+head, tilted forward-up from the front of the body.
    const neck = new THREE.Mesh(new THREE.BoxGeometry(BODY_WIDTH * 0.7, NECK_LENGTH, BODY_WIDTH * 0.7), bodyMaterial);
    neck.position.set(0, LEG_LENGTH + BODY_HEIGHT + NECK_LENGTH * 0.25, BODY_LENGTH / 2 + 0.1);
    neck.rotation.x = -0.5;
    this.group.add(neck);

    const head = new THREE.Mesh(new THREE.BoxGeometry(HEAD_SIZE, HEAD_SIZE * 0.8, HEAD_SIZE * 1.4), bodyMaterial);
    head.position.set(0, LEG_LENGTH + BODY_HEIGHT + NECK_LENGTH * 0.65, BODY_LENGTH / 2 + 0.45);
    head.rotation.x = -0.3;
    this.group.add(head);

    const mane = new THREE.Mesh(new THREE.BoxGeometry(0.08, NECK_LENGTH * 0.9, 0.08), maneMaterial);
    mane.position.set(0, LEG_LENGTH + BODY_HEIGHT + NECK_LENGTH * 0.3, BODY_LENGTH / 2 - 0.05);
    mane.rotation.x = -0.5;
    this.group.add(mane);

    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.1), maneMaterial);
    tail.position.set(0, LEG_LENGTH + BODY_HEIGHT * 0.6, -BODY_LENGTH / 2 - 0.1);
    tail.rotation.x = 0.4;
    this.group.add(tail);

    for (const x of [-LEG_INSET_X, LEG_INSET_X]) {
      for (const z of [-LEG_INSET_Z, LEG_INSET_Z]) {
        const pivot = new THREE.Group();
        pivot.position.set(x, LEG_LENGTH, z);
        const legMesh = new THREE.Mesh(new THREE.BoxGeometry(LEG_WIDTH, LEG_LENGTH, LEG_WIDTH), legMaterial);
        legMesh.position.y = -LEG_LENGTH / 2;
        pivot.add(legMesh);
        this.group.add(pivot);
        // Front-left+back-right swing together, front-right+back-left swing opposite - a trot.
        const phase = (x < 0) === (z > 0) ? 0 : Math.PI;
        this.legs.push({ pivot, phase });
      }
    }
  }

  update(dt: number, moving: boolean) {
    if (moving) {
      this.gaitClock += dt * GAIT_SPEED;
      for (const leg of this.legs) {
        leg.pivot.rotation.x = Math.sin(this.gaitClock + leg.phase) * GAIT_AMPLITUDE;
      }
    } else {
      for (const leg of this.legs) {
        leg.pivot.rotation.x += (0 - leg.pivot.rotation.x) * IDLE_LERP;
      }
    }
  }
}
