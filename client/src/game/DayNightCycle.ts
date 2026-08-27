import * as THREE from "three";

// A full in-game day takes this many real minutes - long enough that the sun's motion/color shift
// is a slow ambient backdrop (not a distraction while playing), short enough that a session longer
// than a few minutes actually sees the sky change. Driven by wall-clock time (Date.now()), not a
// server-synced value or a per-session timer, so every client's world shows roughly the same time
// of day without needing any network plumbing for something this purely cosmetic.
const DAY_LENGTH_MS = 24 * 60 * 1000;
const SUN_DISTANCE = 45;

// Elevation is a plain sine wave over one day (peaks at solar noon, troughs at midnight); azimuth
// sweeps a full circle over the same period so the sun visibly rises/sets rather than just
// dimming in place. tiltZ keeps it off the exact overhead line at noon - a sun directly overhead
// casts nearly flat, unreadable shadows.
const TILT_Z = 0.35;

interface Keyframe {
  ambientColor: THREE.Color;
  ambientIntensity: number;
  sunColor: THREE.Color;
  skyColor: THREE.Color;
}

// Gameplay (seeing enemies/loot/terrain) always wins over realism here - even NIGHT's ambient
// floor stays close to the game's original always-on 0.55 so nothing goes near-black, just cooler
// and a bit dimmer. Only the fog/sky color (which only paints the distant horizon, not nearby
// terrain brightness) is allowed to go genuinely dark at night.
const NIGHT: Keyframe = {
  // AmbientLight's color multiplies per-channel against every material's own color - a saturated
  // navy blue here starves the red/green channels grass/dirt/wood terrain actually needs, crushing
  // visibility no matter how high the intensity is. Kept light and only lightly tinted (not a deep
  // "night" blue) specifically so it doesn't multiply the ground down toward black.
  ambientColor: new THREE.Color(0x9aa2c4),
  ambientIntensity: 0.7,
  sunColor: new THREE.Color(0x6f7dc9), // dim "moonlight" tint for the little direct light left at night
  skyColor: new THREE.Color(0x05060c),
};
const DAWN: Keyframe = {
  ambientColor: new THREE.Color(0xb5a08c),
  ambientIntensity: 0.72,
  sunColor: new THREE.Color(0xff9d5c),
  skyColor: new THREE.Color(0x5c5470),
};
const NOON: Keyframe = {
  ambientColor: new THREE.Color(0xffffff),
  ambientIntensity: 0.75,
  sunColor: new THREE.Color(0xfff2d9),
  skyColor: new THREE.Color(0x9fc3e0),
};
const DUSK: Keyframe = {
  ambientColor: new THREE.Color(0xbb8f72),
  ambientIntensity: 0.7,
  sunColor: new THREE.Color(0xff7a45),
  skyColor: new THREE.Color(0x4a3a55),
};

function lerpKeyframe(a: Keyframe, b: Keyframe, t: number, out: Keyframe) {
  out.ambientColor.copy(a.ambientColor).lerp(b.ambientColor, t);
  out.ambientIntensity = a.ambientIntensity + (b.ambientIntensity - a.ambientIntensity) * t;
  out.sunColor.copy(a.sunColor).lerp(b.sunColor, t);
  out.skyColor.copy(a.skyColor).lerp(b.skyColor, t);
}

// 4-keyframe day split at quarter marks (midnight/dawn/noon/dusk/midnight), smoothly interpolated
// between whichever pair the current time falls between - cheap enough to run every frame without
// throttling (a handful of Color.lerp calls), and simple enough to tune by eye.
function sampleKeyframes(t: number, out: Keyframe) {
  const scaled = t * 4;
  const index = Math.floor(scaled);
  const frac = scaled - index;
  const pairs: [Keyframe, Keyframe][] = [
    [NIGHT, DAWN],
    [DAWN, NOON],
    [NOON, DUSK],
    [DUSK, NIGHT],
  ];
  const [from, to] = pairs[index % 4];
  lerpKeyframe(from, to, frac, out);
}

// Debug/QA escape hatch (see main.ts's own __debugRoom precedent) - set to a 0..1 fraction to pin
// the sky at a specific time of day instead of following the real clock, e.g. for screenshotting
// every phase of the cycle without waiting DAY_LENGTH_MS for it to come around naturally.
declare global {
  interface Window {
    __debugTimeOfDay?: number;
  }
}

// Owns the "sky" side of the scene - the sun's position/color, the ambient fill light, and the
// fog/background color that reads as the sky itself once distant hex tiles fade into it. Only
// wired up for the overworld (see GameScene) - a dungeon is an enclosed indoor space with no sky,
// its fixed torch-lit ambience stays exactly as it was before this existed.
export class DayNightCycle {
  private readonly ambient: THREE.AmbientLight;
  private readonly sun: THREE.DirectionalLight;
  private readonly scene: THREE.Scene;
  private readonly fogColor: THREE.Color;
  // 0 (full day) to 1 (full night) - read by GameScene.nightFactor so anything that should light
  // itself up after dark (see Structure.ts's "lamp" kind) can react to the same curve the sky
  // itself already uses, instead of re-deriving time-of-day independently.
  nightFactor = 1;
  // The raw 0..1 cycle position timeOfDay() last computed (0/1 = midnight, 0.5 = noon) - read by
  // GameScene.timeOfDayFraction for the minimap's clock readout. Kept separate from nightFactor
  // above since that's a lighting curve (ramped across a dawn/dusk band, see update()), not a
  // linear clock position.
  timeOfDayFraction = 0;
  // Added to Date.now() before the DAY_LENGTH_MS modulo in timeOfDay() below - stays 0 until an
  // admin's "/time" command (see WorldRoom.handleSetTimeOfDay's time_of_day_set broadcast) calls
  // setTimeOverride, which recomputes it once to make the cycle jump to the requested fraction.
  // Deliberately NOT re-applied every frame - the cycle then keeps flowing forward at its normal
  // speed from that jump, the same way Minecraft's "/time set" doesn't freeze the clock.
  private offsetMs = 0;
  private readonly scratch: Keyframe = {
    ambientColor: new THREE.Color(),
    ambientIntensity: 0,
    sunColor: new THREE.Color(),
    skyColor: new THREE.Color(),
  };

  constructor(scene: THREE.Scene, ambient: THREE.AmbientLight, sun: THREE.DirectionalLight) {
    this.scene = scene;
    this.ambient = ambient;
    this.sun = sun;
    this.fogColor = (scene.fog as THREE.Fog).color;
  }

  private timeOfDay(): number {
    if (window.__debugTimeOfDay !== undefined) return ((window.__debugTimeOfDay % 1) + 1) % 1;
    return ((Date.now() + this.offsetMs) % DAY_LENGTH_MS) / DAY_LENGTH_MS;
  }

  // Jumps the cycle to `fraction` (0..1, wraps) right now, then lets it keep flowing forward
  // normally from there - see offsetMs's own doc comment for why this doesn't just pin the clock.
  setTimeOverride(fraction: number) {
    const wrapped = ((fraction % 1) + 1) % 1;
    const targetMs = wrapped * DAY_LENGTH_MS;
    const currentMs = Date.now() % DAY_LENGTH_MS;
    this.offsetMs = ((targetMs - currentMs) % DAY_LENGTH_MS + DAY_LENGTH_MS) % DAY_LENGTH_MS;
  }

  // Repositions the sun around `followPosition` (the camera's own follow target - see
  // GameScene.followTarget) every frame, so its shadow-camera frustum always centers on the
  // player regardless of where they wander on a map far larger than that frustum needs to cover.
  update(followPosition: THREE.Vector3) {
    const t = this.timeOfDay();
    this.timeOfDayFraction = t;
    const angle = t * Math.PI * 2 - Math.PI / 2;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);

    sampleKeyframes(t, this.scratch);

    // Ramps over a wide dawn/dusk band (rather than hard-cutting at dirY===0) so "the sun is
    // exactly at the horizon" - the DAWN/DUSK keyframe instants above - still gets real direct
    // light instead of a jarring blackout right at the golden-hour moment this cycle names after.
    // `ambient` (see NIGHT.ambientIntensity) is still what keeps full night itself navigable.
    const daylight = Math.max(0, Math.min(1, (dirY + 0.3) / 0.6));
    this.nightFactor = 1 - daylight;
    this.sun.intensity = daylight * 1.5;
    this.sun.color.copy(this.scratch.sunColor);
    this.sun.position.set(followPosition.x + dirX * SUN_DISTANCE, followPosition.y + Math.max(dirY, 0.08) * SUN_DISTANCE, followPosition.z + TILT_Z * SUN_DISTANCE);
    this.sun.target.position.copy(followPosition);

    this.ambient.color.copy(this.scratch.ambientColor);
    this.ambient.intensity = this.scratch.ambientIntensity;

    this.fogColor.copy(this.scratch.skyColor);
    (this.scene.background as THREE.Color).copy(this.scratch.skyColor);
  }
}
