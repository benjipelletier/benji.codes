// Chord symbols in iReal spelling: a root, a quality made of iReal's own
// characters (- minor, ^ major 7, h half-diminished, o diminished, + augmented),
// and an optional /bass. W is iReal's invisible root, used for "/C" alone.

import { type Cell, DEFAULT_BAR_CELLS, isBlank } from './chart';

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

export function transposeCells(cells: Cell[], semis: number, flats: boolean): Cell[] {
  if (!semis) return cells;
  return cells.map((c) => ({
    ...c,
    ...(c.ch ? { ch: transposeChord(c.ch, semis, flats) } : {}),
    ...(c.alt ? { alt: transposeAlt(c.alt, semis, flats) } : {}),
  }));
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
      .replace(/^\^7?/, 'maj7')
      .replace(/^h7?/, 'm7♭5')
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
    .replace(/^-7b5/, 'h7')
    .replace(/^-b5/, 'h')
    .replace(/^-\(?maj\)?7?/i, '-^7')
    .replace(/maj/gi, '^')
    .replace(/[()]/g, '');
  const out = `${m[1].toUpperCase()}${m[2]}${rest}${bass}`;
  return FULL_CHORD_RE.test(out) ? out : null;
}

// ---- A bar as text, for typing it in one go ----

/** Where n chords sit in a bar of `cells`: two chords in four cells go on 1 and 3. */
export function spread(n: number, cells: number): number[] {
  return Array.from({ length: n }, (_, i) => Math.floor((i * cells) / n));
}

function cellToken(c: Cell): string {
  const alt = c.alt ? `(${c.alt})` : '';
  if (c.ch) return c.ch + alt;
  if (c.sym === 'x') return '%';
  if (c.sym === 'r') return '%%';
  if (c.sym === 'p') return '/';
  if (c.sym === 'n') return 'N.C.';
  return `.${alt}`;
}

/**
 * The bar as one line: "C-7 F7" when the chords sit where spreading them
 * would put them, otherwise every cell with . for the empty ones.
 */
export function barToText(cells: Cell[]): string {
  const filled = cells.map((c, i) => [c, i] as const).filter(([c]) => !isBlank(c));
  const blanksWithAlt = cells.some((c) => isBlank(c) && c.alt);
  const pos = spread(filled.length, cells.length);
  const compact = !blanksWithAlt && cells.length === DEFAULT_BAR_CELLS && filled.every(([, i], k) => pos[k] === i);
  if (compact) return filled.map(([c]) => cellToken(c)).join(' ');
  let last = cells.length - 1;
  while (last > 0 && isBlank(cells[last]) && !cells[last].alt) last--;
  return cells.slice(0, last + 1).map(cellToken).join(' ');
}

export interface ParsedBarText {
  cells: Cell[];
  errors: string[];
}

/**
 * Parse a line typed for a bar. Chords are separated by spaces or commas;
 * . or _ is an empty cell, % repeats the last bar, %% the last two, / is a
 * slash, N.C. no chord, and C7(Db7) gives C7 an alternate. Without any empty
 * cells the chords are spread over the bar; with them, each token is a cell.
 */
export function parseBarText(text: string, current: Cell[]): ParsedBarText {
  const width = Math.max(1, current.length || DEFAULT_BAR_CELLS);
  const tokens = text.split(/[\s,|]+/).filter(Boolean);
  const errors: string[] = [];
  const parsed: Cell[] = [];
  let explicit = false;
  for (const tok of tokens) {
    const am = tok.match(/^(.*?)\(([^)]*)\)$/);
    const head = am ? am[1] : tok;
    const alt = am ? normalizeChord(am[2]) ?? am[2].trim() : undefined;
    let cell: Cell;
    if (head === '.' || head === '_' || head === '') {
      cell = {};
      explicit = true;
    } else if (head === '%' || head === 'x') cell = { sym: 'x' };
    else if (head === '%%' || head === 'r') cell = { sym: 'r' };
    else if (head === '/') cell = { sym: 'p' };
    else if (/^(n|nc|n\.c\.?)$/i.test(head)) cell = { sym: 'n' };
    else {
      const ch = normalizeChord(head);
      if (!ch) {
        errors.push(head);
        continue;
      }
      cell = { ch };
    }
    if (alt) cell.alt = alt;
    parsed.push(cell);
  }
  let cells: Cell[];
  if (explicit || parsed.length >= width) {
    cells = parsed.slice();
    while (cells.length < width) cells.push({});
  } else {
    cells = Array.from({ length: width }, () => ({}));
    spread(parsed.length, width).forEach((p, k) => (cells[p] = parsed[k]));
  }
  cells = cells.slice(0, 16);
  // Keep the cell marks (text, fermata, small…) where they were.
  cells = cells.map((c, i) => {
    const old = current[i];
    if (!old) return c;
    const keep: Cell = {};
    for (const k of ['text', 'fermata', 'segno', 'coda', 'end'] as const) if (old[k]) (keep as Record<string, unknown>)[k] = old[k];
    if (old.small && (c.ch || c.sym === 'p')) keep.small = true;
    return { ...keep, ...c };
  });
  return { cells, errors };
}
