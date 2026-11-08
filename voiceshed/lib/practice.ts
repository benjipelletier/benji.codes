// Grading answers, and building the practice sets: timed runs through
// ii–V–Is, a key's chords, a tune's changes or a tag filter.

import { chartDisplay, prettyLabel, diatonicChords, exactChartChord, isIii, servesIii, mod12, namePc, noteMidi, parseChordLabel, pitchName, PC_FLAT, type Quality } from './theory';
import type { Context, ContextType, Mode, Tune, Voicing } from './types';
import { shuffle } from './srs';

export const midisOf = (v: Voicing) => v.notes.map(noteMidi);

/** A chart symbol moved by semitones, roots (and a slash bass) named in flats: "F-7/C" + 2 → "G-7/D". */
export function transposeSymbol(symbol: string, semis: number): string {
  const move = (name: string) => {
    const pc = namePc(name);
    return pc == null ? name : PC_FLAT[mod12(pc + semis)];
  };
  const [main, bass] = symbol.split('/');
  const m = main.match(/^([A-G][b#]?)(.*)$/);
  if (!m) return symbol;
  const out = move(m[1]) + m[2];
  return bass && /^[A-G][b#]?$/.test(bass) ? `${out}/${move(bass)}` : bass ? `${out}/${bass}` : out;
}

// ── grading ─────────────────────────────────────────────────────────────

/**
 * Play: the keys tapped are the voicing, in its register or moved whole by
 * octaves (the prompt names no octave) — but never below the voicing's
 * lowest playable register, when it has one.
 */
export function gradePlay(v: Voicing, tapped: number[], moveTo: number | null = null): boolean {
  const want = midisOf(v);
  const got = [...tapped].sort((a, b) => a - b);
  if (got.length !== want.length) return false;
  const shift = got[0] - want[0];
  if (shift % 12 !== 0) return false;
  if (!got.every((m, i) => m - want[i] === shift)) return false;
  if (shift !== 0 && v.lowest_register != null && got[0] < v.lowest_register) return false;
  // A voicing whose top moves: the move lands where it should, in the same octave as the chord.
  if (v.top_move && moveTo !== noteMidi(v.top_move) + shift) return false;
  return true;
}

/** The names Spell expects: the notes bottom to top, then where the top moves, if it moves. */
export function spellNames(v: Voicing): string[] {
  return [...v.notes.map(pitchName), ...(v.top_move ? [pitchName(v.top_move)] : [])];
}

/**
 * Spell: the note names bottom to top (then the moved-to note). Enharmonic
 * names (G# for Ab) count unless strict spelling is on; `enharmonic` says
 * one was given.
 */
export function gradeSpell(v: Voicing, names: string[], strict: boolean): { correct: boolean; enharmonic: boolean } {
  const want = spellNames(v);
  if (names.length !== want.length) return { correct: false, enharmonic: false };
  const samePc = names.every((n, i) => namePc(n) === namePc(want[i]));
  const exact = names.every((n, i) => n === want[i]);
  if (exact) return { correct: true, enharmonic: false };
  if (samePc) return { correct: !strict, enharmonic: true };
  return { correct: false, enharmonic: false };
}

/** Name's answer: the chord, root and quality (no longer the top note — the owner: "remove the top note from name"). */
export interface NameAnswer {
  root: number;
  quality: Quality;
}

/** Whether the voicing has its root in it (the m7♭5 spread, the iii's, °7, block chords) or is rootless. */
export function hasRoot(v: Voicing): boolean {
  return midisOf(v).some(m => mod12(m - v.root) === 0);
}

export function nameOf(v: Voicing): NameAnswer {
  return { root: v.root, quality: v.quality };
}

/**
 * Name: the chord, root and quality. Any reading the library gives the same
 * keys counts (a drop-2 C6 is also an Am7).
 */
export function gradeName(v: Voicing, answer: NameAnswer, library: Voicing[]): boolean {
  const same = (a: NameAnswer, b: NameAnswer) => a.root === b.root && a.quality === b.quality;
  if (same(nameOf(v), answer)) return true;
  const key = midisOf(v).join(',');
  return library.some(o => o.id !== v.id && midisOf(o).join(',') === key && same(nameOf(o), answer));
}

// ── sets ────────────────────────────────────────────────────────────────

/** 'charts' is a tune from the owner's iFake Pro playlists: the same as 'tune' from here on. */
export type SetSource = 'ii-v-i' | 'key' | 'root' | 'tune' | 'charts' | 'tags';

export interface SetSpec {
  source: SetSource;
  /** Pitch class; null = every key (ii–V–I only). */
  key: number | null;
  tuneId: string | null;
  /** Every tag must be on the voicing. */
  tags: string[];
  mode: Mode;
  /** Most cards in an isolated set; 0 = all. */
  limit: number;
}

export interface Step {
  voicing: Voicing;
  context_type: ContextType;
  context_id: string | null;
  /** The chord as the progression or tune writes it, when it does. */
  symbol: string | null;
  /** Where this step falls: a progression's name, a tune's bar run. */
  group: string | null;
}

export interface Skipped {
  symbol: string;
  count: number;
  /** No voicing of this chord type at all, or just none with the chosen tags. */
  why: 'no-voicing' | 'tags';
}

/** Skipped chords tallied, most frequent first, first-seen order among equals. */
function tally(list: { symbol: string; why: Skipped['why'] }[]): Skipped[] {
  const m = new Map<string, Skipped>();
  for (const { symbol, why } of list) {
    const k = `${symbol}|${why}`;
    const cur = m.get(k);
    if (cur) cur.count++;
    else m.set(k, { symbol, count: 1, why });
  }
  return [...m.values()].sort((a, b) => b.count - a.count);
}

export interface BuiltSet {
  steps: Step[];
  label: string;
  setKey: string;
  context_type: ContextType;
  /** Chords left out — no exact voicing in the library (or the tag filter) — as shown, with how often. */
  skipped: Skipped[];
  /** Chords in the progression or tune, played or not. */
  chords: number;
  /**
   * Every chord the set can play (with the tags picked), in set order and
   * with how often, whatever the shuffle or card limit: for choosing what
   * goes into the deck.
   */
  order: OrderEntry[];
}

/** A chord the set plays: its label, how often, and whether as a iii (its iii voicings, 8 for 9). */
export type OrderEntry = [label: string, count: number, iii: boolean];

/** A shape's own tag ("3-7-9-5", "1-5-7-11"): kept on the voicing, not offered as a filter. */
export const isShapeTag = (tag: string) => /^[b#]?\d+(-[b#]?\d+)+$/.test(tag);

/** Tags to filter by, most common first. */
export function filterTags(voicings: Voicing[]): [string, number][] {
  const m = new Map<string, number>();
  for (const v of voicings) for (const tag of v.tags) if (!isShapeTag(tag)) m.set(tag, (m.get(tag) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
}

export function matchesTags(v: Voicing, tags: string[]): boolean {
  return tags.every(t => v.tags.includes(t));
}

/** Total movement from one voicing to the next (notes paired bottom up). */
function distance(a: number[], b: number[]): number {
  if (a.length === b.length) return a.reduce((s, m, i) => s + Math.abs(m - b[i]), 0);
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.abs(mean(a) - mean(b)) * Math.max(a.length, b.length) + 2;
}

/** The candidate that moves least from the last voicing; the first sits nearest middle C up a fourth. */
export function voiceLead(cands: Voicing[], prev: Voicing | null): Voicing {
  if (!prev) {
    const centre = (v: Voicing) => {
      const m = midisOf(v);
      return Math.abs(m.reduce((s, x) => s + x, 0) / m.length - 64);
    };
    return [...cands].sort((a, b) => centre(a) - centre(b))[0];
  }
  const p = midisOf(prev);
  return [...cands].sort((a, b) => distance(p, midisOf(a)) - distance(p, midisOf(b)))[0];
}

/**
 * The voicings that can play a chord: its quality (or the next best), and —
 * a black-key root being in the library under both names — the ones spelled
 * as the chart spells it (C♯m7 for a C♯m7), so a progression keeps one
 * spelling. Any spelling when the chart's has none.
 */
/** `iii`: the chord is a m7 as the iii of a major key — its iii voicings (8 for 9) only; otherwise never them. */
export function candidatesFor(voicings: Voicing[], root: number, qualities: Quality[], tags: string[], rootName?: string, iii = false): Voicing[] {
  for (const q of qualities) {
    const c = voicings.filter(v => v.root === root && v.quality === q && matchesTags(v, tags) && (iii ? servesIii(v) : !isIii(v)));
    if (!c.length) continue;
    const spelled = rootName ? c.filter(v => parseChordLabel(v.chord_label)?.rootName === rootName) : [];
    return spelled.length ? spelled : c;
  }
  return [];
}

const symbolRoot = (symbol: string) => symbol.match(/^[A-G][b#]?/)?.[0];
/** A library chord label as shown ("Bbm7b5" → "B♭m7♭5"). */
const prettyChord = (label: string) => {
  const p = parseChordLabel(label);
  return p ? prettyLabel(label) : label;
};

const keyName = (k: number) => prettyLabel(PC_FLAT[k]);
const tagLabel = (tags: string[]) => (tags.length ? ` · ${tags.map(t => (t === 'two-handed' ? 'two-hand' : t)).join(' + ')}` : '');

/** The voicings' chords in the order they first come, with how many times each is played (a iii apart). */
export function countLabels(vs: { chord_label: string; tags: string[] }[]): OrderEntry[] {
  const m = new Map<string, OrderEntry>();
  for (const v of vs) {
    const iii = isIii(v);
    const k = `${v.chord_label}|${iii}`;
    const e = m.get(k);
    if (e) e[1]++;
    else m.set(k, [v.chord_label, 1, iii]);
  }
  return [...m.values()];
}

export function buildSet(spec: SetSpec, data: { voicings: Voicing[]; contexts: Context[]; tunes: Tune[] }): BuiltSet {
  const { voicings, contexts, tunes } = data;
  const tagKey = [...spec.tags].sort().join('+');
  const skipped: { symbol: string; why: Skipped['why'] }[] = [];
  let chords = 0;
  /** Why a chord has no candidate: none of its type at all, or only outside the tags. */
  const why = (root: number, q: Quality): Skipped['why'] => (voicings.some(v => v.root === root && v.quality === q) ? 'tags' : 'no-voicing');

  if (spec.source === 'ii-v-i') {
    const progs = shuffle(contexts.filter(c => c.type === 'progression' && (spec.key == null || c.key === spec.key)));
    const steps: Step[] = [];
    for (const c of progs) {
      let prev: Voicing | null = null;
      for (const s of c.steps) {
        const pinned = s.voicing_id ? voicings.find(v => v.id === s.voicing_id && matchesTags(v, spec.tags)) : undefined;
        chords++;
        // Exact chords only: a chord the library has no voicing for is skipped.
        const cands = pinned ? [pinned] : candidatesFor(voicings, s.root, [s.quality], spec.tags, symbolRoot(s.symbol));
        if (!cands.length) {
          skipped.push({ symbol: prettyChord(s.symbol), why: why(s.root, s.quality) });
          continue;
        }
        const v = voiceLead(cands, prev);
        steps.push({ voicing: v, context_type: 'progression', context_id: c.id, symbol: s.symbol, group: c.name });
        prev = v;
      }
    }
    // For the deck: progressions in their own order (they were shuffled to play).
    const rank = new Map(contexts.map((c, i) => [c.id, c.sort_order ?? i]));
    const ordered = [...steps].sort((a, b) => (rank.get(a.context_id!) ?? 0) - (rank.get(b.context_id!) ?? 0));
    return {
      order: countLabels(ordered.map(s => s.voicing)),
      steps,
      label: `ii–V–Is${spec.key == null ? ', all keys' : ` in ${keyName(spec.key)}`}${tagLabel(spec.tags)}`,
      setKey: `ii-v-i:${spec.key ?? 'all'}:${tagKey}:${spec.mode}`,
      context_type: 'progression',
      skipped: tally(skipped),
      chords,
    };
  }

  if (spec.source === 'tune' || spec.source === 'charts') {
    const tune = tunes.find(t => t.id === spec.tuneId);
    if (!tune) return { steps: [], label: 'Tune', setKey: 'tune:none', context_type: 'tune', skipped: [], chords: 0, order: [] };
    const key = spec.key ?? tune.home_key;
    const shift = mod12(key - tune.home_key);
    const steps: Step[] = [];
    let prev: Voicing | null = null;
    for (const sym of tune.chords) {
      const moved = transposeSymbol(sym, shift);
      if (!/^[A-G]/.test(moved)) continue; // not a chord (a repeat sign, N.C.)
      chords++;
      // Exact chords only: one the library has no voicing for is skipped, never stood in for.
      const chord = exactChartChord(moved);
      if (!chord) {
        skipped.push({ symbol: chartDisplay(moved), why: 'no-voicing' });
        continue;
      }
      // A m7 that's the iii of the tune's home major key (in the key it's played in) takes the iii voicings.
      const iii = chord.quality === 'm7' && !tune.is_minor && chord.root === mod12(key + 4);
      const cands = candidatesFor(voicings, chord.root, [chord.quality], spec.tags, chord.rootName, iii);
      if (!cands.length) {
        skipped.push({ symbol: chartDisplay(moved), why: why(chord.root, chord.quality) });
        continue;
      }
      const v = voiceLead(cands, prev);
      steps.push({ voicing: v, context_type: 'tune', context_id: null, symbol: moved, group: tune.title });
      prev = v;
    }
    return {
      order: countLabels(steps.map(s => s.voicing)),
      steps,
      label: `${tune.title} in ${keyName(key)}${tune.is_minor ? ' minor' : ''}${tagLabel(spec.tags)}`,
      setKey: `tune:${tune.id}:${key}:${tagKey}:${spec.mode}`,
      context_type: 'tune',
      skipped: tally(skipped),
      chords,
    };
  }

  let pool: Voicing[];
  let label: string;
  if (spec.source === 'key') {
    const key = spec.key ?? 0;
    // Each chord in the key's spelling; a name the library doesn't use (G♭ major's C♭maj7) takes the other.
    pool = diatonicChords(key).flatMap(c => candidatesFor(voicings, c.root, [c.quality], spec.tags, c.rootName, c.iii));
    label = `The chords of ${keyName(key)} major${tagLabel(spec.tags)}`;
  } else if (spec.source === 'root') {
    // Every chord on one root (the owner: "practice chords with the same root, so all C type chords"):
    // both names of a black key; a m7's iii voicings are for a key's iii, so not here.
    const root = spec.key ?? 0;
    const qOrder: Quality[] = ['m7', '7', '7b9', '7alt', 'dim7', 'maj7', '6', 'm7b5'];
    pool = voicings
      .filter(v => v.root === root && matchesTags(v, spec.tags) && !isIii(v))
      .sort((a, b) => qOrder.indexOf(a.quality) - qOrder.indexOf(b.quality) || a.sort_order - b.sort_order);
    label = `Every chord on ${keyName(root)}${tagLabel(spec.tags)}`;
  } else {
    pool = voicings.filter(v => matchesTags(v, spec.tags) && (spec.key == null || v.root === spec.key));
    label = `${spec.tags.length ? spec.tags.join(' + ') : 'All voicings'}${spec.key == null ? '' : ` on ${keyName(spec.key)}`}`;
  }
  // For the deck: every chord in the pool, in the key's order (before the shuffle and limit).
  const order = countLabels(pool).map(([l, , iii]) => [l, 1, iii] as OrderEntry);
  shuffle(pool);
  if (spec.limit > 0) pool = pool.slice(0, spec.limit);
  return {
    order,
    steps: pool.map(v => ({ voicing: v, context_type: 'isolated', context_id: null, symbol: null, group: null })),
    label,
    setKey: `${spec.source}:${spec.key ?? 'all'}:${tagKey}:${spec.mode}:${spec.limit}`,
    context_type: 'isolated',
    skipped: [],
    chords: 0,
  };
}
