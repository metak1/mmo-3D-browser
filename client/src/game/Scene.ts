import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { SoftVignetteShader } from "./SoftVignetteShader";
import {
  BOSS_ARENA_CENTER,
  BOSS_ARENA_RADIUS,
  DUNGEON_HALF_EXTENT,
  dungeonHexContent,
  getTerrainHeight,
  MAP_HALF_EXTENT,
  setTerrainMode,
} from "@mmo/shared";
import { buildHexGround } from "./HexGround";
import { DayNightCycle } from "./DayNightCycle";

// World-space half-size of the sun's shadow frustum, centered on the followed player every frame
// (see DayNightCycle.update) - covers the visible gameplay area around them without wasting shadow
// map resolution on the (much larger) map beyond what the camera can actually see at once.
const SHADOW_FRUSTUM_HALF_SIZE = 24;

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
  private readonly composer: EffectComposer;

  private ambient!: THREE.AmbientLight;
  private sun!: THREE.DirectionalLight;
  // Only the overworld has a sky to cycle - a dungeon's fixed indoor lighting (see setupLights)
  // stays exactly as it was before this existed.
  private dayNight?: DayNightCycle;

  private cameraTarget = new THREE.Vector3();

  constructor(
    container: HTMLElement,
    private readonly isDungeon = false,
  ) {
    // Both the overworld and a dungeon now get the same hex ground (see HexGround.ts) - a
    // discrete integer level per cell with real ramp geometry bridging the one boundary case, not
    // arbitrary continuous height sampled independently per rigid tile (which is what used to
    // leave visible gaps between neighbors). getTerrainHeight (shared/src/types.ts) uses this mode
    // to know which content to reclassify against, since "overworld (3,-2)" and "dungeon (3,-2)"
    // are numerically indistinguishable from x/z alone.
    setTerrainMode(isDungeon ? "dungeon" : "overworld");

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
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

    // Vignette is the one post-processing pass every scene gets (cheap, and darkening the screen
    // edges reads as atmosphere without touching brightness/blur of anything in the middle where
    // gameplay-critical text like health bars/name labels lives - see their own recent size pass).
    // Deliberately no bloom here: this game's overhead name/level text is bright, unlit white on a
    // transparent background, so a naive full-screen bloom would glow and blur exactly the text
    // that just got made bigger for readability - doing that properly needs selective (layer-
    // masked) bloom, which is a real follow-up, not a one-line addition.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const vignette = new ShaderPass(SoftVignetteShader);
    this.composer.addPass(vignette);

    window.addEventListener("resize", () => this.onResize());
  }

  private setupLights() {
    this.ambient = new THREE.AmbientLight(0xffffff, 0.55);
    this.scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xfff2d9, 1.1);
    this.sun.position.set(15, 25, 10);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0015;
    const cam = this.sun.shadow.camera as THREE.OrthographicCamera;
    cam.left = -SHADOW_FRUSTUM_HALF_SIZE;
    cam.right = SHADOW_FRUSTUM_HALF_SIZE;
    cam.top = SHADOW_FRUSTUM_HALF_SIZE;
    cam.bottom = -SHADOW_FRUSTUM_HALF_SIZE;
    cam.near = 1;
    cam.far = 150;
    cam.updateProjectionMatrix();
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // Only the overworld has a day/night sky - a dungeon keeps this fixed sun position/color as
    // its permanent (indoor, torch-lit) ambience exactly as it was before this class existed.
    if (!this.isDungeon) this.dayNight = new DayNightCycle(this.scene, this.ambient, this.sun);
  }

  private setupGround() {
    if (this.isDungeon) this.setupDungeonGround();
    else this.setupOverworldGround();
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
    arena.receiveShadow = true;
    arena.position.set(BOSS_ARENA_CENTER.x, getTerrainHeight(BOSS_ARENA_CENTER.x, BOSS_ARENA_CENTER.z) + 0.01, BOSS_ARENA_CENTER.z);
    this.scene.add(arena);
  }

  // Same hex-tile ground as the overworld (see setupOverworldGround), built from the active
  // dungeon's own painted content (dungeonHexContent - types.ts) instead of the live overworld
  // one, since dungeon coordinates numerically overlap the overworld's own grid. No boss-arena
  // decal here - dungeons don't have one yet (see the Dungeon Hex Terrain plan's Scope notes).
  private setupDungeonGround() {
    buildHexGround(DUNGEON_HALF_EXTENT, dungeonHexContent()).then((ground) => this.scene.add(ground));
  }

  followTarget(position: THREE.Vector3) {
    this.cameraTarget.lerp(position, CAMERA_LERP);
    this.camera.position.copy(this.cameraTarget).add(CAMERA_OFFSET);
    this.camera.lookAt(this.cameraTarget);
    // Piggybacks on the same "runs once per frame with the player's current position" call
    // main.ts's animate() already makes here, rather than threading a separate update(dt) call
    // through the render loop just for this.
    this.dayNight?.update(this.cameraTarget);
  }

  // For anything that should light itself up after dark (see Structure.ts's "lamp" kind) - a
  // dungeon has no day/night cycle of its own (see setupLights), so it defaults to "always dark
  // enough for a placed lamp to be lit," matching its permanently torch-lit ambience.
  get nightFactor(): number {
    return this.dayNight?.nightFactor ?? 1;
  }

  // undefined in a dungeon (no sky/cycle of its own - see setupLights) so main.ts's minimap clock
  // readout knows to hide itself there instead of showing a meaningless frozen value.
  get timeOfDayFraction(): number | undefined {
    return this.dayNight?.timeOfDayFraction;
  }

  // The "/time" admin chat command's entry point (see main.ts's "time_of_day_set" room message
  // handler) - a no-op in a dungeon, same reasoning as the getter above.
  setTimeOfDay(fraction: number) {
    this.dayNight?.setTimeOverride(fraction);
  }

  render() {
    this.composer.render();
  }

  private onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }
}
