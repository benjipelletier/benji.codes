// Sound for the Listen page, synthesized in the browser with Web Audio: no
// samples to download or license, so it works offline like the rest of the
// app. A bass guitar (a plucked string, Karplus–Strong, through a low-pass) and
// a piano-ish tone (stretched partials, each dying away at its own rate, with
// a soft hammer click).

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
const plucks = new Map<number, AudioBuffer>();

const freq = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** The audio context, made and woken on a tap (browsers keep it silent until one). */
export function audio(): AudioContext {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    out = ctx.createGain();
    out.gain.value = 0.8;
    out.connect(comp).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** A plucked string at this pitch: a noise burst through a damped delay line. */
function pluck(c: AudioContext, midi: number): AudioBuffer {
  const have = plucks.get(midi);
  if (have) return have;
  const sr = c.sampleRate;
  const len = Math.floor(sr * 3);
  const buf = c.createBuffer(1, len, sr);
  const d = new Float32Array(len);
  const period = sr / freq(midi);
  // The averaging below adds half a sample to the loop.
  const n = Math.max(2, Math.round(period - 0.5));
  // A finger, not a pick: the burst already smoothed.
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const x = Math.random() * 2 - 1;
    prev = prev * 0.5 + x * 0.5;
    d[i] = prev;
  }
  const decay = 0.9975;
  for (let i = n; i < len; i++) d[i] = decay * 0.5 * (d[i - n] + d[i - n + 1]);
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 0) for (let i = 0; i < len; i++) d[i] /= peak;
  buf.copyToChannel(d, 0);
  plucks.set(midi, buf);
  return buf;
}

/** A bass guitar note, starting at `when` (context time), ringing `dur` seconds. */
export function playBass(midi: number, when: number, dur = 2.6) {
  const c = audio();
  const src = c.createBufferSource();
  src.buffer = pluck(c, midi);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(1400, when);
  lp.frequency.exponentialRampToValueAtTime(380, when + 0.5);
  lp.Q.value = 0.8;
  const g = c.createGain();
  g.gain.value = 0.0001;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(0.95, when + 0.008);
  // Held (the string itself dies away), then let go — anchored at the release,
  // since not every engine holds a ramp's end value until the next event.
  g.gain.setValueAtTime(0.95, when + dur - 0.3);
  g.gain.setTargetAtTime(0.0001, when + dur - 0.3, 0.12);
  src.connect(lp).connect(g).connect(out!);
  src.start(when);
  src.stop(when + dur + 0.2);
}

/** Piano notes together, starting at `when`. */
export function playPiano(midis: number[], when: number, dur = 2.8) {
  const c = audio();
  const level = 0.42 / Math.sqrt(Math.max(1, midis.length));
  for (const m of midis) {
    const f0 = freq(m);
    const note = c.createGain();
    note.gain.value = level;
    // Lower notes ring longer.
    const ring = Math.max(0.9, 3.2 - (m - 48) * 0.05);
    for (let k = 1; k <= 8; k++) {
      const f = k * f0 * Math.sqrt(1 + 0.00035 * k * k);
      if (f > 9000) break;
      const o = c.createOscillator();
      o.frequency.value = f;
      const g = c.createGain();
      const amp = 1 / k ** 1.35;
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(amp, when + 0.006);
      g.gain.setTargetAtTime(amp * 0.35, when + 0.006, 0.08 / k);
      g.gain.setTargetAtTime(0.0001, when + 0.15, ring / (1 + 0.6 * k));
      g.gain.setTargetAtTime(0.0001, when + dur - 0.25, 0.08);
      o.connect(g).connect(note);
      o.start(when);
      o.stop(when + dur + 0.1);
    }
    note.connect(out!);
  }
  // The hammer: a short, soft knock.
  const click = c.createBufferSource();
  const nb = c.createBuffer(1, Math.floor(c.sampleRate * 0.03), c.sampleRate);
  const nd = new Float32Array(nb.length);
  for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nd.length) ** 3;
  nb.copyToChannel(nd, 0);
  click.buffer = nb;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2500;
  const cg = c.createGain();
  cg.gain.value = 0.05;
  click.connect(bp).connect(cg).connect(out!);
  click.start(when);
}

/** The root low on a bass, E1 to E♭2 (where a bassist would play it). */
export function bassNote(root: number): number {
  return 28 + ((((root - 4) % 12) + 12) % 12);
}

/** A bass note, then the chord on piano after `gap` seconds. Returns when it's done, in seconds from now. */
export function playCue(root: number, chord: number[], gap = 0.55): number {
  const c = audio();
  const t = c.currentTime + 0.05;
  playBass(bassNote(root), t, gap + 2.6);
  playPiano(chord, t + gap);
  return gap + 2.8;
}
