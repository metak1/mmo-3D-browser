// Procedural WebAudio sound effects - no bundled audio assets, mirrors the codebase's existing
// preference for generating content (terrain noise, textures) over shipping binary files.

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function beep(freq: number, durationMs: number, type: OscillatorType, gainPeak: number) {
  const audio = getContext();
  if (!audio) return;

  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.value = freq;

  const now = audio.currentTime;
  const duration = durationMs / 1000;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(gainPeak, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(now);
  osc.stop(now + duration);
}

// Prevents an unpleasant "beep storm" when an AoE lands on several targets in the same tick -
// only the first hit in each short window actually plays.
const RATE_LIMIT_MS = 70;
let lastHitAt = 0;
let lastHealAt = 0;

export function playHitSound(isCrit: boolean) {
  const now = performance.now();
  if (now - lastHitAt < RATE_LIMIT_MS) return;
  lastHitAt = now;

  if (isCrit) {
    beep(660, 90, "square", 0.09);
    beep(990, 130, "square", 0.07);
  } else {
    beep(220, 80, "triangle", 0.06);
  }
}

export function playHealSound() {
  const now = performance.now();
  if (now - lastHealAt < RATE_LIMIT_MS) return;
  lastHealAt = now;

  beep(520, 70, "sine", 0.05);
  beep(780, 120, "sine", 0.04);
}
