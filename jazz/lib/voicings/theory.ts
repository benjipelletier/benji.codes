// Music theory for the voicing trainer: spelled notes ("Ab3"), chord
// qualities, chart symbols (iReal's "F-7", "Bh7", "C^7") mapped onto them,
// and the starter library (drop-2 inversions and rootless A/B voicings in all
// twelve keys).
//
// A note is a letter, at most one accidental and an octave: "F#4", "Bb3",
// "Cb4" (= B3). The octave belongs to the letter, so Cb4 is MIDI 59 and B#3
// is MIDI 60. Double accidentals are never written: the note pad has one
// sharp and one flat, so a spelling that would need one takes the
// enharmonic root instead.

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
export type Letter = (typeof LETTERS)[number];
const LETTER_PC: Record<Letter, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export const PC_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
export const PC_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const mod12 = (n: number) => ((n % 12) + 12) % 12;

export interface Spelled {
  letter: Letter;
  /** -1 flat, 0 natural, 1 sharp. */
  acc: -1 | 0 | 1;
  octave: number;
}

const NOTE_RE = /^([A-G])([b#♭♯]?)(-?\d)$/;
const NAME_RE = /^([A-G])([b#♭♯]?)$/;

export function parseNote(s: string): Spelled | null {
  const m = s.trim().match(NOTE_RE);
  if (!m) return null;
  const acc = m[2] === 'b' || m[2] === '♭' ? -1 : m[2] === '#' || m[2] === '♯' ? 1 : 0;
  return { letter: m[1] as Letter, acc, octave: Number(m[3]) };
}

export function noteMidi(s: string): number {
  const n = parseNote(s);
  if (!n) throw new Error(`Not a note: ${s}`);
  return (n.octave + 1) * 12 + LETTER_PC[n.letter] + n.acc;
}

/** "Ab3" → "Ab": the name without its octave. */
export function pitchName(s: string): string {
  return s.replace(/-?\d+$/, '');
}

/** A note name's pitch class ("Ab" → 8, "Cb" → 11), or null. */
export function namePc(name: string): number | null {
  const m = name.trim().match(NAME_RE);
  if (!m) return null;
  const acc = m[2] === 'b' || m[2] === '♭' ? -1 : m[2] === '#' || m[2] === '♯' ? 1 : 0;
  return mod12(LETTER_PC[m[1] as Letter] + acc);
}

/** Pretty accidentals for display: "Bb" → "B♭". */
export function pretty(s: string): string {
  return s.replace(/([A-G])b/g, '$1♭').replace(/([A-G])#/g, '$1♯');
}

/** A MIDI number's plain name in flats ("Eb4"). */
export function midiName(midi: number, sharps = false): string {
  const pc = mod12(midi);
  const name = (sharps ? PC_SHARP : PC_FLAT)[pc];
  return `${name}${Math.floor(midi / 12) - 1}`;
}

// ── intervals ───────────────────────────────────────────────────────────

/** Interval name → [semitones above the root, letter steps above the root]. */
export const INTERVALS: Record<string, [number, number]> = {
  R: [0, 0],
  b9: [1, 1],
  '9': [2, 1],
  '#9': [3, 1],
  b3: [3, 2],
  '3': [4, 2],
  '11': [5, 3],
  '#11': [6, 3],
  b5: [6, 4],
  '5': [7, 4],
  '#5': [8, 4],
  b13: [8, 5],
  '6': [9, 5],
  '13': [9, 5],
  b7: [10, 6],
  '7': [11, 6],
};

/**
 * Spell `midi` as `interval` above a root spelled `rootName` ("Eb"). Falls
 * back to a plain flat/sharp name when the interval's letter would need a
 * double accidental.
 */
export function spellInterval(rootName: string, interval: string, midi: number): string {
  const root = rootName.match(NAME_RE);
  const iv = INTERVALS[interval];
  if (!root || !iv) return midiName(midi);
  const rootLetter = root[1] as Letter;
  const letter = LETTERS[(LETTERS.indexOf(rootLetter) + iv[1]) % 7];
  let acc = mod12(midi) - LETTER_PC[letter];
  if (acc > 6) acc -= 12;
  if (acc < -6) acc += 12;
  if (acc < -1 || acc > 1) return midiName(midi, rootName.includes('#'));
  const octave = (midi - acc - LETTER_PC[letter]) / 12 - 1;
  return `${letter}${acc === -1 ? 'b' : acc === 1 ? '#' : ''}${octave}`;
}

// ── qualities ───────────────────────────────────────────────────────────

export type Quality = 'maj7' | '6' | 'm7' | 'm6' | 'mMaj7' | '7' | '7b9' | '7alt' | '7sus' | 'm7b5' | 'dim7';

export interface QualityInfo {
  id: Quality;
  /** As written in a chord label: "Fm7", "Bbm7b5". */
  suffix: string;
  /** As shown. */
  display: string;
  /** Which spelling each semitone above the root takes in this quality. */
  spelling: Record<number, string>;
  /** Root names this quality prefers (index = pitch class). */
  roots: string[];
}

const ROOTS_MAJOR = PC_FLAT;
const ROOTS_MINOR = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];

const SPELL_MAJOR = { 0: 'R', 1: 'b9', 2: '9', 3: '#9', 4: '3', 5: '11', 6: '#11', 7: '5', 8: '#5', 9: '13', 10: 'b7', 11: '7' };
const SPELL_MINOR = { ...SPELL_MAJOR, 3: 'b3', 8: 'b13' };
const SPELL_HALFDIM = { ...SPELL_MINOR, 6: 'b5' };
const SPELL_DIM = { ...SPELL_HALFDIM, 9: '6' };
const SPELL_ALT = { ...SPELL_MAJOR, 6: 'b5', 8: '#5' };

export const QUALITIES: QualityInfo[] = [
  { id: 'maj7', suffix: 'maj7', display: 'maj7', spelling: SPELL_MAJOR, roots: ROOTS_MAJOR },
  { id: '6', suffix: '6', display: '6', spelling: { ...SPELL_MAJOR, 9: '6' }, roots: ROOTS_MAJOR },
  { id: 'm7', suffix: 'm7', display: 'm7', spelling: SPELL_MINOR, roots: ROOTS_MINOR },
  { id: 'm6', suffix: 'm6', display: 'm6', spelling: { ...SPELL_MINOR, 9: '6' }, roots: ROOTS_MINOR },
  { id: 'mMaj7', suffix: 'm(maj7)', display: 'm(maj7)', spelling: SPELL_MINOR, roots: ROOTS_MINOR },
  { id: '7', suffix: '7', display: '7', spelling: SPELL_MAJOR, roots: ROOTS_MAJOR },
  { id: '7b9', suffix: '7b9', display: '7♭9', spelling: SPELL_MAJOR, roots: ROOTS_MAJOR },
  { id: '7alt', suffix: '7alt', display: '7alt', spelling: SPELL_ALT, roots: ROOTS_MAJOR },
  { id: '7sus', suffix: '7sus', display: '7sus', spelling: SPELL_MAJOR, roots: ROOTS_MAJOR },
  { id: 'm7b5', suffix: 'm7b5', display: 'm7♭5', spelling: SPELL_HALFDIM, roots: ROOTS_MINOR },
  { id: 'dim7', suffix: 'dim7', display: '°7', spelling: SPELL_DIM, roots: ROOTS_MINOR },
];
export const QUALITY: Record<Quality, QualityInfo> = Object.fromEntries(QUALITIES.map(q => [q.id, q])) as Record<Quality, QualityInfo>;

export function isQuality(q: string): q is Quality {
  return q in QUALITY;
}

/** The qualities that can stand in for one when a set has no voicing of it, best first. */
export function qualityFallbacks(q: Quality): Quality[] {
  const more: Partial<Record<Quality, Quality[]>> = {
    '7alt': ['7b9', '7'],
    '7b9': ['7alt', '7'],
    '7sus': ['7'],
    maj7: ['6'],
    '6': ['maj7'],
    m6: ['mMaj7', 'm7'],
    mMaj7: ['m6', 'm7'],
  };
  return [q, ...(more[q] ?? [])];
}

/** "Fm7" — the label a voicing card carries. */
export function chordLabel(rootName: string, q: Quality): string {
  return `${rootName}${QUALITY[q].suffix}`;
}

/** "F m7" as shown, split so the root can be set larger. */
export function chordDisplay(rootName: string, q: Quality): { root: string; quality: string } {
  return { root: pretty(rootName), quality: QUALITY[q].display };
}

/** Interval name of the semitones above the root, as this quality spells it. */
export function intervalName(q: Quality, semis: number): string {
  return QUALITY[q].spelling[mod12(semis)] ?? String(semis);
}

/** Display form of an interval: "b9" → "♭9", "R" → "root". */
export function intervalDisplay(name: string): string {
  return name === 'R' ? 'root' : name.replace(/^b/, '♭').replace(/^#/, '♯');
}

// ── chart symbols ───────────────────────────────────────────────────────

/**
 * iReal's quality suffixes (after the root, before any slash) mapped onto
 * the trainer's qualities, in order of preference: a chart's "C" (a plain
 * triad) is played as Cmaj7, else C6.
 */
const SUFFIX_QUALITIES: [RegExp, Quality[]][] = [
  [/^(\^7?|\^9|\^13|\^7#11|\^9#11|\^7#5|add9|2|)$/, ['maj7', '6']],
  [/^(6|69)$/, ['6', 'maj7']],
  [/^(-\^7|-\^9)$/, ['mMaj7', 'm6', 'm7']],
  [/^(-6|-69|-|-b6|-#5)$/, ['m6', 'mMaj7', 'm7']],
  [/^(-7|-9|-11|-13)$/, ['m7']],
  [/^(h7?|h9)$/, ['m7b5']],
  [/^(o7?|o\^7)$/, ['dim7']],
  [/^(7|9|13|7#11|9#11|13#11)$/, ['7']],
  [/^(7b9|13b9|7b9#11|7b9b5)$/, ['7b9', '7alt', '7']],
  [/^(7alt|7#9|7#5|7b13|7#9#5|7b9#5|9#5|7#9b5|7b5|\+|7b9b13|7#9#11|7b9#9|13#9|9b5)$/, ['7alt', '7b9', '7']],
  [/^(7sus|9sus|13sus|sus|7b9sus|7b13sus|7susadd3)$/, ['7sus', '7']],
];

export interface ChartChord {
  symbol: string;
  root: number;
  rootName: string;
  /** The qualities that can stand for it, best first. */
  qualities: Quality[];
}

/** A chart symbol ("Bb-7", "Eh7/G", "G7b9") as root + qualities; null for N.C. or what isn't a chord. */
export function parseChartChord(symbol: string): ChartChord | null {
  if (!symbol) return null;
  const main = symbol.split('/')[0].trim();
  const m = main.match(/^([A-G][b#]?)(.*)$/);
  if (!m) return null;
  const root = namePc(m[1]);
  if (root == null) return null;
  for (const [re, qs] of SUFFIX_QUALITIES) {
    if (re.test(m[2])) return { symbol, root, rootName: m[1], qualities: qs };
  }
  return null;
}

/** A chord label ("Bbm7b5", "Gm(maj7)") back to root + quality. */
export function parseChordLabel(label: string): { root: number; rootName: string; quality: Quality } | null {
  const m = label.trim().match(/^([A-G][b#]?)(.*)$/);
  if (!m) return null;
  const root = namePc(m[1]);
  const q = QUALITIES.find(x => x.suffix === m[2]);
  if (root == null || !q) return null;
  return { root, rootName: m[1], quality: q.id };
}

// ── voicing shapes ──────────────────────────────────────────────────────

/** Four-note chord tones, bottom to top in close position from the root. */
const CHORD_TONES: Partial<Record<Quality, string[]>> = {
  maj7: ['R', '3', '5', '7'],
  '6': ['R', '3', '5', '6'],
  m7: ['R', 'b3', '5', 'b7'],
  m6: ['R', 'b3', '5', '6'],
  mMaj7: ['R', 'b3', '5', '7'],
  '7': ['R', '3', '5', 'b7'],
  '7sus': ['R', '11', '5', 'b7'],
  m7b5: ['R', 'b3', 'b5', 'b7'],
  dim7: ['R', 'b3', 'b5', '6'],
};

/** Rootless left-hand voicings, bottom to top: [A form, B form]. */
const ROOTLESS: Partial<Record<Quality, [string[], string[]]>> = {
  maj7: [['3', '5', '7', '9'], ['7', '9', '3', '5']],
  '6': [['3', '5', '6', '9'], ['6', '9', '3', '5']],
  m7: [['b3', '5', 'b7', '9'], ['b7', '9', 'b3', '5']],
  m6: [['b3', '5', '6', '9'], ['6', '9', 'b3', '5']],
  '7': [['3', '13', 'b7', '9'], ['b7', '9', '3', '13']],
  '7b9': [['3', '13', 'b7', 'b9'], ['b7', 'b9', '3', '13']],
  '7alt': [['3', '#5', 'b7', '#9'], ['b7', '#9', '3', '#5']],
  m7b5: [['b3', 'b5', 'b7', 'R'], ['b7', 'R', 'b3', 'b5']],
};

/** Stack intervals upward from a starting MIDI note: each sits above the last. */
function stack(rootPc: number, intervals: string[], firstMidi: number): number[] {
  const out: number[] = [];
  for (const iv of intervals) {
    const pc = mod12(rootPc + INTERVALS[iv][0]);
    let m = out.length === 0 ? firstMidi : out[out.length - 1] + 1;
    while (mod12(m) !== pc) m++;
    out.push(m);
  }
  return out;
}

/** Spell MIDI notes as intervals of a root; a double accidental anywhere moves the whole chord to the enharmonic root. */
export function spellChord(rootPc: number, q: Quality, midis: number[], intervals: string[], preferredRoot?: string): { rootName: string; notes: string[] } {
  const info = QUALITY[q];
  const candidates = [preferredRoot ?? info.roots[rootPc], PC_FLAT[rootPc], PC_SHARP[rootPc]];
  for (const rootName of candidates) {
    const notes = midis.map((m, i) => spellInterval(rootName, intervals[i], m));
    const clean = notes.every((n, i) => {
      const iv = INTERVALS[intervals[i]];
      const letter = LETTERS[(LETTERS.indexOf(rootName[0] as Letter) + iv[1]) % 7];
      return n[0] === letter;
    });
    if (clean) return { rootName, notes };
  }
  return { rootName: info.roots[rootPc], notes: midis.map(m => midiName(m)) };
}

export interface VoicingSeed {
  chord_label: string;
  root: number;
  quality: Quality;
  notes: string[];
  top_note: string;
  family: string;
  tags: string[];
  sort_order: number;
}

/** Keys in the order a player learns them: round the cycle of fourths from C. */
export const CYCLE_OF_FOURTHS = [0, 5, 10, 3, 8, 1, 6, 11, 4, 9, 2, 7];

/** Move a shape by octaves until its top note lands in [lo, hi]. */
function placeTop(midis: number[], lo: number, hi: number): number[] {
  let out = midis;
  while (out[out.length - 1] > hi) out = out.map(m => m - 12);
  while (out[out.length - 1] < lo) out = out.map(m => m + 12);
  return out;
}
function placeBottom(midis: number[], lo: number, hi: number): number[] {
  let out = midis;
  while (out[0] > hi) out = out.map(m => m - 12);
  while (out[0] < lo) out = out.map(m => m + 12);
  return out;
}

const DROP2_QUALITIES: Quality[] = ['maj7', 'm7', '7', 'm7b5', '6', 'm6', 'dim7', 'mMaj7', '7sus'];
const ROOTLESS_QUALITIES: Quality[] = ['maj7', 'm7', '7', '7alt', '7b9', 'm7b5', '6', 'm6'];

/**
 * The starter library: drop-2 voicings (each of the four inversions its own
 * card, top note between E4 and Eb5) and rootless A/B left-hand voicings
 * (bottom note between D3 and C#4), in all twelve keys.
 */
export function starterVoicings(): VoicingSeed[] {
  const out: VoicingSeed[] = [];
  let order = 0;
  const qualityRank = (q: Quality, list: Quality[]) => list.indexOf(q);
  for (const q of DROP2_QUALITIES) {
    const tones = CHORD_TONES[q]!;
    for (const rootPc of CYCLE_OF_FOURTHS) {
      for (let inv = 0; inv < 4; inv++) {
        // Close position from the inversion's bottom tone, then drop the
        // second voice from the top an octave.
        const ivs = [...tones.slice(inv), ...tones.slice(0, inv)];
        const close = stack(rootPc, ivs, 48);
        const dropped = [close[2] - 12, close[0], close[1], close[3]];
        const dropIvs = [ivs[2], ivs[0], ivs[1], ivs[3]];
        const placed = placeTop(dropped, 64, 75);
        const { rootName, notes } = spellChord(rootPc, q, placed, dropIvs);
        const top = dropIvs[3] === 'R' ? 'root' : dropIvs[3];
        out.push({
          chord_label: chordLabel(rootName, q),
          root: rootPc,
          quality: q,
          notes,
          top_note: notes[notes.length - 1],
          family: 'drop-2',
          tags: ['drop-2', '4-note', `${top}-on-top`],
          sort_order: qualityRank(q, DROP2_QUALITIES) * 1000 + CYCLE_OF_FOURTHS.indexOf(rootPc) * 10 + inv,
        });
        order++;
      }
    }
  }
  for (const q of ROOTLESS_QUALITIES) {
    const forms = ROOTLESS[q]!;
    for (const rootPc of CYCLE_OF_FOURTHS) {
      forms.forEach((ivs, f) => {
        const first = mod12(rootPc + INTERVALS[ivs[0]][0]) + 48;
        const placed = placeBottom(stack(rootPc, ivs, first), 50, 61);
        const { rootName, notes } = spellChord(rootPc, q, placed, ivs);
        const form = f === 0 ? 'A' : 'B';
        out.push({
          chord_label: chordLabel(rootName, q),
          root: rootPc,
          quality: q,
          notes,
          top_note: notes[notes.length - 1],
          family: `rootless-${form}`,
          tags: ['rootless', 'left-hand', '4-note', `${form}-form`],
          sort_order: 20000 + qualityRank(q, ROOTLESS_QUALITIES) * 1000 + CYCLE_OF_FOURTHS.indexOf(rootPc) * 10 + f,
        });
        order++;
      });
    }
  }
  void order;
  return out;
}

/**
 * MIDI notes (bottom to top) spelled for a chord: each note named as the
 * interval this quality gives its distance from the root. Used to bring in
 * voicings saved elsewhere in the app, which keep MIDI numbers only.
 */
export function spellMidis(rootPc: number, q: Quality, midis: number[], preferredRoot?: string): { rootName: string; notes: string[] } {
  const sorted = [...midis].sort((a, b) => a - b);
  const ivs = sorted.map(m => intervalName(q, m - rootPc));
  return spellChord(rootPc, q, sorted, ivs, preferredRoot);
}

// ── progressions ────────────────────────────────────────────────────────

export interface ProgressionSeed {
  name: string;
  key: number;
  steps: { symbol: string; root: number; quality: Quality }[];
  sort_order: number;
}

/** ii–V–I in every major key and ii–V–i in every minor key. */
export function starterProgressions(): ProgressionSeed[] {
  const out: ProgressionSeed[] = [];
  CYCLE_OF_FOURTHS.forEach((key, i) => {
    const step = (semis: number, q: Quality) => {
      const root = mod12(key + semis);
      const name = QUALITY[q].roots[root];
      return { symbol: chordLabel(name, q), root, quality: q };
    };
    const majName = ROOTS_MAJOR[key];
    out.push({
      name: `ii–V–I in ${majName}`,
      key,
      steps: [step(2, 'm7'), step(7, '7'), step(0, 'maj7')],
      sort_order: i * 2,
    });
    const minName = ROOTS_MINOR[key];
    out.push({
      name: `ii–V–i in ${minName} minor`,
      key,
      steps: [step(2, 'm7b5'), step(7, '7alt'), step(0, 'm6')],
      sort_order: i * 2 + 1,
    });
  });
  return out;
}

/** The diatonic seventh chords of a major key: Imaj7 ii-7 iii-7 IVmaj7 V7 vi-7 viiø7. */
export function diatonicChords(key: number): { root: number; quality: Quality }[] {
  const steps: [number, Quality][] = [
    [0, 'maj7'],
    [2, 'm7'],
    [4, 'm7'],
    [5, 'maj7'],
    [7, '7'],
    [9, 'm7'],
    [11, 'm7b5'],
  ];
  return steps.map(([s, q]) => ({ root: mod12(key + s), quality: q }));
}
