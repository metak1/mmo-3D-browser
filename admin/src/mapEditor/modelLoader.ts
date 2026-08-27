import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";

// A small mirror of client/src/game/models.ts's loading/scaling/tinting helpers - admin isn't
// part of the same Vite app as client, so it can't just import that file directly. Originally
// kept to exactly the subset the map editor's tile/furniture palettes need (no animation, since
// nothing there ever moves); spawnIdleRiggedModel below is the enemy editor's addition for a
// skinned, animated preview model - trimmed to idle-only (a static preview never walks), unlike
// client's full spawnRiggedModel which also crossfades into a walk clip.

const loader = new GLTFLoader();
const cache = new Map<string, Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>>();

function loadScene(path: string): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> {
  let entry = cache.get(path);
  if (!entry) {
    entry = loader.loadAsync(path).then((gltf) => ({ scene: gltf.scene, animations: gltf.animations }));
    cache.set(path, entry);
  }
  return entry;
}

// cloneSkeleton-free clone (nothing here is skinned/animated) that still gives each instance its
// own material objects, so per-instance tinting (furniture's admin-set color) never leaks across
// every other placed copy of the same model - same reasoning as models.ts's own version.
function cloneWithIndependentMaterials(scene: THREE.Group): THREE.Object3D {
  const object = scene.clone(true);
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.material = Array.isArray(child.material) ? child.material.map((m) => m.clone()) : child.material.clone();
  });
  return object;
}

// Raw geometry/material off a cached scene's first mesh, uncloned - for THREE.InstancedMesh
// callers (the tile preview) that need one shared geometry/material to draw many copies of.
export async function loadModelGeometry(path: string): Promise<{ geometry: THREE.BufferGeometry; material: THREE.Material }> {
  const { scene } = await loadScene(path);
  let mesh: THREE.Mesh | undefined;
  scene.traverse((child) => {
    if (!mesh && child instanceof THREE.Mesh) mesh = child;
  });
  if (!mesh) throw new Error(`No mesh found in model: ${path}`);
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  return { geometry: mesh.geometry, material };
}

// A full independent-materials clone, for furniture placement (one Object3D per placed instance,
// individually tintable/positionable) rather than instancing.
export async function loadStaticModel(path: string): Promise<THREE.Object3D> {
  const { scene } = await loadScene(path);
  return cloneWithIndependentMaterials(scene);
}

export interface SpawnedIdleModel {
  object: THREE.Object3D;
  mixer: THREE.AnimationMixer;
}

// Skeleton-aware clone (a plain Object3D.clone() shares bones across every clone and animates
// them in lockstep) of a rigged-but-unanimated mesh (e.g. KayKit's Skeleton pack), playing one
// looping clip retargeted from a separate shared rig library - works because every character
// built on that rig has identical bone names, so AnimationMixer's name-based track binding just
// works across files. See client/src/game/models.ts's spawnRiggedModel for the full (idle+walk)
// version this mirrors.
export async function spawnIdleRiggedModel(meshPath: string, rigPath: string, clipName: string): Promise<SpawnedIdleModel> {
  const [{ scene }, rig] = await Promise.all([loadScene(meshPath), loadScene(rigPath)]);
  const object = cloneSkeleton(scene) as THREE.Object3D;
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.material = Array.isArray(child.material) ? child.material.map((m) => m.clone()) : child.material.clone();
  });
  const mixer = new THREE.AnimationMixer(object);
  const clip = THREE.AnimationClip.findByName(rig.animations, clipName);
  if (clip) mixer.clipAction(clip).play();
  return { object, mixer };
}

// Different packs/exports aren't at a consistent native scale - see models.ts's own doc comment
// for the full reasoning. Scales `object` uniformly so its own bind-pose bounding box height
// matches `targetHeight`, then re-grounds it so its feet/base sit at local y=0.
export function fitHeight(object: THREE.Object3D, targetHeight: number) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const nativeHeight = box.max.y - box.min.y;
  if (nativeHeight <= 0) return;
  const scale = targetHeight / nativeHeight;
  object.scale.setScalar(scale);
  object.updateMatrixWorld(true);
  const scaledBox = new THREE.Box3().setFromObject(object);
  object.position.y -= scaledBox.min.y;
}

// Same soft "mostly white, a little of the target color" blend as client's textureTint.ts's
// identityTint - a fully-saturated tint over a real photographic/painted texture just looks like
// dirty color, not the intended hue.
const WHITE = new THREE.Color(0xffffff);
const TINT_BLEND = 0.3;

export function tintModel(object: THREE.Object3D, hexColor: string) {
  const color = new THREE.Color(hexColor).lerp(WHITE, TINT_BLEND);
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshStandardMaterial) material.color.copy(color);
    }
  });
}
