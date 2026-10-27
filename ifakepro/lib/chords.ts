// Chord symbols in iReal spelling: a root, a quality made of iReal's own
// characters (- minor, ^ major 7, h half-diminished, o diminished, + augmented),
// and an optional /bass. W is iReal's invisible root, used for "/C" alone.

// iReal also allows a custom quality between asterisks: C*-^*.
export const CHORD_RE = /^[A-GW][b#]?(?:\*[^*|]{0,12}\*|(?:sus|add|alt|[0-9b#^\-ho+])*)(?:\/[A-G][b#]?)?/;
const FULL_CHORD_RE = new RegExp(`${CHORD_RE.source}$`);

const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const NOTE: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, 'E#': 5, F: 5, 'F#': 6, Gb: 6,
  G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11, 'B#': 0,
};

/** The spelling iReal and most fake books use for each key. */
const MAJOR_KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR_KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
export const ALL_KEYS = [...MAJOR_KEYS, ...MINOR_KEYS.map((k) => `${k}-`)];

export function noteIndex(name: string): number | null {
  return NOTE[name] ?? null;
}

export function keyRoot(key: string): { root: string; minor: boolean } {
  const minor = key.endsWith('-');
  return { root: minor ? key.slice(0, -1) : key, minor };
}

/** Flat keys spell with flats; everything else with sharps. */
export function prefersFlats(key: string): boolean {
  const { root, minor } = keyRoot(key);
  const i = NOTE[root];
  if (i == null) return true;
  // Relative major decides: F Bb Eb Ab Db Gb are flat, as is C (spelled flat by convention).
  const major = minor ? (i + 3) % 12 : i;
  return [0, 5, 10, 3, 8, 1, 6].includes(major);
}

export function transposeKey(key: string, semis: number): string {
  const { root, minor } = keyRoot(key);
  const i = NOTE[root];
  if (i == null || semis % 12 === 0) return key;
  const j = (((i + semis) % 12) + 12) % 12;
  return minor ? `${MINOR_KEYS[j]}-` : MAJOR_KEYS[j];
}

/** Half steps from one key to another, the short way round (−5 … +6). */
export function keyDistance(from: string, to: string): number {
  const a = NOTE[keyRoot(from).root];
  const b = NOTE[keyRoot(to).root];
  if (a == null || b == null) return 0;
  const d = (((b - a) % 12) + 12) % 12;
  return d > 6 ? d - 12 : d;
}

/**
 * A key as people say it ("Eb", "E♭ minor", "f#m", "C-") in iReal spelling
 * ("Eb", "F#-"), spelled the way fake books spell that key; null if it isn't one.
 */
export function parseKey(input: string): string | null {
  const m = input.trim().replace(/♭/g, 'b').replace(/♯/g, '#').match(/^([A-Ga-g])([b#]?)\s*(m|min|minor|-|maj|major)?$/);
  if (!m) return null;
  const minor = !!m[3] && /^(m|min|minor|-)$/.test(m[3]);
  const i = NOTE[m[1].toUpperCase() + m[2]];
  if (i == null) return null;
  return minor ? `${MINOR_KEYS[i]}-` : MAJOR_KEYS[i];
}

function transposeNote(n: string, semis: number, flats: boolean): string {
  const i = NOTE[n];
  if (i == null) return n;
  const j = (((i + semis) % 12) + 12) % 12;
  return (flats ? FLATS : SHARPS)[j];
}

export function transposeChord(ch: string, semis: number, flats: boolean): string {
  if (!semis) return ch;
  const m = ch.match(/^([A-GW][b#]?)(.*?)(?:\/([A-G][b#]?))?$/);
  if (!m) return ch;
  const root = m[1] === 'W' ? 'W' : transposeNote(m[1], semis, flats);
  const bass = m[3] ? `/${transposeNote(m[3], semis, flats)}` : '';
  return `${root}${m[2]}${bass}`;
}

/** An alternate chord can hold a few chords; transpose each one it can read. */
export function transposeAlt(alt: string, semis: number, flats: boolean): string {
  if (!semis) return alt;
  return alt.replace(/[A-G][b#]?[^\s,/]*(?:\/[A-G][b#]?)?/g, (c) => transposeChord(c, semis, flats));
}

export function transposeEvent<E extends { ch?: string; alt?: string }>(e: E, semis: number, flats: boolean): E {
  if (!semis || (!e.ch && !e.alt)) return e;
  return {
    ...e,
    ...(e.ch ? { ch: transposeChord(e.ch, semis, flats) } : {}),
    ...(e.alt ? { alt: transposeAlt(e.alt, semis, flats) } : {}),
  };
}

export type ChordStyle = 'jazz' | 'plain';

export interface ChordParts {
  root: string;
  quality: string;
  bass: string;
}

const acc = (s: string) => s.replace(/b/g, '♭').replace(/#/g, '♯');

/**
 * A chord split for display: root, quality and bass, with accidentals as ♭ ♯.
 * "jazz" writes the fake-book signs (– △ ø °); "plain" spells them out (m maj m7♭5 dim).
 */
export function chordParts(ch: string, style: ChordStyle = 'jazz'): ChordParts {
  const m = ch.match(/^([A-GW])([b#]?)(.*?)(?:\/([A-G][b#]?))?$/);
  if (!m) return { root: ch, quality: '', bass: '' };
  const root = m[1] === 'W' ? '' : m[1] + acc(m[2]);
  let q = m[3];
  if (/^\*.*\*$/.test(q)) return { root, quality: q.slice(1, -1), bass: m[4] ? acc(m[4]) : '' };
  if (style === 'jazz') {
    q = q.replace(/\^/g, '△').replace(/h/g, 'ø').replace(/o/g, '°').replace(/-/g, '–');
  } else {
    q = q
      .replace(/^-\^/, 'm△')
      .replace(/^\^(?=\d)(?!7)/, 'maj') // C^9: maj9
      .replace(/^\^7?/, 'maj7')
      .replace(/^h(\d+)/, (_, d: string) => `m${d}♭5`) // Ch9: m9♭5
      .replace(/^h/, 'm7♭5')
      .replace(/^o/, 'dim')
      .replace(/^-/, 'm')
      .replace(/^\+/, 'aug')
      .replace(/\^/g, 'maj');
  }
  q = q.replace(/sus/g, 'sus').replace(/b(?=\d)/g, '♭').replace(/#/g, '♯');
  return { root, quality: q, bass: m[4] ? acc(m[4]) : '' };
}

/**
 * Read a chord as people type it and return it in iReal spelling, or null if
 * it isn't one. Accepts Cm7, Cmin7, CM7, Cmaj7, C△7, Cø, Cm7b5, Cdim7, C°,
 * Caug, c#7, C7/e and the iReal forms themselves.
 */
export function normalizeChord(input: string): string | null {
  let s = input.trim().replace(/♭/g, 'b').replace(/♯/g, '#').replace(/[△Δ∆]/g, '^').replace(/ø/g, 'h').replace(/[°º]/g, 'o');
  if (!s) return null;
  s = s.replace(/6\/9/g, '69');
  if (s.startsWith('/')) s = `W${s}`;
  const m = s.match(/^([A-Ga-gW])([b#]?)(.*)$/);
  if (!m) return null;
  let rest = m[3];
  let bass = '';
  const slash = rest.lastIndexOf('/');
  if (slash >= 0) {
    const b = rest.slice(slash + 1).match(/^([A-Ga-g])([b#]?)$/);
    if (!b) return null;
    bass = `/${b[1].toUpperCase()}${b[2]}`;
    rest = rest.slice(0, slash);
  }
  rest = rest
    .replace(/^maj/i, '^')
    .replace(/^ma(?=\d|$)/i, '^')
    .replace(/^M(?=\d|$)/, '^')
    .replace(/^min/i, '-')
    .replace(/^mi(?=\d|$)/i, '-')
    .replace(/^m(?!a)/, '-')
    .replace(/^dim/i, 'o')
    .replace(/^aug/i, '+')
    .replace(/^-(\d+)b5/, 'h$1')
    .replace(/^-b5/, 'h')
    .replace(/^-\(?maj\)?(?=\d)(?!7)/i, '-^')
    .replace(/^-\(?maj\)?7?/i, '-^7')
    .replace(/maj/gi, '^')
    .replace(/[()]/g, '');
  const out = `${m[1].toUpperCase()}${m[2]}${rest}${bass}`;
  return FULL_CHORD_RE.test(out) ? out : null;
}

// ---- Taking a chord apart, for the picker ----

export interface ChordSpell {
  /** C, Bb, F#, or W (no root: a bass note alone). */
  root: string;
  /** iReal quality: "", "-7", "^7", "h7", "7b9", … */
  quality: string;
  /** Bass note, or "". */
  bass: string;
}

export function splitChord(ch: string): ChordSpell | null {
  const m = ch.match(/^([A-GW][b#]?)(.*?)(?:\/([A-G][b#]?))?$/);
  return m ? { root: m[1], quality: m[2], bass: m[3] ?? '' } : null;
}

export function joinChord(p: ChordSpell): string {
  return `${p.root}${p.quality}${p.bass ? `/${p.bass}` : ''}`;
}

/** The twelve roots, spelled the way the key prefers. */
export function roots(flats: boolean): string[] {
  return flats ? FLATS.slice() : SHARPS.slice();
}

export interface Quality {
  q: string;
  /** Shown first, without opening "More". */
  common?: boolean;
}

/** Chord qualities for the picker, the everyday jazz ones first. */
export const QUALITIES: Quality[] = [
  { q: '^7', common: true }, { q: '-7', common: true }, { q: '7', common: true }, { q: 'h7', common: true },
  { q: 'o7', common: true }, { q: '6', common: true }, { q: '', common: true }, { q: '-', common: true },
  { q: '7sus', common: true }, { q: '7alt', common: true }, { q: '9', common: true }, { q: '-6', common: true },
  { q: '^9' }, { q: '-9' }, { q: '13' }, { q: '69' }, { q: '-^7' }, { q: '^7#11' }, { q: '7b9' }, { q: '7#9' },
  { q: '7#11' }, { q: '7b13' }, { q: '7#5' }, { q: '7b9b13' }, { q: '13b9' }, { q: '9sus' }, { q: '-11' }, { q: '-7b5' },
  { q: '+' }, { q: 'o' }, { q: 'sus' }, { q: 'add9' }, { q: '2' }, { q: '5' },
];

/** A chord as people type it (Cm7, Cmaj7, Cm7b5, Cdim7), for the text field. */
export function chordText(ch: string): string {
  if (ch.includes('*')) return ch; // iReal's own quality, written between asterisks
  const p = chordParts(ch, 'plain');
  return `${p.root}${p.quality}${p.bass ? `/${p.bass}` : ''}`.replace(/♭/g, 'b').replace(/♯/g, '#').replace(/△(\d+)?/g, (_, d?: string) => `maj${d ?? '7'}`);
}

/** A dominant's tritone substitute: G7 → Db7 (quality and bass kept, the bass moving with it). */
export function tritoneSub(ch: string, flats: boolean): string {
  return transposeChord(ch, 6, flats);
}

/** The ii of a dominant: G7 → D-7. */
export function twoOf(ch: string, flats: boolean): string | null {
  const p = splitChord(ch);
  if (!p || p.root === 'W') return null;
  return `${transposeChord(p.root, 7, flats)}-7`;
}

export function isDominant(ch: string): boolean {
  const p = splitChord(ch);
  return !!p && /^(7|9|13)/.test(p.quality);
}
