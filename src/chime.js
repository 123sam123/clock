// Synthesized completion chime — no audio assets, per the product constraint.
// The AudioContext must be created or resumed during a user gesture (Start);
// autoplay policy otherwise leaves it suspended and playChime skips silently.

let sharedCtx = null;

export function unlockAudio(AudioCtor = globalThis.AudioContext) {
  if (!sharedCtx) {
    if (typeof AudioCtor !== 'function') return null;
    sharedCtx = new AudioCtor();
  }
  if (sharedCtx.state === 'suspended') {
    sharedCtx.resume().catch(() => {});
  }
  return sharedCtx;
}

// Two ascending sine tones, 120 ms each with a 40 ms gap between them, so the
// second starts 160 ms after the first. The 10 ms attack and 100 ms release
// fit inside each tone, and the 0.2 peak keeps the signal far below full
// scale, so the chime cannot clip.
const TONES = [
  { frequency: 880, offsetSeconds: 0 },
  { frequency: 1320, offsetSeconds: 0.16 },
];
const TONE_SECONDS = 0.12;
const ATTACK_SECONDS = 0.01;
const RELEASE_SECONDS = 0.1;
const PEAK_GAIN = 0.2;

export function playChime(ctx = sharedCtx) {
  if (!ctx || ctx.state !== 'running') return false;
  for (const { frequency, offsetSeconds } of TONES) {
    const start = ctx.currentTime + offsetSeconds;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(PEAK_GAIN, start + ATTACK_SECONDS);
    gain.gain.setValueAtTime(PEAK_GAIN, start + TONE_SECONDS - RELEASE_SECONDS);
    gain.gain.linearRampToValueAtTime(0, start + TONE_SECONDS);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + TONE_SECONDS);
  }
  return true;
}
