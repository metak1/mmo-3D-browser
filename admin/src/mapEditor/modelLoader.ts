import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// A small mirror of client/src/game/models.ts's loading/scaling/tinting helpers - admin has no
// other real-model rendering anywhere else (structureGeometry.ts/furnitureGeometry.ts's remaining
// procedural shapes, and this file's own tile preview, are the only 3D content it builds), and
// isn't part of the same Vite app as client, so it can't just import that file directly. Kept to
// exactly the subset the map editor's tile/furniture palettes actually need - no animation
// support, unlike client's version, since nothing here ever moves.

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();

function loadScene(path: string): Promise<THREE.Group> {
  let entry = cache.get(path);
  if (!entry) {
    entry = loader.loadAsync(path).then((gltf) => gltf.scene);
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
  const scene = await loadScene(path);
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
  const scene = await loadScene(path);
  return cloneWithIndependentMaterials(scene);
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
