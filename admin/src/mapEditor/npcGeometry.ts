import * as THREE from "three";
import { fitHeight, spawnIdleRiggedModel } from "./modelLoader";

// Mirrors client/src/game/Npc.ts exactly (same shared townsperson model/rig/height every NPC in
// the live game uses - there's no per-NPC model_id, unlike enemy types/gathering nodes/structures)
// so the editor preview finally shows a real body instead of a flat yellow marker ball.
const MODEL_PATH = "/models/npc_barbarian.glb";
const RIG_PATH = "/models/animations/Rig_Medium_General.glb";
const IDLE_CLIP = "Idle_A";
const MODEL_HEIGHT = 1.7;

// Populates `group` (already positioned by the caller) with the real NPC model once it resolves,
// pushing its AnimationMixer into `mixers` so the caller's render loop can drive the idle clip -
// same "empty until real content arrives" async-safe pattern as furnitureGeometry's
// populateFurnitureShape (safe to resolve after `group` has already been detached/discarded by a
// content re-sync).
export function populateNpcShape(group: THREE.Group, mixers: THREE.AnimationMixer[]): void {
  spawnIdleRiggedModel(MODEL_PATH, RIG_PATH, IDLE_CLIP).then(({ object, mixer }) => {
    fitHeight(object, MODEL_HEIGHT);
    group.add(object);
    mixers.push(mixer);
  });
}
