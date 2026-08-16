import * as THREE from "three";

// MeshStandardMaterial multiplies its map by material.color, which worked well for the earlier
// procedural (neutral near-white) textures but muddies real photographic textures if used at
// full saturation - a fully-saturated blue tint over a brown wood photo just looks like dirty
// brown, not blue wood. Blending most of the way back to white keeps the photo recognizable
// while still leaving a subtle, visible difference between an admin's color choices.
const WHITE = new THREE.Color(0xffffff);
const DECORATIVE_BLEND = 0.7; // structures - color is aesthetic flavor, can be softened a lot
const IDENTITY_BLEND = 0.3; // players/NPCs/enemies - color also codes class/role/enemy type,
// so it needs to stay clearly recognizable and can't be softened nearly as much

export function softTint(hexColor: number | string, blend = DECORATIVE_BLEND): THREE.Color {
  return new THREE.Color(hexColor).lerp(WHITE, blend);
}

export function identityTint(hexColor: number | string): THREE.Color {
  return softTint(hexColor, IDENTITY_BLEND);
}
