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
  /** -2 double flat, -1 flat, 0 natural, 1 sharp, 2 double sharp. */
  acc: -2 | -1 | 0 | 1 | 2;
  octave: number;
}

// Double accidentals only where charts write them (D♭7♭9's E𝄫): "bb" / "##".
const ACC = '(bb|##|𝄫|𝄪|[b#♭♯])?';
const NOTE_RE = new RegExp(`^([A-G])${ACC}(-?\\d)$`, 'u');
const NAME_RE = new RegExp(`^([A-G])${ACC}$`, 'u');

function accOf(a: string | undefined): Spelled['acc'] {
  switch (a) {
    case 'bb':
    case '𝄫':
      return -2;
    case 'b':
    case '♭':
      return -1;
    case '#':
    case '♯':
      return 1;
    case '##':
    case '𝄪':
      return 2;
    default:
      return 0;
  }
}

export function parseNote(s: string): Spelled | null {
  const m = s.trim().match(NOTE_RE);
  if (!m) return null;
  return { letter: m[1] as Letter, acc: accOf(m[2]), octave: Number(m[3]) };
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
  return mod12(LETTER_PC[m[1] as Letter] + accOf(m[2]));
}

/** Pretty accidentals for display: "Bb" → "B♭", "Ebb" → "E𝄫". */
export function pretty(s: string): string {
  return s
    .replace(/([A-G])bb/g, '$1𝄫')
    .replace(/([A-G])##/g, '$1𝄪')
    .replace(/([A-G])b/g, '$1♭')
    .replace(/([A-G])#/g, '$1♯');
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
 * double accidental — unless `allowDouble` (a name charts write that way).
 */
export function spellInterval(rootName: string, interval: string, midi: number, allowDouble = false): string {
  const root = rootName.match(NAME_RE);
  const iv = INTERVALS[interval];
  if (!root || !iv) return midiName(midi);
  const rootLetter = root[1] as Letter;
  const letter = LETTERS[(LETTERS.indexOf(rootLetter) + iv[1]) % 7];
  let acc = mod12(midi) - LETTER_PC[letter];
  if (acc > 6) acc -= 12;
  if (acc < -6) acc += 12;
  if (acc < -2 || acc > 2 || (!allowDouble && (acc < -1 || acc > 1))) return midiName(midi, rootName.includes('#'));
  const octave = (midi - acc - LETTER_PC[letter]) / 12 - 1;
  return `${letter}${acc === -2 ? 'bb' : acc === -1 ? 'b' : acc === 1 ? '#' : acc === 2 ? '##' : ''}${octave}`;
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

/** A chord label as shown: "Bbm7b5" → "B♭m7♭5". */
export function prettyLabel(label: string): string {
  const p = parseChordLabel(label);
  return p ? `${pretty(p.rootName)}${QUALITY[p.quality].display}` : pretty(label);
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

/**
 * The chart symbols the library plays exactly, by iReal suffix. The library's
 * voicings carry the 9 (and the dominants the 13), so a 9th or 13th chord is
 * the same chord (a 6 voicing's 9 makes a 6/9 one too; 7♭9 matches 7♭9 only); anything else — a bare triad, sus, alterations, ♯11,
 * 11, °7, m(maj7), m6 — has no voicing yet and is skipped, never stood in for.
 * In iReal "^" alone is maj7 and "h" alone is ø7. A slash chord counts as the
 * chord above the slash (the voicings are rootless; the bass is elsewhere).
 */
const EXACT_SUFFIX: [RegExp, Quality][] = [
  [/^\^7?$|^\^9$/, 'maj7'],
  // The 6 voicing (3 6 9 5) carries the 9: a 6/9 is the same chord.
  [/^6$|^69$/, '6'],
  // 7♭9's voicings carry the 5, not the 13: a 13♭9 isn't the same chord.
  [/^7b9$/, '7b9'],
  [/^-7$|^-9$/, 'm7'],
  [/^7$|^9$|^13$/, '7'],
  [/^h7?$/, 'm7b5'],
];

/** A chart symbol the library plays exactly: root + quality; null when it has no voicing for it. */
export function exactChartChord(symbol: string): { root: number; rootName: string; quality: Quality } | null {
  const m = symbol.split('/')[0].trim().match(/^([A-G][b#]?)(.*)$/);
  if (!m) return null;
  const root = namePc(m[1]);
  if (root == null) return null;
  const hit = EXACT_SUFFIX.find(([re]) => re.test(m[2]));
  return hit ? { root, rootName: m[1], quality: hit[1] } : null;
}

/** An iReal chart symbol as a player reads it: "Bb-7b5" → "B♭m7♭5", "C^7" → "Cmaj7", "Eh7" → "Eø7". */
export function chartDisplay(symbol: string): string {
  const [main, bass] = symbol.split('/');
  const m = main.match(/^([A-G][b#]?)(.*)$/);
  if (!m) return symbol;
  const suffix = m[2]
    .replace(/^-\^7?/, 'm(maj7)')
    .replace(/^-/, 'm')
    .replace(/^\^/, 'maj')
    .replace(/^maj$/, 'maj7')
    .replace(/^h/, 'ø')
    .replace(/^o/, '°')
    .replace(/b(?=\d)/g, '♭')
    .replace(/#/g, '♯');
  return `${pretty(m[1])}${suffix}${bass ? `/${pretty(bass)}` : ''}`;
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
//
// The library's shapes, as the owner wrote them (bottom to top). Only these
// are generated; anything else is added by hand on the Voicings page.

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
  /** Where the top voice moves to (the m7♭5 spread's 11 → ♭3), spelled with octave; null when it stays. */
  top_move: string | null;
  chord_label: string;
  root: number;
  quality: Quality;
  notes: string[];
  top_note: string;
  family: string;
  tags: string[];
  lowest_register: number;
  sort_order: number;
}

/** Keys in the order a player learns them: round the cycle of fourths from C. */
export const CYCLE_OF_FOURTHS = [0, 5, 10, 3, 8, 1, 6, 11, 4, 9, 2, 7];

/** No voicing's bottom note goes below the E♭ under middle C. */
export const LOWEST_NOTE = 51; // Eb3

interface ShapeSet {
  family: string;
  /** Tags every voicing of the family carries. */
  tags: string[];
  /**
   * Per quality, each shape bottom to top, with the tag that names it, and
   * where the top voice moves to, if it moves (an interval of the root), and
   * its own tags when the family's don't fit it.
   */
  shapes: Partial<Record<Quality, { ivs: string[]; tag: string; move?: string; tags?: string[] }[]>>;
}

export const SHAPE_SETS: ShapeSet[] = [
  {
    // Rootless two-handed drop-2: the left hand takes the bottom two notes.
    family: 'drop-2 two-hand',
    tags: ['drop-2', 'two-handed', 'rootless', '4-note'],
    shapes: {
      m7: [
        { ivs: ['b3', 'b7', '9', '5'], tag: '3-7-9-5' },
        { ivs: ['b7', 'b3', '5', '9'], tag: '7-3-5-9' },
      ],
      maj7: [
        { ivs: ['3', '7', '9', '5'], tag: '3-7-9-5' },
        { ivs: ['7', '3', '5', '9'], tag: '7-3-5-9' },
      ],
      // The 6 chord: one shape (the owner: "one inversion 3 6 9 5").
      '6': [{ ivs: ['3', '6', '9', '5'], tag: '3-6-9-5' }],
      // Dominant: the 5 becomes the 13.
      '7': [
        { ivs: ['3', 'b7', '9', '13'], tag: '3-7-9-5' },
        { ivs: ['b7', '3', '13', '9'], tag: '7-3-5-9' },
      ],
      // 7♭9 (the owner: "just drop-2 rootless for now"): the 13's place keeps the
      // 5, so the four notes are a diminished seventh — the same keys serve
      // four dominants a minor third apart.
      '7b9': [
        { ivs: ['3', 'b7', 'b9', '5'], tag: '3-7-9-5' },
        { ivs: ['b7', '3', '5', 'b9'], tag: '7-3-5-9' },
      ],
      // The m7♭5 of this set (the owner's call: the spread one only) has its
      // root, and its top voice moves from the 11 down to the ♭3.
      m7b5: [{ ivs: ['R', 'b5', 'b7', '11'], tag: '1-5-7-11', move: 'b3', tags: ['drop-2', 'two-handed', 'spread', '4-note', 'movement'] }],
    },
  },
  {
    family: 'right-hand rootless',
    tags: ['right-hand', 'rootless', '4-note'],
    shapes: {
      m7: [
        { ivs: ['b3', '5', 'b7', '9'], tag: '3-5-7-9' },
        { ivs: ['b7', '9', 'b3', '5'], tag: '7-9-3-5' },
      ],
      maj7: [
        { ivs: ['3', '5', '7', '9'], tag: '3-5-7-9' },
        { ivs: ['7', '9', '3', '5'], tag: '7-9-3-5' },
      ],
      '7': [
        { ivs: ['3', '13', 'b7', '9'], tag: '3-5-7-9' },
        { ivs: ['b7', '9', '3', '13'], tag: '7-9-3-5' },
      ],
    },
  },
  {
    family: 'm7b5 closed',
    tags: ['closed', '5-note'],
    shapes: { m7b5: [{ ivs: ['b5', 'b7', 'R', 'b3', 'b5'], tag: '5-7-1-3-5' }] },
  },
];

const QUALITY_ORDER: Quality[] = ['m7', 'maj7', '6', '7', '7b9', 'm7b5'];

/**
 * MIDI notes spelled as these intervals above a root named `rootName`, or
 * null when any note would need a double flat or sharp.
 */
export function spellStrict(rootName: string, midis: number[], intervals: string[], allowDouble = false): string[] | null {
  const notes = midis.map((m, i) => spellInterval(rootName, intervals[i], m, allowDouble));
  const ok = notes.every((n, i) => n[0] === LETTERS[(LETTERS.indexOf(rootName[0] as Letter) + INTERVALS[intervals[i]][1]) % 7]);
  return ok ? notes : null;
}

/** Every name a root goes by: one for a white key, the flat and the sharp for a black key. */
export function rootNames(pc: number): string[] {
  return PC_FLAT[pc] === PC_SHARP[pc] ? [PC_FLAT[pc]] : [PC_FLAT[pc], PC_SHARP[pc]];
}

/**
 * Spellings left out as rare (the owner: "drop the rare ones like A♯m7 and
 * D♯m7"): under 10% of that chord's appearances in the 1,460 standards'
 * charts, where the other name is in the library. Counted Nov 2026 — A♯m7 3
 * (B♭m7 1,337), C♯maj7 2 (D♭maj7 579), D♯m7 15 (E♭m7 737), C♯7 27 (D♭7 856),
 * G♯7 31 (A♭7 1,144), A♯m7♭5 2 (B♭m7♭5 33), F♯maj7 15 (G♭maj7 253), G♯m7 38
 * (A♭m7 434); 6 chords (and 6/9) C♯6 0 (D♭6 87), F♯6 2 (G♭6 24), G♯6 0
 * (A♭6 317); 7♭9 (and 13♭9) D♯7♭9 1 (E♭7♭9 77), G♭7♭9 1 (F♯7♭9 49), G♯7♭9 4
 * (A♭7♭9 54), A♯7♭9 0 (B♭7♭9 121). Both names stay where charts use both:
 * D♭m7 / C♯m7 30 / 70%, G♭7 / F♯7 69 / 31%, D♭7♭9 / C♯7♭9 54 / 46%.
 */
export const RARE_SPELLINGS = new Set(['A#m7', 'C#maj7', 'D#m7', 'C#7', 'G#7', 'A#m7b5', 'F#maj7', 'G#m7', 'C#6', 'F#6', 'G#6', 'D#7b9', 'Gb7b9', 'G#7b9', 'A#7b9']);

/**
 * Names charts write although they need a double accidental, so they're kept
 * with it (the owner: "keep the ones charts actually use"): D♭7♭9's ♭9 is E𝄫,
 * A♭7♭9's B𝄫.
 */
export const CHARTED_DOUBLE = new Set(['Db7b9', 'Ab7b9']);

/** A pitch class as a key is shown: "C", or "D♭/C♯" for a black key. */
export function keyLabel(pc: number): string {
  return rootNames(pc).map(pretty).join('/');
}

/**
 * The starter library: every shape in SHAPE_SETS in all twelve keys —
 * black-key roots under both names, flat and sharp (D♭m7 and C♯m7), except
 * a name that would need a double accidental (E♭m7♭5 has B𝄫, so only D♯m7♭5).
 * Each sits in the lowest octave whose bottom note is at or above E♭3, and is
 * marked so Play mode never accepts it lower.
 */
export function starterVoicings(): VoicingSeed[] {
  const out: VoicingSeed[] = [];
  SHAPE_SETS.forEach((set, si) => {
    for (const q of QUALITY_ORDER) {
      const shapes = set.shapes[q];
      if (!shapes) continue;
      for (const rootPc of CYCLE_OF_FOURTHS) {
        rootNames(rootPc).forEach((rootName, ni) => {
          shapes.forEach((shape, k) => {
            const first = mod12(rootPc + INTERVALS[shape.ivs[0]][0]);
            let bottom = first;
            while (bottom < LOWEST_NOTE) bottom += 12;
            const midis = stack(rootPc, shape.ivs, bottom);
            const label = chordLabel(rootName, q);
            const notes = spellStrict(rootName, midis, shape.ivs, CHARTED_DOUBLE.has(label));
            if (!notes || RARE_SPELLINGS.has(label)) return;
            // The top voice's move: the nearest such note to where it starts.
            let move: string | null = null;
            if (shape.move) {
              const top = midis[midis.length - 1];
              const pc = mod12(rootPc + INTERVALS[shape.move][0]);
              let m = top - 1;
              while (mod12(m) !== pc) m--;
              if (top - m > 6) m += 12;
              move = spellStrict(rootName, [m], [shape.move])?.[0] ?? null;
              if (!move) return;
            }
            out.push({
              chord_label: chordLabel(rootName, q),
              root: rootPc,
              quality: q,
              notes,
              top_note: notes[notes.length - 1],
              top_move: move,
              family: set.family,
              tags: [...(shape.tags ?? set.tags), shape.tag],
              lowest_register: LOWEST_NOTE,
              sort_order: si * 10000 + QUALITY_ORDER.indexOf(q) * 1000 + CYCLE_OF_FOURTHS.indexOf(rootPc) * 20 + ni * 10 + k,
            });
          });
        });
      }
    }
  });
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
/** Chord tones that decide whether a root name can spell a quality. */
const QUALITY_TONES: Record<Quality, string[]> = {
  maj7: ['R', '3', '5', '7'],
  '6': ['R', '3', '5', '6'],
  m7: ['R', 'b3', '5', 'b7'],
  m6: ['R', 'b3', '5', '6'],
  mMaj7: ['R', 'b3', '5', '7'],
  '7': ['R', '3', '5', 'b7'],
  '7b9': ['R', '3', 'b7', 'b9'],
  // Alterations aren't in the library yet; their spelling is decided when they are.
  '7alt': ['R', '3', 'b7'],
  '7sus': ['R', '11', '5', 'b7'],
  m7b5: ['R', 'b3', 'b5', 'b7'],
  dim7: ['R', 'b3', 'b5', '6'],
};

/** Can this root name spell the chord with single accidentals only? */
export function spellable(rootName: string, rootPc: number, q: Quality): boolean {
  const ivs = QUALITY_TONES[q];
  return spellStrict(rootName, ivs.map(iv => 60 + rootPc + INTERVALS[iv][0]), ivs) != null;
}

export function starterProgressions(): ProgressionSeed[] {
  const out: ProgressionSeed[] = [];
  let order = 0;
  CYCLE_OF_FOURTHS.forEach(key => {
    // Each chord's root spelled from the key's own name (in G♭: A♭m7 D♭7 G♭maj7, never G♯m7).
    const step = (keyName: string, interval: string, q: Quality) => {
      const root = mod12(key + INTERVALS[interval][0]);
      const name = pitchName(spellInterval(keyName, interval, 60 + root));
      return { symbol: chordLabel(name, q), root, quality: q, name };
    };
    // A black key under both its names (G♭ and F♯), as long as every chord
    // then has a name the library uses and spells without double accidentals
    // (A♯ major would need B♯m7, D♭ minor E♭m7♭5: skipped).
    const add = (label: string, keyName: string, ivs: [string, Quality][]) => {
      const steps = ivs.map(([iv, q]) => step(keyName, iv, q));
      // …and isn't a spelling left out as rare (a 7alt goes by its dominant's name).
      const rare = (st: { name: string; quality: Quality }) => RARE_SPELLINGS.has(chordLabel(st.name, st.quality === '7alt' ? '7' : st.quality));
      if (!steps.every(st => rootNames(st.root).includes(st.name) && spellable(st.name, st.root, st.quality) && !rare(st))) return;
      out.push({ name: label, key, steps: steps.map(({ name: _n, ...st }) => st), sort_order: order++ });
    };
    for (const n of rootNames(key)) add(`ii–V–I in ${n}`, n, [['9', 'm7'], ['5', '7'], ['R', 'maj7']]);
    for (const n of rootNames(key)) add(`ii–V–i in ${n} minor`, n, [['9', 'm7b5'], ['5', '7alt'], ['R', 'm6']]);
  });
  return out;
}

/** The diatonic seventh chords of a major key: Imaj7 ii-7 iii-7 IVmaj7 V7 vi-7 viiø7. */
export function diatonicChords(key: number): { root: number; quality: Quality; rootName: string }[] {
  // Spelled from the key's name, flats for a black key (D♭ major: E♭m7, never D♯m7).
  const keyName = ROOTS_MAJOR[key];
  const steps: [string, Quality][] = [
    ['R', 'maj7'],
    ['9', 'm7'],
    ['3', 'm7'],
    ['11', 'maj7'],
    ['5', '7'],
    ['13', 'm7'],
    ['7', 'm7b5'],
  ];
  return steps.map(([iv, q]) => {
    const root = mod12(key + INTERVALS[iv][0]);
    return { root, quality: q, rootName: pitchName(spellInterval(keyName, iv, 60 + root)) };
  });
}
