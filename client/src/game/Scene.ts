import * as THREE from "three";
import { BOSS_ARENA_CENTER, BOSS_ARENA_RADIUS, DUNGEON_HALF_EXTENT, MAP_HALF_EXTENT } from "@mmo/shared";

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
    const size = (this.isDungeon ? DUNGEON_HALF_EXTENT : MAP_HALF_EXTENT) * 2;
    const groundColor = this.isDungeon ? 0x241a2e : 0x2b3348;
    const gridColor = this.isDungeon ? 0x5a3a6e : 0x4a5578;
    const gridColorDark = this.isDungeon ? 0x432c52 : 0x3a4260;

    const groundGeometry = new THREE.PlaneGeometry(size, size);
    const groundMaterial = new THREE.MeshStandardMaterial({ color: groundColor });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(size, size / 2, gridColor, gridColorDark);
    this.scene.add(grid);

    if (this.isDungeon) return; // no boss arena patch inside the instance - that's overworld-only

    // Purely decorative marker for the boss arena - no collision, just tells the player
    // "you've entered a different area" before the boss itself comes into view.
    const arenaGeometry = new THREE.CircleGeometry(BOSS_ARENA_RADIUS, 48);
    const arenaMaterial = new THREE.MeshStandardMaterial({ color: 0x3a1f24 });
    const arena = new THREE.Mesh(arenaGeometry, arenaMaterial);
    arena.rotation.x = -Math.PI / 2;
    arena.position.set(BOSS_ARENA_CENTER.x, 0.01, BOSS_ARENA_CENTER.z);
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
