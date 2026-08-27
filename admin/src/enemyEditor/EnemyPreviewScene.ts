import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectShape } from "@mmo/shared";
import { fitHeight, spawnIdleRiggedModel, tintModel } from "../mapEditor/modelLoader";
import { Telegraph } from "./Telegraph";

// Mirrors MapEditor.tsx's own mount-once Three.js embed pattern (scene/camera/WebGLRenderer/
// OrbitControls/lighting into a container, RAF loop, full cleanup on unmount) but as a standalone
// class rather than inline in a component's useEffect, since EnemyEditor only ever needs one
// instance and swaps its model/telegraph repeatedly rather than rebuilding the whole scene.

const GOBLIN_PATH = "/models/goblin.glb";
const GOBLIN_TINT = "#8fae5c";
const GOBLIN_HEIGHT = 1.8;

const RIG_IDLE = { path: "/models/animations/Rig_Medium_General.glb", clip: "Idle_A" };

const MODEL_CONFIG: Record<string, { meshPath: string; targetHeight: number }> = {
  skeletonWarrior: { meshPath: "/models/skeletons/Skeleton_Warrior.glb", targetHeight: 1.8 },
  skeletonMage: { meshPath: "/models/skeletons/Skeleton_Mage.glb", targetHeight: 1.7 },
  skeletonRogue: { meshPath: "/models/skeletons/Skeleton_Rogue.glb", targetHeight: 1.75 },
  skeletonMinion: { meshPath: "/models/skeletons/Skeleton_Minion.glb", targetHeight: 1.4 },
};

export const MODEL_OPTIONS = ["skeletonWarrior", "skeletonMage", "skeletonRogue", "skeletonMinion"];

// Fixed offset the telegraph previews at for shapes that aren't centered on the caster (impact-
// centered circle, cone, line) - there's no real "impact point" for an inert preview model, so
// this just picks a plausible spot a few meters in front of it, facing local +Z (matching this
// codebase's atan2(dx,dz) forward convention).
const PREVIEW_IMPACT_DISTANCE = 4;

export class EnemyPreviewScene {
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly orbit: OrbitControls;
  private readonly telegraph = new Telegraph();
  private readonly clock = new THREE.Clock();
  private container?: HTMLElement;
  private raf = 0;
  private modelObject?: THREE.Object3D;
  private mixer?: THREE.AnimationMixer;
  private loadToken = 0;
  private onResize = () => this.handleResize();

  constructor() {
    this.scene.background = new THREE.Color(0x10121a);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    this.camera.position.set(3.5, 2.6, 4.5);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const ambient = new THREE.AmbientLight(0xffffff, 0.65);
    this.scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xfff2d9, 1.1);
    sun.position.set(4, 6, 3);
    this.scene.add(sun);

    const grid = new THREE.GridHelper(10, 10, 0x3a4568, 0x232a42);
    this.scene.add(grid);

    this.scene.add(this.telegraph.mesh);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.set(0, 1, 0);
    this.orbit.maxPolarAngle = Math.PI / 2 - 0.02;
  }

  mount(container: HTMLElement) {
    this.container = container;
    container.appendChild(this.renderer.domElement);
    this.handleResize();
    window.addEventListener("resize", this.onResize);
    this.clock.start();
    const animate = () => {
      this.raf = requestAnimationFrame(animate);
      const dt = this.clock.getDelta();
      this.mixer?.update(dt);
      this.orbit.update();
      this.renderer.render(this.scene, this.camera);
    };
    animate();
  }

  private handleResize() {
    if (!this.container) return;
    const { clientWidth, clientHeight } = this.container;
    if (clientWidth === 0 || clientHeight === 0) return;
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(clientWidth, clientHeight);
  }

  // Swaps the previewed model - undefined/unrecognized modelId falls back to the default goblin,
  // matching Enemy.ts's own fallback contract exactly.
  setModel(modelId: string | undefined) {
    const token = ++this.loadToken;
    if (this.modelObject) {
      this.scene.remove(this.modelObject);
      this.modelObject = undefined;
    }
    this.mixer = undefined;

    const config = modelId ? MODEL_CONFIG[modelId] : undefined;
    const meshPath = config?.meshPath ?? GOBLIN_PATH;
    const targetHeight = config?.targetHeight ?? GOBLIN_HEIGHT;

    spawnIdleRiggedModel(meshPath, RIG_IDLE.path, RIG_IDLE.clip).then(({ object, mixer }) => {
      if (token !== this.loadToken) return; // a newer setModel call superseded this one mid-load
      fitHeight(object, targetHeight);
      if (!config) tintModel(object, GOBLIN_TINT);
      this.scene.add(object);
      this.modelObject = object;
      this.mixer = mixer;
      this.orbit.target.set(0, targetHeight / 2, 0);
    });
  }

  // Previews an ability's EffectShape around the model. Circle centered on "caster" sits at the
  // model's feet (matching CombatEngine's own centeredOn:"caster" semantics); every other
  // shape/centering (impact-centered circle, cone, line) is offset PREVIEW_IMPACT_DISTANCE along
  // +Z, aimed straight ahead, since a static preview has no real impact point to aim at. Pass
  // `null` to hide it (singleTarget/randomPoints have no fixed area to preview either).
  previewTelegraph(shape: EffectShape | null) {
    if (!shape || shape.kind === "singleTarget" || shape.kind === "randomPoints") {
      this.telegraph.hide();
      return;
    }
    if (shape.kind === "circle" && shape.centeredOn === "caster") {
      this.telegraph.setShape(shape, 0);
      this.telegraph.setPosition(0, 0);
    } else {
      this.telegraph.setShape(shape, 0);
      this.telegraph.setPosition(0, shape.kind === "circle" ? PREVIEW_IMPACT_DISTANCE : 0);
    }
    this.telegraph.show();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    this.orbit.dispose();
    this.renderer.dispose();
    this.container?.removeChild(this.renderer.domElement);
  }
}
