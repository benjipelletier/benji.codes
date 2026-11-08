// Sound for the Listen page: recorded instruments, shipped with the app in
// public/voiceshed/sounds (see CREDITS.txt there) and kept for offline by the
// service worker. The owner, of the first, synthesized version: "the audio
// sounds are all some shitty guitar".
//
//  - Piano: Salamander Grand Piano (Yamaha C5), CC BY 3.0, sampled every minor
//    third from A2 to C7; a note plays its nearest sample, shifted at most a
//    semitone and a half.
//  - Bass: FluidR3's finger electric bass, CC BY 3.0, every semitone from E1 to
//    E♭2, so the root is never shifted.

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
const buffers = new Map<string, AudioBuffer>();
let loading: Promise<boolean> | null = null;

const PIANO = Array.from({ length: 18 }, (_, i) => 45 + i * 3); // A2 … C7
const BASS = Array.from({ length: 12 }, (_, i) => 28 + i); // E1 … E♭2
const url = (kind: 'piano' | 'bass', midi: number) => `/voiceshed/sounds/${kind}/${midi}.mp3`;

/** Every sample, for saving the app for offline. */
export const SOUND_URLS = [...PIANO.map(m => url('piano', m)), ...BASS.map(m => url('bass', m))];

/** The audio context; made silent until a tap wakes it (browsers insist). */
export function audio(): AudioContext {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 3;
    out = ctx.createGain();
    out.gain.value = 2.8;
    out.connect(comp).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  return ctx;
}

/** Fetch and decode every sample, once. False if any failed (try again later). */
export function loadSounds(): Promise<boolean> {
  loading ??= (async () => {
    const c = audio();
    await Promise.all(
      [...PIANO.map(m => ['piano', m] as const), ...BASS.map(m => ['bass', m] as const)].map(async ([kind, m]) => {
        const key = `${kind}/${m}`;
        if (buffers.has(key)) return;
        const res = await fetch(url(kind, m));
        if (!res.ok) throw new Error(`${key}: ${res.status}`);
        buffers.set(key, await c.decodeAudioData(await res.arrayBuffer()));
      }),
    );
    return true;
  })().catch(() => {
    loading = null;
    return false;
  });
  return loading;
}

export const soundsReady = () => buffers.size === PIANO.length + BASS.length;

/** One sample, from `when`, at `rate`, at `level`, let go after `dur` seconds. */
function sample(buf: AudioBuffer, when: number, rate: number, level: number, dur: number) {
  const c = audio();
  const src = c.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = c.createGain();
  g.gain.value = level;
  // Anchored before the release: not every engine holds a value until the next event.
  g.gain.setValueAtTime(level, when + dur);
  g.gain.setTargetAtTime(0.0001, when + dur, 0.12);
  src.connect(g).connect(out!);
  src.start(when);
  src.stop(when + dur + 0.8);
}

/** Piano notes together, starting at `when` (context time). */
export function playPiano(midis: number[], when: number, dur = 2.8) {
  const level = 0.9 / Math.sqrt(Math.max(1, midis.length));
  for (const m of midis) {
    const s = PIANO.reduce((best, x) => (Math.abs(x - m) < Math.abs(best - m) ? x : best), PIANO[0]);
    const buf = buffers.get(`piano/${s}`);
    if (buf) sample(buf, when, 2 ** ((m - s) / 12), level, dur);
  }
}

/** A bass note (moved by octaves into E1–E♭2), starting at `when`. */
export function playBass(midi: number, when: number, dur = 3) {
  let m = midi;
  while (m < BASS[0]) m += 12;
  while (m > BASS[BASS.length - 1]) m -= 12;
  const buf = buffers.get(`bass/${m}`);
  if (buf) sample(buf, when, 1, 1.1, dur);
}

/** The root low on a bass, E1 to E♭2 (where a bassist would play it). */
export function bassNote(root: number): number {
  return 28 + ((((root - 4) % 12) + 12) % 12);
}

/** A bass note, then the chord on piano after `gap` seconds. Returns how long it lasts, in seconds. */
export function playCue(root: number, chord: number[], gap = 0.55): number {
  const c = audio();
  const t = c.currentTime + 0.05;
  playBass(bassNote(root), t, gap + 2.6);
  playPiano(chord, t + gap);
  return gap + 2.8;
}
