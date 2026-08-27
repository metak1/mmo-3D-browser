import * as THREE from "three";
import { getTerrainHeight } from "@mmo/shared";
import { NameLabel } from "./NameLabel";
import { softTint } from "./textureTint";

const STONE_COLOR = 0x8a6a42;
const STONE_TRIM_COLOR = 0x2a2018; // dark bronze/mortar accent on the slab base and the cap ring
const CRYSTAL_COLOR = 0x5fd4f0;
const CRYSTAL_EMISSIVE = 0x1a6a8a;
const GLOW_COLOR = 0x5fd4f0;
const PULSE_SPEED = 1.1; // radians/sec - a slow "breathing" glow, not the old orb's physical bob
const PULSE_DEPTH = 0.35; // fraction of emissiveIntensity the pulse swings by, both directions
// A literal "Waypoint" (not the individual waypoint's own name, e.g. "Town") - the crystal's
// distinct shape already reads as "this is special," but a first-time player has no way to know
// walking up to it opens the fast-travel map until they do; this label answers that up front. The
// individual name still shows up once they open that map (see Minimap's drawWaypointTravelOverlay).
const LABEL_TEXT = "Waypoint";
const LABEL_GAP = 0.3; // world units of clearance above the crystal's own tip

// A stone pedestal topped by a tall faceted crystal obelisk - distinct from PortalAvatar's ring
// (dungeon entry) and every unit shape, so a waypoint reads immediately as "a fast-travel point,"
// not a dungeon portal or an NPC. Static shared content (no hp, never moves), spawned once from
// WAYPOINTS the same way NPCs/structures are - see main.ts. Built the same "flat tint, no texture
// map" way Structure.ts's lamp is (see buildLampPost's own comment) - both are small decorative
// props, and mapping stoneTexture() onto geometry this size has previously rendered solid black
// for reasons that never reduced to anything fixable.
export class WaypointAvatar {
  readonly group = new THREE.Group();
  readonly nameLabel: NameLabel;
  private readonly crystalMaterial: THREE.MeshStandardMaterial;
  private readonly glowMaterial: THREE.MeshBasicMaterial;
  private age = 0;

  constructor() {
    const stoneMaterial = new THREE.MeshStandardMaterial({ color: softTint(STONE_COLOR), roughness: 0.85 });
    const trimMaterial = new THREE.MeshStandardMaterial({ color: softTint(STONE_TRIM_COLOR), metalness: 0.4, roughness: 0.5 });

    // --- Base slab, flat and wide, dark trim ---
    let y = 0;
    const slabHeight = 0.16;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(1.3, slabHeight, 1.3), trimMaterial);
    slab.position.y = y + slabHeight / 2;
    this.group.add(slab);
    y += slabHeight;

    // --- Lower pedestal tier, flared wider than the body above it ---
    const tier1Height = 0.22;
    const tier1 = new THREE.Mesh(new THREE.BoxGeometry(0.95, tier1Height, 0.95), stoneMaterial);
    tier1.position.y = y + tier1Height / 2;
    this.group.add(tier1);
    y += tier1Height;

    // --- Pedestal body, the tall narrow block the crystal visually roots into ---
    const bodyHeight = 0.85;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, bodyHeight, 0.62), stoneMaterial);
    body.position.y = y + bodyHeight / 2;
    this.group.add(body);
    y += bodyHeight;

    // --- Upper pedestal tier, mirrors tier1's flare ---
    const tier2Height = 0.2;
    const tier2 = new THREE.Mesh(new THREE.BoxGeometry(0.85, tier2Height, 0.85), stoneMaterial);
    tier2.position.y = y + tier2Height / 2;
    this.group.add(tier2);
    y += tier2Height;

    // --- Thin dark cap ring, closing the stonework off right before the crystal ---
    const capHeight = 0.08;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.5, capHeight, 0.5), trimMaterial);
    cap.position.y = y + capHeight / 2;
    this.group.add(cap);
    y += capHeight;

    // --- Crystal obelisk: a near-parallel hexagonal shaft with a short pointed tip, rather than
    // one full-height cone - a real crystal termination stays roughly the same width most of the
    // way up and only tapers to a point right at the tip, matching the reference's silhouette
    // much closer than a uniform taper would. ---
    this.crystalMaterial = new THREE.MeshStandardMaterial({
      color: CRYSTAL_COLOR,
      emissive: CRYSTAL_EMISSIVE,
      emissiveIntensity: 1,
      transparent: true,
      opacity: 0.88,
      roughness: 0.15,
      metalness: 0,
    });
    const shaftHeight = 1.3;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, shaftHeight, 6), this.crystalMaterial);
    shaft.position.y = y + shaftHeight / 2;
    this.group.add(shaft);
    y += shaftHeight;

    const tipHeight = 0.5;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.22, tipHeight, 6), this.crystalMaterial);
    tip.position.y = y + tipHeight / 2;
    this.group.add(tip);
    y += tipHeight;

    // A soft, larger, mostly-transparent sphere around the shaft - reads as a gentle glow haze
    // rather than a hard-edged shape, the same cheap fake-bloom trick Structure.ts's lamp halo uses.
    this.glowMaterial = new THREE.MeshBasicMaterial({ color: GLOW_COLOR, transparent: true, opacity: 0.18, depthWrite: false });
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 16), this.glowMaterial);
    glow.position.y = y - shaftHeight / 2 - tipHeight / 2 + 0.3;
    glow.userData.noShadow = true;
    this.group.add(glow);

    // Not parented under this.group (same reasoning as HealthBar/NameLabel everywhere else they're
    // used) - kept as a scene sibling and repositioned in setPosition instead.
    this.nameLabel = new NameLabel(LABEL_TEXT, y + LABEL_GAP);
  }

  setPosition(x: number, z: number) {
    this.group.position.set(x, getTerrainHeight(x, z), z);
    this.nameLabel.setPosition(x, getTerrainHeight(x, z), z);
  }

  // A slow pulse of the crystal's own glow instead of the old orb's physical bob - the crystal is
  // now solidly rooted in the pedestal, so moving it up and down would read as broken/floating
  // rather than alive the way the old free-floating orb did.
  update(dt: number) {
    this.age += dt;
    const pulse = 1 + Math.sin(this.age * PULSE_SPEED) * PULSE_DEPTH;
    this.crystalMaterial.emissiveIntensity = pulse;
    this.glowMaterial.opacity = 0.18 * pulse;
  }

  addTo(scene: THREE.Scene) {
    scene.add(this.group);
    scene.add(this.nameLabel.group);
  }

  removeFrom(scene: THREE.Scene) {
    scene.remove(this.group);
    scene.remove(this.nameLabel.group);
  }
}
