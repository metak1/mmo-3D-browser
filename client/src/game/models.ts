import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";

// Real CC0 (public domain) rigged/animated low-poly models, no attribution required. "Goblin"
// (goblin.glb, Quaternius) is used by Enemy.ts. Player.ts's client/public/models/classes/ and
// Npc.ts's npc_barbarian.glb are KayKit's "Adventurers Character Pack" (kaylousberg.com) - Knight/
// Mage/Rogue/Rogue_Hooded are the older v1 export (each self-contained, own baked Idle/Walking_A),
// Ranger/Barbarian are the newer v2 export, which ships character meshes with *no* baked
// animations at all (see spawnRiggedModel) - its Idle_A/Walking_A clips instead come from the
// shared client/public/models/animations/Rig_Medium_*.glb library, also KayKit. Furniture.ts's
// client/public/models/dungeon/*.gltf pieces are KayKit's "Dungeon Pack", sharing one texture
// atlas (dungeon_texture.png) the same way every other model in that pack does. These join the
// CC0 textures from textures.ts as the only non-procedural assets in this codebase.

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

  // speedScale lets the walk clip's stride cadence track actual movement speed instead of always
  // playing at whatever pace it was authored for - without this, anything moving slower than that
  // pace (e.g. an enemy ambling around while wandering, well under its full chase speed) visibly
  // moonwalks: limbs cycling through a full stride far faster than the body is actually covering
  // ground. 1 (the default) means "play at the authored pace" - callers whose movement speed is
  // always the same one value (Player) never need to pass anything else.
  // Deliberately doesn't call the all-in-one .reset() on `next` before playing it - reset() also
  // snaps its clip time back to 0, and since real movement is mostly short bursts (a tap-to-nudge
  // player, or an enemy/NPC wander leg that often finishes well inside the walk clip's own ~1s
  // cycle - more so once it's slowed by speedScale below), doing that on every idle<->walk
  // transition meant most walks never got past the clip's opening slice before fading back to
  // idle, over and over - which read as "stuck on the first couple of frames" rather than an
  // actual walk cycle. Leaving `time` wherever it was left (a fresh AnimationAction already starts
  // at 0 on its first-ever play, so the very first transition is unaffected) means a resumed walk
  // picks the stride back up instead of restarting it.
  //
  // `enabled`/`paused` still need to be set by hand, though - three.js's own mixer auto-disables
  // an action once its fadeOut finishes at weight 0 (see AnimationAction._updateWeight), and
  // _update() hard-bails before ever advancing `time` while `enabled` is false. .play() alone
  // does NOT re-enable a disabled action (only .reset() does, bundled with the time-zeroing this
  // comment explains skipping) - without setting these explicitly, the very first fade-out after
  // this method stopped calling .reset() would permanently freeze the clip's `time`, since nothing
  // would ever flip `enabled` back to true again.
  setMoving(moving: boolean, speedScale = 1) {
    if (moving && this.walk) this.walk.timeScale = speedScale;
    const next = moving ? this.walk : this.idle;
    if (!next || next === this.current) return;
    next.enabled = true;
    next.paused = false;
    next.fadeIn(0.2).play();
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

// cloneSkeleton (like a plain Object3D.clone()) shares material *instances* with the cached
// source scene and every other clone of it - harmless as long as every instance of a given
// model always gets tinted identically (true for Player's per-class color and Npc's fixed
// color), but not once different instances of the *same* model need independent colors (see
// Enemy.ts's per-instance aggressive/passive tint) - mutating a shared material there would
// silently recolor every other spawned copy using it too. Cloning each mesh's own material here
// gives every instance something it can safely tint on its own.
// receiveShadow is a caller choice, castShadow isn't - every model spawned through this function
// (avatar or static prop alike) should darken the ground/whatever's behind it, but a skinned,
// animated character mesh receiving shadows on *itself* is exactly the case that produces shadow
// acne (self-shadowing artifacts from the mesh's own limbs/joints at normal shadow-map precision) -
// it rendered player/enemy/NPC models almost solid black even at full noon brightness. Static
// props (furniture, buildings - see spawnStaticModel) have no such animated-joint self-shadowing
// risk, so they keep receiving shadows (from each other, from characters standing under them).
function cloneWithIndependentMaterials(scene: THREE.Group, receiveShadow: boolean): THREE.Object3D {
  const object = cloneSkeleton(scene) as THREE.Object3D;
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.material = Array.isArray(child.material) ? child.material.map((m) => m.clone()) : child.material.clone();
    child.castShadow = true;
    child.receiveShadow = receiveShadow;
  });
  return object;
}

function buildAnimator(object: THREE.Object3D, idleClip?: THREE.AnimationClip, walkClip?: THREE.AnimationClip): ModelAnimator {
  const mixer = new THREE.AnimationMixer(object);
  return new ModelAnimator(mixer, idleClip && mixer.clipAction(idleClip), walkClip && mixer.clipAction(walkClip));
}

// Clones (skeleton-aware, so each instance animates independently - a plain Object3D.clone()
// shares bones across every clone and animates them all in lockstep) a cached model and wires up
// its own AnimationMixer/ModelAnimator, ready to add to a scene and animate. For a model whose
// own file carries its Idle/Walk clips already baked in (every model here except the ones using
// spawnRiggedModel below).
export async function spawnModel(path: string, clipNames: { idle: string; walk: string }): Promise<SpawnedModel> {
  const { scene, animations } = await loadModel(path);
  const object = cloneWithIndependentMaterials(scene, false);
  const idleClip = THREE.AnimationClip.findByName(animations, clipNames.idle) ?? undefined;
  const walkClip = THREE.AnimationClip.findByName(animations, clipNames.walk) ?? undefined;
  return { object, animator: buildAnimator(object, idleClip, walkClip) };
}

// Some newer packs (e.g. KayKit's v2 "Adventurers" character rig) ship character meshes with no
// baked animations at all - clips instead live in a separate, shared "rig" animation library
// meant to be retargeted onto any character built on that same named rig. Retargeting a clip
// authored against one skeleton onto a *different* skeleton only works because every character
// sharing that rig has identical bone names - three.js's AnimationMixer binds a clip's tracks to
// bones by name, not by which file they originally came from.
export async function spawnRiggedModel(
  meshPath: string,
  idleSource: { path: string; clip: string },
  walkSource: { path: string; clip: string },
): Promise<SpawnedModel> {
  const [{ scene }, idleAnim, walkAnim] = await Promise.all([
    loadModel(meshPath),
    loadModel(idleSource.path),
    loadModel(walkSource.path),
  ]);
  const object = cloneWithIndependentMaterials(scene, false);
  const idleClip = THREE.AnimationClip.findByName(idleAnim.animations, idleSource.clip) ?? undefined;
  const walkClip = THREE.AnimationClip.findByName(walkAnim.animations, walkSource.clip) ?? undefined;
  return { object, animator: buildAnimator(object, idleClip, walkClip) };
}

// For a model with no animations at all (e.g. a dungeon furniture prop) - just the geometry,
// cloned with independent materials so per-instance tinting (see Furniture.ts) doesn't leak
// across every other spawned copy of the same prop.
export async function spawnStaticModel(path: string): Promise<THREE.Object3D> {
  const { scene } = await loadModel(path);
  return cloneWithIndependentMaterials(scene, true);
}

// Pulls the raw geometry/material straight off the cached scene's first mesh, uncloned - for
// THREE.InstancedMesh callers (see HexGround.ts) that need one shared geometry/material to draw
// thousands of copies of, not an independent Object3D per copy the way every avatar above does.
export async function loadModelGeometry(path: string): Promise<{ geometry: THREE.BufferGeometry; material: THREE.Material }> {
  const { scene } = await loadModel(path);
  let mesh: THREE.Mesh | undefined;
  scene.traverse((child) => {
    if (!mesh && child instanceof THREE.Mesh) mesh = child;
  });
  if (!mesh) throw new Error(`No mesh found in model: ${path}`);
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  return { geometry: mesh.geometry, material };
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
