import * as THREE from "three";
import {
  STRUCTURE_GATE_PILLAR_FRACTION,
  StructureDef,
  StructureLoop,
  getTerrainHeight,
} from "@mmo/shared";
import { fitHeight, spawnStaticModel } from "./models";
import { stoneTexture } from "./textures";
import { softTint } from "./textureTint";

// Fixed regardless of an individual structure's wall color, so roofs/caps always read clearly
// against whatever color an admin picks for the walls.
const ROOF_COLOR = 0x4a3626;
const FLOOR_COLOR = 0x6b4a30;

// KayKit's Medieval Hexagon Pack (kaylousberg.com) - whole pre-made exterior buildings, unlike
// wall/door/tower/gate's procedural shapes (see StructureKind's doc comment). Each model's native
// export scale is tiny (a "home" is under a meter tall - built for a tabletop-hex-tile scale, not
// this game's ~1-unit-per-meter convention), hence fitHeight - the target height itself is
// StructureDef.height now (a structure's real, admin-scalable field - see shared's
// BUILDING_TARGET_HEIGHT for each model's own natural height and getStructureColliders' "building"
// case for how a resized building's collision keeps pace with it), not looked up from this table.
// Every building/color variant the pack ships (blue/green/red/yellow team colors, plus the neutral
// bridges/walls/fences/scaffolding/etc.) is registered here purely for its asset path; the fences/
// walls here are visual-only (see StructureKind's own wall/door/tower/gate kinds for the ones that
// actually collide).
const BUILDING_MODELS: Record<string, { path: string }> = {
  building_archeryrange_blue: { path: "/models/hexagon/building_archeryrange_blue.gltf" },
  building_barracks_blue: { path: "/models/hexagon/building_barracks_blue.gltf" },
  building_blacksmith_blue: { path: "/models/hexagon/building_blacksmith_blue.gltf" },
  building_castle_blue: { path: "/models/hexagon/building_castle_blue.gltf" },
  building_church_blue: { path: "/models/hexagon/building_church_blue.gltf" },
  building_home_A_blue: { path: "/models/hexagon/building_home_A_blue.gltf" },
  building_home_B_blue: { path: "/models/hexagon/building_home_B_blue.gltf" },
  building_lumbermill_blue: { path: "/models/hexagon/building_lumbermill_blue.gltf" },
  building_market_blue: { path: "/models/hexagon/building_market_blue.gltf" },
  building_mine_blue: { path: "/models/hexagon/building_mine_blue.gltf" },
  building_tavern_blue: { path: "/models/hexagon/building_tavern_blue.gltf" },
  building_tower_A_blue: { path: "/models/hexagon/building_tower_A_blue.gltf" },
  building_tower_base_blue: { path: "/models/hexagon/building_tower_base_blue.gltf" },
  building_tower_B_blue: { path: "/models/hexagon/building_tower_B_blue.gltf" },
  building_tower_catapult_blue: { path: "/models/hexagon/building_tower_catapult_blue.gltf" },
  building_watermill_blue: { path: "/models/hexagon/building_watermill_blue.gltf" },
  building_well_blue: { path: "/models/hexagon/building_well_blue.gltf" },
  building_windmill_blue: { path: "/models/hexagon/building_windmill_blue.gltf" },
  building_archeryrange_green: { path: "/models/hexagon/building_archeryrange_green.gltf" },
  building_barracks_green: { path: "/models/hexagon/building_barracks_green.gltf" },
  building_blacksmith_green: { path: "/models/hexagon/building_blacksmith_green.gltf" },
  building_castle_green: { path: "/models/hexagon/building_castle_green.gltf" },
  building_church_green: { path: "/models/hexagon/building_church_green.gltf" },
  building_home_A_green: { path: "/models/hexagon/building_home_A_green.gltf" },
  building_home_B_green: { path: "/models/hexagon/building_home_B_green.gltf" },
  building_lumbermill_green: { path: "/models/hexagon/building_lumbermill_green.gltf" },
  building_market_green: { path: "/models/hexagon/building_market_green.gltf" },
  building_mine_green: { path: "/models/hexagon/building_mine_green.gltf" },
  building_tavern_green: { path: "/models/hexagon/building_tavern_green.gltf" },
  building_tower_A_green: { path: "/models/hexagon/building_tower_A_green.gltf" },
  building_tower_base_green: { path: "/models/hexagon/building_tower_base_green.gltf" },
  building_tower_B_green: { path: "/models/hexagon/building_tower_B_green.gltf" },
  building_tower_catapult_green: { path: "/models/hexagon/building_tower_catapult_green.gltf" },
  building_watermill_green: { path: "/models/hexagon/building_watermill_green.gltf" },
  building_well_green: { path: "/models/hexagon/building_well_green.gltf" },
  building_windmill_green: { path: "/models/hexagon/building_windmill_green.gltf" },
  building_archeryrange_red: { path: "/models/hexagon/building_archeryrange_red.gltf" },
  building_barracks_red: { path: "/models/hexagon/building_barracks_red.gltf" },
  building_blacksmith_red: { path: "/models/hexagon/building_blacksmith_red.gltf" },
  building_castle_red: { path: "/models/hexagon/building_castle_red.gltf" },
  building_church_red: { path: "/models/hexagon/building_church_red.gltf" },
  building_home_A_red: { path: "/models/hexagon/building_home_A_red.gltf" },
  building_home_B_red: { path: "/models/hexagon/building_home_B_red.gltf" },
  building_lumbermill_red: { path: "/models/hexagon/building_lumbermill_red.gltf" },
  building_market_red: { path: "/models/hexagon/building_market_red.gltf" },
  building_mine_red: { path: "/models/hexagon/building_mine_red.gltf" },
  building_tavern_red: { path: "/models/hexagon/building_tavern_red.gltf" },
  building_tower_A_red: { path: "/models/hexagon/building_tower_A_red.gltf" },
  building_tower_base_red: { path: "/models/hexagon/building_tower_base_red.gltf" },
  building_tower_B_red: { path: "/models/hexagon/building_tower_B_red.gltf" },
  building_tower_catapult_red: { path: "/models/hexagon/building_tower_catapult_red.gltf" },
  building_watermill_red: { path: "/models/hexagon/building_watermill_red.gltf" },
  building_well_red: { path: "/models/hexagon/building_well_red.gltf" },
  building_windmill_red: { path: "/models/hexagon/building_windmill_red.gltf" },
  building_archeryrange_yellow: { path: "/models/hexagon/building_archeryrange_yellow.gltf" },
  building_barracks_yellow: { path: "/models/hexagon/building_barracks_yellow.gltf" },
  building_blacksmith_yellow: { path: "/models/hexagon/building_blacksmith_yellow.gltf" },
  building_castle_yellow: { path: "/models/hexagon/building_castle_yellow.gltf" },
  building_church_yellow: { path: "/models/hexagon/building_church_yellow.gltf" },
  building_home_A_yellow: { path: "/models/hexagon/building_home_A_yellow.gltf" },
  building_home_B_yellow: { path: "/models/hexagon/building_home_B_yellow.gltf" },
  building_lumbermill_yellow: { path: "/models/hexagon/building_lumbermill_yellow.gltf" },
  building_market_yellow: { path: "/models/hexagon/building_market_yellow.gltf" },
  building_mine_yellow: { path: "/models/hexagon/building_mine_yellow.gltf" },
  building_tavern_yellow: { path: "/models/hexagon/building_tavern_yellow.gltf" },
  building_tower_A_yellow: { path: "/models/hexagon/building_tower_A_yellow.gltf" },
  building_tower_base_yellow: { path: "/models/hexagon/building_tower_base_yellow.gltf" },
  building_tower_B_yellow: { path: "/models/hexagon/building_tower_B_yellow.gltf" },
  building_tower_catapult_yellow: { path: "/models/hexagon/building_tower_catapult_yellow.gltf" },
  building_watermill_yellow: { path: "/models/hexagon/building_watermill_yellow.gltf" },
  building_well_yellow: { path: "/models/hexagon/building_well_yellow.gltf" },
  building_windmill_yellow: { path: "/models/hexagon/building_windmill_yellow.gltf" },
  building_bridge_A: { path: "/models/hexagon/building_bridge_A.gltf" },
  building_bridge_B: { path: "/models/hexagon/building_bridge_B.gltf" },
  building_destroyed: { path: "/models/hexagon/building_destroyed.gltf" },
  building_dirt: { path: "/models/hexagon/building_dirt.gltf" },
  building_grain: { path: "/models/hexagon/building_grain.gltf" },
  building_scaffolding: { path: "/models/hexagon/building_scaffolding.gltf" },
  building_stage_A: { path: "/models/hexagon/building_stage_A.gltf" },
  building_stage_B: { path: "/models/hexagon/building_stage_B.gltf" },
  building_stage_C: { path: "/models/hexagon/building_stage_C.gltf" },
  fence_stone_straight: { path: "/models/hexagon/fence_stone_straight.gltf" },
  fence_stone_straight_gate: { path: "/models/hexagon/fence_stone_straight_gate.gltf" },
  fence_wood_straight: { path: "/models/hexagon/fence_wood_straight.gltf" },
  fence_wood_straight_gate: { path: "/models/hexagon/fence_wood_straight_gate.gltf" },
  wall_corner_A_gate: { path: "/models/hexagon/wall_corner_A_gate.gltf" },
  wall_corner_A_inside: { path: "/models/hexagon/wall_corner_A_inside.gltf" },
  wall_corner_A_outside: { path: "/models/hexagon/wall_corner_A_outside.gltf" },
  wall_corner_B_inside: { path: "/models/hexagon/wall_corner_B_inside.gltf" },
  wall_corner_B_outside: { path: "/models/hexagon/wall_corner_B_outside.gltf" },
  wall_straight: { path: "/models/hexagon/wall_straight.gltf" },
  wall_straight_gate: { path: "/models/hexagon/wall_straight_gate.gltf" },
};

// How translucent an enclosed room's roof gets once the player is well inside its footprint, and
// how many world units beyond the footprint the fade transitions over (WoW-style "walk under the
// roof") - walls stay solid always, a door is how you actually get in.
const FADE_MIN_OPACITY = 0.12;
const FADE_MARGIN = 3;

// A 4-sided ConeGeometry approximates a pyramid, but its `radius` is the distance from the
// center to a *vertex*, not to the middle of a face - after the 45° rotation that aligns those
// faces with the box's walls, each face sits at `radius * cos(45°)` from center, not at `radius`.
// Without the compensating *Math.SQRT2 below, the roof's flat sides land noticeably inside the
// tower's footprint (and its corners short of the wall corners too), so the walls poke out from
// under it instead of the roof properly capping/overhanging them.
const TOWER_CAP_OVERHANG = 1.15;

function towerCap(width: number, depth: number, height: number): THREE.Mesh {
  // ConeGeometry smooths its vertex normals across the seam between adjacent faces by default
  // (fine for a round cone, but this one only has 4 radial segments to approximate a pyramid) -
  // without flatShading each of the 4 triangular faces blends into its neighbors instead of
  // reading as a distinct flat plane, which is what made the cap look like a soft blob/smudge
  // rather than a crisp low-poly roof (matching the sharp-faced look every BoxGeometry wall
  // already has for free, since a box never shares vertices/normals across its faces).
  const material = new THREE.MeshStandardMaterial({ color: ROOF_COLOR, flatShading: true });
  const radius = (Math.max(width, depth) / 2) * TOWER_CAP_OVERHANG * Math.SQRT2;
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 4), material);
  mesh.rotation.y = Math.PI / 4;
  return mesh;
}

interface BuiltStructure {
  object: THREE.Object3D;
  // Only "lamp" populates this - see buildLamp/StructureAvatar.update, which fades the light and
  // the glass's own emissive glow (and its soft outer halo) together as nightFactor changes, up to
  // these per-instance max* values (see lampIntensityScale - already scaled by the admin's own
  // def.lightIntensity, so update() never needs to know about that field at all).
  lamp?: {
    light: THREE.PointLight;
    glassMaterial: THREE.MeshStandardMaterial;
    haloMaterial: THREE.MeshBasicMaterial;
    maxLightIntensity: number;
    maxEmissiveIntensity: number;
    maxHaloOpacity: number;
  };
}

const LAMP_FRAME_COLOR = 0x2a2a2a;
// Fixed regardless of def.color, unlike the lantern's own glow below - the ornament gems are a
// decorative accent (always lightly lit, day or night), not the actual light source an admin is
// customizing the color of.
const LAMP_GEM_COLOR = 0xb356e0;
const LAMP_GEM_EMISSIVE_INTENSITY = 0.7;
// The "def.lightIntensity unset" baseline - an admin's own value (see lampIntensityScale) scales
// these up/down from here rather than replacing them outright, so leaving the field blank keeps
// exactly the tuned-by-eye brightness this lamp always had.
const LAMP_MAX_LIGHT_INTENSITY = 2.5;
const LAMP_MAX_EMISSIVE_INTENSITY = 1.3;
const LAMP_MAX_HALO_OPACITY = 0.3;
const LAMP_LIGHT_RANGE = 6; // world units - wide enough to light the ground well past the lamp's own base

// def.lightIntensity is a multiplier on the LAMP_MAX_* constants above (1 = the built-in default,
// unset also = 1) rather than an absolute value replacing them - clamped so a stray huge/negative
// admin-entered number can't produce a nonsensical light (the server's own Zod schema already
// caps it 0-10, this is just defense in depth against any other path a StructureDef could arrive
// from).
function lampIntensityScale(def: StructureDef): number {
  return Math.max(0, Math.min(3, def.lightIntensity ?? 1));
}

// A stone-footed wooden signpost with a horizontal arm, a lantern hanging off its far end on a
// short chain, and a pair of decorative crystal ornaments (post/arm junction + arm tip) - based on
// a reference the user provided of a wooden lamppost with an overhanging arm. Built strictly
// bottom-to-top (base -> post -> arm -> chain -> lantern), each piece positioned off the previous
// one's own edge rather than off independent fractions of def.height - an earlier version instead
// did the latter and ended up with the glass sphere sitting *inside* neighboring geometry, with
// only a sliver of it ever visible. The lantern's own glow (light + emissive + halo, all fading
// with GameScene.nightFactor - see StructureAvatar.update) is the one thing def.color drives; the
// gems stay a fixed color (see LAMP_GEM_COLOR) since they're flavor, not "what this lamp lights up
// with." The roof cap deliberately stays narrower than the lantern body rather than the wider
// flared "witch hat" the reference shows - the game's camera looks down at a steep angle (see
// Scene.ts's CAMERA_OFFSET), so a roof wider than the lantern sitting directly above it would
// visually eclipse most of the glow from that viewing angle even though the two don't actually
// overlap in world space (an earlier iteration of this same lamp got exactly that wrong).
function buildLampPost(def: StructureDef): BuiltStructure {
  const group = new THREE.Group();
  const baseRadius = Math.max(def.width, def.depth);
  const intensityScale = lampIntensityScale(def);

  // Flat tint, no stoneTexture()/woodTexture() map - unlike buildWall/buildTower/buildGate below
  // (all admin-sized, several units across), applying either texture to this structure's much
  // smaller pieces rendered them solid black for reasons that didn't reduce to anything in this
  // function (repeat count, UV wrapping, shadow flags, and material props were all otherwise
  // fine) - confirmed by A/B testing with and without the map, not assumed. A flat tint reads
  // perfectly well as stone/wood at this size, and matches how the admin editor's own preview of
  // this same lamp already renders it (see structureGeometry.ts's buildLamp, which never had a
  // texture map to begin with).
  const stoneMaterial = new THREE.MeshStandardMaterial({ color: softTint(0x8a8a8a) });
  const woodMaterial = new THREE.MeshStandardMaterial({ color: softTint(0x6b4a30) });
  // A little metallic sheen (three.js's MeshStandardMaterial defaults to fully matte, metalness 0)
  // reads as forged iron instead of the flat-painted look most of this file's other materials use.
  const frameMaterial = new THREE.MeshStandardMaterial({ color: LAMP_FRAME_COLOR, metalness: 0.6, roughness: 0.35 });
  const gemMaterial = new THREE.MeshStandardMaterial({ color: 0x0d0e12, emissive: LAMP_GEM_COLOR, emissiveIntensity: LAMP_GEM_EMISSIVE_INTENSITY });

  // --- Stone base: two stacked tiers, wider at the bottom ---
  let y = 0;
  const tier1Height = def.height * 0.07;
  const tier1 = new THREE.Mesh(new THREE.BoxGeometry(baseRadius * 1.7, tier1Height, baseRadius * 1.7), stoneMaterial);
  tier1.position.y = y + tier1Height / 2;
  group.add(tier1);
  y += tier1Height;

  const tier2Height = def.height * 0.07;
  const tier2 = new THREE.Mesh(new THREE.BoxGeometry(baseRadius * 1.15, tier2Height, baseRadius * 1.15), stoneMaterial);
  tier2.position.y = y + tier2Height / 2;
  group.add(tier2);
  y += tier2Height;

  // --- Wooden post ---
  const postWidth = baseRadius * 0.55;
  const postHeight = def.height * 0.6;
  const post = new THREE.Mesh(new THREE.BoxGeometry(postWidth, postHeight, postWidth), woodMaterial);
  post.position.y = y + postHeight / 2;
  group.add(post);
  y += postHeight;

  // --- Horizontal arm, extending sideways in local +X - def.rotationY is what actually aims it
  // once placed, same as everything else here. ---
  const armLength = baseRadius * 3.2;
  const armHeight = postWidth * 0.55;
  const armDepth = postWidth * 0.85;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(armLength, armHeight, armDepth), woodMaterial);
  arm.position.set(armLength / 2, y - armHeight / 2, 0);
  group.add(arm);

  // --- Ornament gems: one at the post/arm junction, one near the arm's far end ---
  const gemSize = postWidth * 0.7;
  const junctionGem = new THREE.Mesh(new THREE.BoxGeometry(gemSize, gemSize, gemSize * 0.4), gemMaterial);
  junctionGem.position.set(0, y - armHeight / 2, postWidth / 2 + gemSize * 0.18);
  group.add(junctionGem);
  const tipGem = new THREE.Mesh(new THREE.BoxGeometry(gemSize, gemSize, gemSize * 0.4), gemMaterial);
  tipGem.position.set(armLength - gemSize * 0.7, y - armHeight / 2, armDepth / 2 + gemSize * 0.18);
  group.add(tipGem);

  // --- Chain + lantern, hanging from the arm's outer end ---
  const hangX = armLength - baseRadius * 0.4;
  y -= armHeight;

  const chainHeight = def.height * 0.14;
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(baseRadius * 0.05, baseRadius * 0.05, chainHeight, 6), frameMaterial);
  y -= chainHeight / 2;
  chain.position.set(hangX, y, 0);
  group.add(chain);
  y -= chainHeight / 2;

  const glassRadius = baseRadius * 0.5;
  const capRadius = glassRadius * 0.5;
  const capHeight = glassRadius * 0.8;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(capRadius, capHeight, 6), frameMaterial);
  y -= capHeight / 2;
  cap.position.set(hangX, y, 0);
  group.add(cap);
  y -= capHeight / 2;

  // Full saturation (not softTint's usual 70%-toward-white blend, which is meant for muted
  // structural textures) - a light's own color should read as vividly as the admin actually chose.
  const glowColor = new THREE.Color(def.color);
  const glassMaterial = new THREE.MeshStandardMaterial({ color: glowColor, emissive: glowColor, emissiveIntensity: 0 });
  y -= glassRadius;
  const glassY = y;
  // A hexagonal prism (tapered slightly narrower at the bottom) reads closer to the reference's
  // lantern-cage silhouette than a plain sphere did.
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(glassRadius, glassRadius * 0.75, glassRadius * 1.8, 6), glassMaterial);
  glass.position.set(hangX, glassY, 0);
  group.add(glass);

  // A soft, larger, mostly-transparent sphere behind the glass - reads as a gentle glow halo once
  // lit rather than a hard-edged shape, the same cheap fake-bloom trick WaypointAvatar's own beacon
  // already uses.
  const haloMaterial = new THREE.MeshBasicMaterial({ color: glowColor, transparent: true, opacity: 0, depthWrite: false });
  const halo = new THREE.Mesh(new THREE.SphereGeometry(glassRadius * 1.7, 16, 16), haloMaterial);
  halo.position.set(hangX, glassY, 0);
  halo.userData.noShadow = true; // a transparent glow sprite, not a real solid - see the constructor's shadow-flag traversal
  group.add(halo);

  // A thin metal rim closing off the lantern's bottom, instead of leaving its flat cylinder cap bare.
  const rimHeight = glassRadius * 0.18;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(glassRadius * 0.75, glassRadius * 0.6, rimHeight, 6), frameMaterial);
  y -= glassRadius * 0.9 + rimHeight / 2;
  rim.position.set(hangX, y, 0);
  group.add(rim);

  // decay=0 drops three.js's own distance-based attenuation entirely - intensity reads as roughly
  // the same brightness everywhere inside LAMP_LIGHT_RANGE, tapering smoothly to 0 only right at
  // that edge (still three.js's own `distance` cutoff, not the decay curve). A real inverse-square
  // falloff (decay=2, or even the softer decay=1 this used to be) reads as a small overexposed hot
  // core next to a fast-fading halo no matter how far `distance` itself reaches - a flat decay is
  // what actually spreads one lamp's light evenly across a wide pool instead of just its own base.
  // The range itself grows a bit with intensityScale too (a brighter bulb plausibly reaches
  // further), floored so a near-zero intensity doesn't collapse it to a pinprick.
  const light = new THREE.PointLight(glowColor, 0, LAMP_LIGHT_RANGE * Math.max(0.4, intensityScale), 0);
  light.position.set(hangX, glassY, 0);
  group.add(light);

  return {
    object: group,
    lamp: {
      light,
      glassMaterial,
      haloMaterial,
      maxLightIntensity: LAMP_MAX_LIGHT_INTENSITY * intensityScale,
      maxEmissiveIntensity: LAMP_MAX_EMISSIVE_INTENSITY * intensityScale,
      maxHaloOpacity: LAMP_MAX_HALO_OPACITY * intensityScale,
    },
  };
}

// A small ring/hook at the top - an admin lifts the whole structure off the ground with
// StructureDef's own yOffset to actually suspend it, e.g. under an archway or a building eave; the
// hook is what sells "this is meant to hang" rather than "this fell over" - with a short chain
// down to a lantern body that glows after dark. No base/post at all, unlike buildLampPost - this
// is the wall/ceiling-mounted alternative selected via def.modelId (see buildLamp's own dispatch).
// Built strictly top-to-bottom (hook -> chain -> roof -> glass -> drip tip), each new piece
// positioned off the previous one's own edge, same reasoning as buildLampPost's own comment on why.
function buildLampCeiling(def: StructureDef): BuiltStructure {
  const group = new THREE.Group();
  const frameMaterial = new THREE.MeshStandardMaterial({ color: LAMP_FRAME_COLOR, metalness: 0.6, roughness: 0.35 });
  const baseRadius = Math.max(def.width, def.depth);
  const glassRadius = baseRadius * 0.45;
  const intensityScale = lampIntensityScale(def);

  const hookRadius = baseRadius * 0.35;
  const hookTube = baseRadius * 0.09;
  const hook = new THREE.Mesh(new THREE.TorusGeometry(hookRadius, hookTube, 8, 12), frameMaterial);
  hook.rotation.x = Math.PI / 2; // lies flat - reads as a small ring/eyelet from the game's top-down camera
  let y = def.height - hookRadius - hookTube;
  hook.position.y = y;
  group.add(hook);

  const chainHeight = def.height * 0.14;
  y -= hookRadius + hookTube; // bottom edge of the ring
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(baseRadius * 0.05, baseRadius * 0.05, chainHeight, 6), frameMaterial);
  y -= chainHeight / 2;
  chain.position.y = y;
  group.add(chain);
  y -= chainHeight / 2;

  // Narrower than the glass, not wider - see buildLampPost's own comment on why (the game's steep
  // top-down camera would otherwise let a wider roof eclipse the bulb beneath it).
  const capRadius = glassRadius * 0.5;
  const capHeight = glassRadius * 0.8;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(capRadius, capHeight, 6), frameMaterial);
  y -= capHeight / 2;
  cap.position.y = y;
  group.add(cap);
  y -= capHeight / 2;

  const glowColor = new THREE.Color(def.color);
  const glassMaterial = new THREE.MeshStandardMaterial({ color: glowColor, emissive: glowColor, emissiveIntensity: 0 });
  y -= glassRadius;
  const glassY = y;
  const glass = new THREE.Mesh(new THREE.SphereGeometry(glassRadius, 16, 16), glassMaterial);
  glass.position.y = glassY;
  group.add(glass);

  const haloMaterial = new THREE.MeshBasicMaterial({ color: glowColor, transparent: true, opacity: 0, depthWrite: false });
  const halo = new THREE.Mesh(new THREE.SphereGeometry(glassRadius * 1.8, 16, 16), haloMaterial);
  halo.position.y = glassY;
  halo.userData.noShadow = true;
  group.add(halo);

  y -= glassRadius;
  const tipHeight = glassRadius * 0.6;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(capRadius * 0.6, tipHeight, 6), frameMaterial);
  tip.rotation.x = Math.PI; // point down, not up
  y -= tipHeight / 2;
  tip.position.y = y;
  group.add(tip);

  const light = new THREE.PointLight(glowColor, 0, LAMP_LIGHT_RANGE * Math.max(0.4, intensityScale), 0);
  light.position.y = glassY;
  group.add(light);

  return {
    object: group,
    lamp: {
      light,
      glassMaterial,
      haloMaterial,
      maxLightIntensity: LAMP_MAX_LIGHT_INTENSITY * intensityScale,
      maxEmissiveIntensity: LAMP_MAX_EMISSIVE_INTENSITY * intensityScale,
      maxHaloOpacity: LAMP_MAX_HALO_OPACITY * intensityScale,
    },
  };
}

// "lamp" covers two visual variants selected by def.modelId (same pattern "building" already uses
// for BUILDING_MODELS) - a ground-standing signpost, or a hook-hung ceiling/wall lantern. Unset/
// unrecognized modelId falls back to the post (the more common "stands somewhere on its own"
// case), matching every other kind's own "render something reasonable rather than nothing" default.
function buildLamp(def: StructureDef): BuiltStructure {
  return def.modelId === "lampCeiling" ? buildLampCeiling(def) : buildLampPost(def);
}

function buildWall(def: StructureDef): BuiltStructure {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(def.width, def.height, def.depth),
    new THREE.MeshStandardMaterial({ color: softTint(def.color), map: stoneTexture(def.width, def.height) }),
  );
  mesh.position.y = def.height / 2;
  return { object: mesh };
}

// A simple frame (two posts + a lintel) rather than a solid box - a door never collides (see
// shared's getStructureColliders), so this is purely a visual marker of where the opening is,
// both standing alone and as part of a wall run that findStructureLoops turned into a room.
function buildDoor(def: StructureDef): BuiltStructure {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: softTint(def.color), map: stoneTexture(def.width, def.height) });
  const postWidth = Math.min(def.width * 0.18, 0.3);

  for (const sign of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(postWidth, def.height, def.depth), material);
    post.position.set((sign * (def.width - postWidth)) / 2, def.height / 2, 0);
    group.add(post);
  }

  const lintelHeight = def.height * 0.15;
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(def.width, lintelHeight, def.depth), material);
  lintel.position.y = def.height - lintelHeight / 2;
  group.add(lintel);

  return { object: group };
}

function buildTower(def: StructureDef): BuiltStructure {
  const group = new THREE.Group();
  const bodyHeight = def.height * 0.85;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(def.width, bodyHeight, def.depth),
    new THREE.MeshStandardMaterial({ color: softTint(def.color), map: stoneTexture(def.width, bodyHeight) }),
  );
  body.position.y = bodyHeight / 2;
  group.add(body);

  const cap = towerCap(def.width, def.depth, def.height * 0.25);
  cap.position.y = bodyHeight + (def.height * 0.25) / 2;
  group.add(cap);
  return { object: group };
}

function buildGate(def: StructureDef): BuiltStructure {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: softTint(def.color), map: stoneTexture(def.width, def.height) });
  const pillarWidth = def.width * STRUCTURE_GATE_PILLAR_FRACTION;
  const pillarOffset = def.width / 2 - pillarWidth / 2;

  for (const sign of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(pillarWidth, def.height, def.depth), material);
    pillar.position.set(sign * pillarOffset, def.height / 2, 0);
    group.add(pillar);
  }

  const lintelHeight = def.height * 0.2;
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(def.width, lintelHeight, def.depth), material);
  lintel.position.y = def.height + lintelHeight / 2;
  group.add(lintel);
  return { object: group };
}

// Every other kind here is simple procedural Three.js geometry with no asset loading (matching
// Player/Npc/Enemy's own convention) - kind selects one of these hardcoded shape builders;
// everything else (position/size/color/rotation) is admin content. "building" is the exception
// (see BUILDING_MODELS/StructureKind's doc comment), loaded asynchronously like every other real
// model in this codebase - the group starts empty and gets the model added once it resolves.
// Walls/pillars/buildings are solid and actually block the player server-side (see shared's
// getStructureColliders/resolveStructureCollisions/BUILDING_FOOTPRINT) - a door never blocks,
// and neither does a building whose modelId has no BUILDING_FOOTPRINT entry (a bridge, a flat
// ground decal, or a piece with its own passable gate opening - see BUILDING_FOOTPRINT's own doc
// comment for the full list). A room's floor/roof aren't part of any single StructureDef/
// StructureAvatar - see StructureEnclosureAvatar
// below, built separately from findStructureLoops over the whole structure list (which "building"
// never participates in either).
export class StructureAvatar {
  readonly group = new THREE.Group();
  private lamp?: {
    light: THREE.PointLight;
    glassMaterial: THREE.MeshStandardMaterial;
    haloMaterial: THREE.MeshBasicMaterial;
    maxLightIntensity: number;
    maxEmissiveIntensity: number;
    maxHaloOpacity: number;
  };

  constructor(def: StructureDef) {
    if (def.kind === "building") {
      const model = def.modelId ? BUILDING_MODELS[def.modelId] : undefined;
      // Unrecognized/missing modelId (e.g. stale data, or an admin hasn't set one yet) - render
      // nothing rather than crash, same fallback the switch below uses for its own default case.
      if (model) {
        spawnStaticModel(model.path).then((object) => {
          fitHeight(object, def.height);
          this.group.add(object);
        });
      }
    } else {
      let built: BuiltStructure;
      switch (def.kind) {
        case "wall":
          built = buildWall(def);
          break;
        case "door":
          built = buildDoor(def);
          break;
        case "tower":
          built = buildTower(def);
          break;
        case "gate":
          built = buildGate(def);
          break;
        case "lamp":
          built = buildLamp(def);
          break;
        default:
          built = { object: new THREE.Group() }; // unrecognized kind (e.g. stale data) - render nothing rather than crash
      }
      // One traversal covers every procedural kind's meshes (wall/door/tower/gate can each be a
      // group of several) rather than repeating the same two flags inside each builder above.
      // noShadow (see buildLamp's halo sprite) opts a transparent decorative mesh out entirely - a
      // real shadow from/onto a glow sprite would look wrong, not just be wasted cost. A lamp's own
      // pieces skip *receiving* (but still cast, so it still darkens the ground under it) - it's
      // built from many small pieces sitting edge-to-edge (base tiers, post, arm), and letting them
      // all receive shadows from each other produced the same kind of self-shadowing darkening
      // found earlier with skinned character meshes (see models.ts's own comment on that), except
      // here it's coplanar touching seams rather than joints - it rendered the entire lamp almost
      // solid black even at full noon brightness.
      const receiveShadow = def.kind !== "lamp";
      built.object.traverse((child) => {
        if (!(child instanceof THREE.Mesh) || child.userData.noShadow) return;
        child.castShadow = true;
        child.receiveShadow = receiveShadow;
      });
      this.lamp = built.lamp;
      this.group.add(built.object);
    }
    // getTerrainHeight flattens the ground under every structure's own footprint (see
    // shared/src/types.ts), so this always lands the structure on level ground by default -
    // yOffset lets an admin deliberately raise/sink it from there (e.g. a platform, a sunken
    // ruin) via the map editor's Y-axis gizmo.
    this.group.position.set(def.x, getTerrainHeight(def.x, def.z) + def.yOffset, def.z);
    this.group.rotation.y = def.rotationY;
  }

  // A no-op for every kind except "lamp" - kept as one shared signature (rather than a separate
  // per-frame hook only lamps opt into) so main.ts can iterate structures and enclosures through
  // the same call without caring which kind, or which of StructureAvatar/StructureEnclosureAvatar,
  // it's actually holding. nightFactor comes from GameScene.nightFactor (0 = day, 1 = night).
  update(_playerX: number, _playerZ: number, nightFactor: number) {
    if (!this.lamp) return;
    this.lamp.light.intensity = nightFactor * this.lamp.maxLightIntensity;
    this.lamp.glassMaterial.emissiveIntensity = nightFactor * this.lamp.maxEmissiveIntensity;
    this.lamp.haloMaterial.opacity = nightFactor * this.lamp.maxHaloOpacity;
  }

  addTo(scene: THREE.Scene) {
    scene.add(this.group);
  }

  removeFrom(scene: THREE.Scene) {
    scene.remove(this.group);
  }
}

// Builds one arbitrary-polygon-shaped flat mesh (a room's floor or roof) directly in 3D rather
// than via THREE.Shape/ExtrudeGeometry - those build in the shape's local XY plane and need a
// rotation to lie flat, which flips the winding (and therefore which side the normal/texture
// faces) depending on sign conventions that are easy to get backwards. Triangulating in x/z and
// writing y directly sidesteps that; the mesh is double-sided (see callers) so the loop's
// arbitrary winding direction never matters for visibility either.
function buildFlatPolygon(points: { x: number; z: number }[], y: number, material: THREE.Material): THREE.Mesh {
  const positions: number[] = [];
  for (const p of points) positions.push(p.x, y, p.z);

  const triangles = THREE.ShapeUtils.triangulateShape(
    points.map((p) => new THREE.Vector2(p.x, p.z)),
    [],
  );
  const indices: number[] = [];
  for (const [a, b, c] of triangles) indices.push(a, b, c);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

// The floor + roof over one room detected by findStructureLoops - a sibling to the individual
// wall/door StructureAvatars that make up the room's perimeter, not a child of any one of them,
// since the polygon is a function of all of them together. Exposes the same
// update/addTo/removeFrom shape as StructureAvatar so main.ts can manage both through one list.
export class StructureEnclosureAvatar {
  readonly group = new THREE.Group();
  private readonly roofMaterial: THREE.MeshStandardMaterial;
  private readonly centroidX: number;
  private readonly centroidZ: number;
  private readonly fadeInnerRadius: number;

  constructor(loop: StructureLoop) {
    const floorMaterial = new THREE.MeshStandardMaterial({ color: FLOOR_COLOR, side: THREE.DoubleSide });
    const floor = buildFlatPolygon(loop.floorPoints, loop.floorY + 0.02, floorMaterial);
    floor.receiveShadow = true;
    this.group.add(floor);

    this.roofMaterial = new THREE.MeshStandardMaterial({
      color: ROOF_COLOR,
      transparent: true,
      side: THREE.DoubleSide,
    });
    const roof = buildFlatPolygon(loop.roofPoints, loop.roofY, this.roofMaterial);
    this.group.add(roof);

    this.centroidX = loop.floorPoints.reduce((sum, p) => sum + p.x, 0) / loop.floorPoints.length;
    this.centroidZ = loop.floorPoints.reduce((sum, p) => sum + p.z, 0) / loop.floorPoints.length;
    let maxRadius = 0;
    for (const p of loop.floorPoints) maxRadius = Math.max(maxRadius, Math.hypot(p.x - this.centroidX, p.z - this.centroidZ));
    this.fadeInnerRadius = maxRadius;
  }

  // Called every frame with the local player's world position - fades the roof out once the
  // player is well inside the room, same WoW-style "walk under the roof" as the old pyramid roof.
  // nightFactor is unused here (a room has no lamp of its own to fade) - only in the signature to
  // match StructureAvatar.update, see its own comment for why that's shared.
  update(playerX: number, playerZ: number, _nightFactor: number) {
    const dist = Math.hypot(playerX - this.centroidX, playerZ - this.centroidZ);
    const t = Math.min(1, Math.max(0, (dist - this.fadeInnerRadius) / FADE_MARGIN));
    this.roofMaterial.opacity = FADE_MIN_OPACITY + (1 - FADE_MIN_OPACITY) * t;
  }

  addTo(scene: THREE.Scene) {
    scene.add(this.group);
  }

  removeFrom(scene: THREE.Scene) {
    scene.remove(this.group);
  }
}
