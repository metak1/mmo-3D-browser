import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";

// Real CC0 (public domain) rigged/animated low-poly models. "Man" (client/public/models/man.glb,
// Quaternius's Animated Men Pack, via poly.pizza) is used by Npc.ts; "Goblin" (goblin.glb, also
// Quaternius) by Enemy.ts; the five files under client/public/models/classes/ (KayKit's
// "Adventurers Character Pack" by Kay Lousberg, kaylousberg.com, via GitHub) by Player.ts - one
// self-contained model per class, each already carrying its own Idle/Walking_A animations, no
// attribution required under CC0. These join the CC0 textures from textures.ts as the only
// non-procedural assets in this codebase.

const loader = new GLTFLoader();

interface LoadedModel {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

// Fetched once per distinct path no matter how many avatars spawn one - every avatar clones this
// cached result instead of re-downloading/re-parsing the same file.
const cache = new Map<string, Promise<LoadedModel>>();

function loadModel(path: string): Promise<LoadedModel> {
  let entry = cache.get(path);
  if (!entry) {
    entry = loader.loadAsync(path).then((gltf) => ({ scene: gltf.scene, animations: gltf.animations }));
    cache.set(path, entry);
  }
  return entry;
}

// Crossfades between an Idle and a Walk clip based on movement state, and exposes the mixer
// update every avatar's own per-frame update() already needs to call. Shared by Player/Npc/Enemy
// instead of tripling the same play/fadeIn/fadeOut bookkeeping in each.
export class ModelAnimator {
  private current?: THREE.AnimationAction;

  constructor(
    private readonly mixer: THREE.AnimationMixer,
    private readonly idle?: THREE.AnimationAction,
    private readonly walk?: THREE.AnimationAction,
  ) {
    this.current = idle;
    idle?.play();
  }

  setMoving(moving: boolean) {
    const next = moving ? this.walk : this.idle;
    if (!next || next === this.current) return;
    next.reset().fadeIn(0.2).play();
    this.current?.fadeOut(0.2);
    this.current = next;
  }

  update(dt: number) {
    this.mixer.update(dt);
  }
}

export interface SpawnedModel {
  object: THREE.Object3D;
  animator: ModelAnimator;
}

// Clones (skeleton-aware, so each instance animates independently - a plain Object3D.clone()
// shares bones across every clone and animates them all in lockstep) a cached model and wires up
// its own AnimationMixer/ModelAnimator, ready to add to a scene and animate.
export async function spawnModel(path: string, clipNames: { idle: string; walk: string }): Promise<SpawnedModel> {
  const { scene, animations } = await loadModel(path);
  const object = cloneSkeleton(scene) as THREE.Object3D;
  // cloneSkeleton (like a plain Object3D.clone()) shares material *instances* with the cached
  // source scene and every other clone of it - harmless as long as every instance of a given
  // model always gets tinted identically (true for Player's per-class color and Npc's fixed
  // color), but not once different instances of the *same* model need independent colors (see
  // Enemy.ts's per-instance aggressive/passive tint) - mutating a shared material there would
  // silently recolor every other spawned copy using it too. Cloning each mesh's own material here
  // gives every instance something it can safely tint on its own.
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.material = Array.isArray(child.material) ? child.material.map((m) => m.clone()) : child.material.clone();
  });
  const mixer = new THREE.AnimationMixer(object);
  const idleClip = THREE.AnimationClip.findByName(animations, clipNames.idle) ?? undefined;
  const walkClip = THREE.AnimationClip.findByName(animations, clipNames.walk) ?? undefined;
  const animator = new ModelAnimator(
    mixer,
    idleClip && mixer.clipAction(idleClip),
    walkClip && mixer.clipAction(walkClip),
  );
  return { object, animator };
}

// Different packs/exports aren't at a consistent scale - the old "Ultimate Monsters Pack" turned
// out ~1000x larger per-unit than "Animated Men Pack", and man.glb's own native height (~4.8 units,
// still used unscaled by Npc.ts) turned out much taller than this game's actual map scale (a house
// is 4.5 units tall; a person standing nearly as tall as a house reads as "way too big"). Rather
// than hardcode a fragile per-model magic number, measure the freshly-cloned object's own bind-pose
// bounding box (its transform is still identity at this point, so this is its scale-1 native size)
// and scale it uniformly so its height matches the game's actual convention - a human should be
// ~1.7 units tall, matching the original capsule-primitive avatars this whole model system replaced.
export function fitHeight(object: THREE.Object3D, targetHeight: number) {
  // A freshly cloned object's matrixWorld (and its SkinnedMesh children's skeleton bone matrices)
  // aren't guaranteed to be up to date until the next render pass - measuring immediately can read
  // stale/uninitialized transforms and produce a wildly wrong box. Forcing the update first makes
  // the measurement reliable without waiting for a render.
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const nativeHeight = box.max.y - box.min.y;
  if (nativeHeight <= 0) return;
  const scale = targetHeight / nativeHeight;
  object.scale.setScalar(scale);
  // Unlike man.glb (origin already at the feet), this pack's origin isn't necessarily at ground
  // level - re-measuring post-scale and shifting up/down keeps every model's feet at y=0 relative
  // to its group, matching the ground-level convention setTarget()/getTerrainHeight() rely on.
  object.updateMatrixWorld(true);
  const scaledBox = new THREE.Box3().setFromObject(object);
  object.position.y -= scaledBox.min.y;
}

// KayKit's character models bundle every weapon/accessory option (e.g. a rogue ships with a
// crossbow, throwable, and dagger all attached to the same hand bone at once) as separate mesh
// nodes, meant for the game to pick from - not all render together by default, which is why an
// unmodified load shows a dagger and a crossbow occupying the same hand. Hides every mesh whose
// name is in `hideNames`, leaving the body parts and whichever weapon(s) the caller left out.
export function hideMeshesByName(object: THREE.Object3D, hideNames: string[]) {
  const hideSet = new Set(hideNames);
  object.traverse((child) => {
    if (child instanceof THREE.Mesh && hideSet.has(child.name)) child.visible = false;
  });
}

// Tints every material on a loaded model the same way identityTint already tints the plain
// primitive materials it replaces - applied here since a model can carry several meshes/materials
// (Quaternius packs commonly split body/accessories), not just the one this game's old primitive
// avatars had.
export function tintModel(object: THREE.Object3D, color: THREE.Color) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshStandardMaterial) material.color.copy(color);
    }
  });
}
