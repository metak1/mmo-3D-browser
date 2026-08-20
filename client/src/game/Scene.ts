import * as THREE from "three";
import {
  BOSS_ARENA_CENTER,
  BOSS_ARENA_RADIUS,
  DUNGEON_HALF_EXTENT,
  getTerrainHeight,
  MAP_HALF_EXTENT,
  setTerrainFlat,
} from "@mmo/shared";
import { stoneTexture } from "./textures";
import { softTint } from "./textureTint";
import { buildHexGround } from "./HexGround";

const CAMERA_OFFSET = new THREE.Vector3(0, 21, 13.5);
const CAMERA_LERP = 0.08;

// Angle (radians) between the camera and the ground plane. Since the camera never
// orbits, anything that needs to face the camera (health bars) can compute its tilt
// from this once, instead of billboarding every frame.
export const CAMERA_PITCH = Math.atan2(CAMERA_OFFSET.y, CAMERA_OFFSET.z);

export class GameScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;

  private cameraTarget = new THREE.Vector3();

  constructor(
    container: HTMLElement,
    private readonly isDungeon = false,
  ) {
    // Nothing has real elevation anymore: dungeon floors never did (flat quad), and the overworld
    // floor is now a mosaic of discrete hex tiles (see HexGround.ts) rather than one continuously
    // deformable mesh - placing each rigid tile at its own noise-sampled height left visible gaps
    // wherever neighboring tiles landed at different elevations. Keeping every entity's
    // getTerrainHeight() call in lockstep with the flat floor that's actually drawn.
    setTerrainFlat(true);

    // High-DPI screens (e.g. Retina) report devicePixelRatio 2-3, which multiplies
    // the number of pixels the GPU has to shade every frame. Cap it, and skip MSAA
    // once we're already supersampling at 2x — running both tanks framerate for
    // very little extra visual quality on a scene this simple.
    const pixelRatio = Math.min(window.devicePixelRatio, 2);

    this.renderer = new THREE.WebGLRenderer({
      antialias: pixelRatio < 2,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.renderer.domElement);

    const backgroundColor = isDungeon ? 0x140f1a : 0x10121a;
    this.scene.background = new THREE.Color(backgroundColor);

    // Derived from the live (admin-editable) map size rather than fixed constants, so growing
    // the map via the admin panel doesn't leave distant ground with no fog falloff or hard-clip
    // objects at a fixed distance. Factors are tuned to land close to the old fixed values
    // (38/80 for the overworld) at today's default map sizes.
    const relevantHalfExtent = isDungeon ? DUNGEON_HALF_EXTENT : MAP_HALF_EXTENT;
    const fogNear = relevantHalfExtent * 1.1;
    const fogFar = relevantHalfExtent * 2.3;
    this.scene.fog = new THREE.Fog(backgroundColor, fogNear, fogFar);

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, fogFar + 20);
    this.camera.position.copy(CAMERA_OFFSET);
    this.camera.lookAt(0, 0, 0);

    this.setupLights();
    this.setupGround();

    window.addEventListener("resize", () => this.onResize());
  }

  private setupLights() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xfff2d9, 1.1);
    sun.position.set(15, 25, 10);
    this.scene.add(sun);
  }

  private setupGround() {
    if (!this.isDungeon) {
      this.setupOverworldGround();
      return;
    }

    const size = DUNGEON_HALF_EXTENT * 2;
    const groundColor = 0x241a2e;
    const gridColor = 0x5a3a6e;
    const gridColorDark = 0x432c52;

    // Dungeons stay a flat quad (small, enclosed instances - elevation adds nothing there).
    const groundGeometry = new THREE.PlaneGeometry(size, size, 1, 1);
    // Dungeon floors read better as stone than grass - the same real-texture set from
    // textures.ts, no separate asset needed.
    const groundMaterial = new THREE.MeshStandardMaterial({
      color: softTint(groundColor),
      map: stoneTexture(size, size),
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    // A flat reference grid only makes sense over flat ground - the overworld's hex tiles drop
    // it entirely rather than draping a grid that would read as a bug.
    const grid = new THREE.GridHelper(size, size / 2, gridColor, gridColorDark);
    this.scene.add(grid);
  }

  // The overworld floor is a THREE.InstancedMesh of KayKit hex tiles (see HexGround.ts) rather
  // than a plain textured plane. Loading the model is async, so - matching every avatar in this
  // codebase's "add to scene empty, populate once the model resolves" convention - the ground
  // simply doesn't exist for the handful of frames before the tile model finishes loading.
  private setupOverworldGround() {
    buildHexGround(MAP_HALF_EXTENT).then((ground) => this.scene.add(ground));

    // Purely decorative marker for the boss arena - no collision, just tells the player
    // "you've entered a different area" before the boss itself comes into view.
    const arenaGeometry = new THREE.CircleGeometry(BOSS_ARENA_RADIUS, 48);
    const arenaMaterial = new THREE.MeshStandardMaterial({ color: 0x3a1f24 });
    const arena = new THREE.Mesh(arenaGeometry, arenaMaterial);
    arena.rotation.x = -Math.PI / 2;
    arena.position.set(BOSS_ARENA_CENTER.x, getTerrainHeight(BOSS_ARENA_CENTER.x, BOSS_ARENA_CENTER.z) + 0.01, BOSS_ARENA_CENTER.z);
    this.scene.add(arena);
  }

  followTarget(position: THREE.Vector3) {
    this.cameraTarget.lerp(position, CAMERA_LERP);
    this.camera.position.copy(this.cameraTarget).add(CAMERA_OFFSET);
    this.camera.lookAt(this.cameraTarget);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  private onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
