import * as THREE from "three";

// Real CC0 (public domain) photographic textures from ambientCG (https://ambientcg.com),
// downscaled to 256x256 JPGs and bundled in client/public/textures - Planks010 (wood),
// Bricks061 (stone), Fabric019 (cloth, for players/NPCs), Leather007 (for enemy bodies).
// No attribution required under CC0, but noted here for provenance. The overworld ground
// itself is no longer one of these (see HexGround.ts's KayKit tile mesh); stone still covers
// dungeon floors.

const loader = new THREE.TextureLoader();

function loadTexture(path: string): THREE.Texture {
  const texture = loader.load(path);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

const WOOD_BASE = loadTexture("/textures/wood.jpg");
const STONE_BASE = loadTexture("/textures/stone.jpg");
const FABRIC_BASE = loadTexture("/textures/fabric.jpg");
const LEATHER_BASE = loadTexture("/textures/leather.jpg");

function withRepeat(base: THREE.Texture, repeatX: number, repeatY: number): THREE.Texture {
  const texture = base.clone();
  texture.needsUpdate = true;
  texture.repeat.set(repeatX, repeatY);
  return texture;
}

export function woodTexture(width: number, height: number): THREE.Texture {
  return withRepeat(WOOD_BASE, Math.max(1, Math.round(width / 2)), Math.max(1, Math.round(height / 2)));
}

export function stoneTexture(width: number, height: number): THREE.Texture {
  return withRepeat(STONE_BASE, Math.max(1, Math.round(width / 2)), Math.max(1, Math.round(height / 2)));
}

// Character/monster bodies are small, roughly fixed-size primitives (no admin-set
// width/height like structures), so these just take a flat repeat count instead.
export function fabricTexture(repeat = 2): THREE.Texture {
  return withRepeat(FABRIC_BASE, repeat, repeat);
}

export function leatherTexture(repeat = 1): THREE.Texture {
  return withRepeat(LEATHER_BASE, repeat, repeat);
}
