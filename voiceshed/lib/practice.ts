// Grading answers, and building the practice sets: timed runs through
// ii–V–Is, a key's chords, a tune's changes or a tag filter.

import { diatonicChords, mod12, namePc, noteMidi, parseChartChord, pitchName, PC_FLAT, qualityFallbacks, type Quality } from './theory';
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
export function gradePlay(v: Voicing, tapped: number[]): boolean {
  const want = midisOf(v);
  const got = [...tapped].sort((a, b) => a - b);
  if (got.length !== want.length) return false;
  const shift = got[0] - want[0];
  if (shift % 12 !== 0) return false;
  if (!got.every((m, i) => m - want[i] === shift)) return false;
  if (shift !== 0 && v.lowest_register != null && got[0] < v.lowest_register) return false;
  return true;
}

/**
 * Spell: the note names bottom to top. Enharmonic names (G# for Ab) count
 * unless strict spelling is on; `enharmonic` says one was given.
 */
export function gradeSpell(v: Voicing, names: string[], strict: boolean): { correct: boolean; enharmonic: boolean } {
  const want = v.notes.map(pitchName);
  if (names.length !== want.length) return { correct: false, enharmonic: false };
  const samePc = names.every((n, i) => namePc(n) === namePc(want[i]));
  const exact = names.every((n, i) => n === want[i]);
  if (exact) return { correct: true, enharmonic: false };
  if (samePc) return { correct: !strict, enharmonic: true };
  return { correct: false, enharmonic: false };
}

export interface NameAnswer {
  root: number;
  quality: Quality;
  /** Semitones from the root up to the top note. */
  top: number;
}

export function nameOf(v: Voicing): NameAnswer {
  const m = midisOf(v);
  return { root: v.root, quality: v.quality, top: mod12(m[m.length - 1] - v.root) };
}

/**
 * Name: the chord and the chord tone on top. Any reading the library gives
 * the same keys counts (a drop-2 C6 is also an Am7).
 */
export function gradeName(v: Voicing, answer: NameAnswer, library: Voicing[]): boolean {
  const same = (a: NameAnswer, b: NameAnswer) => a.root === b.root && a.quality === b.quality && a.top === b.top;
  if (same(nameOf(v), answer)) return true;
  const key = midisOf(v).join(',');
  return library.some(o => o.id !== v.id && midisOf(o).join(',') === key && same(nameOf(o), answer));
}

// ── sets ────────────────────────────────────────────────────────────────

export type SetSource = 'ii-v-i' | 'key' | 'tune' | 'tags';

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

export interface BuiltSet {
  steps: Step[];
  label: string;
  setKey: string;
  context_type: ContextType;
  /** Chords no voicing in the filter could cover. */
  skipped: string[];
}

/** A shape's own tag ("3-7-9-5", "1-5-7-11"): kept on the voicing, not offered as a filter. */
export const isShapeTag = (tag: string) => /^\d+(-\d+)+$/.test(tag);

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
function voiceLead(cands: Voicing[], prev: Voicing | null): Voicing {
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

function candidatesFor(voicings: Voicing[], root: number, qualities: Quality[], tags: string[]): Voicing[] {
  for (const q of qualities) {
    const c = voicings.filter(v => v.root === root && v.quality === q && matchesTags(v, tags));
    if (c.length) return c;
  }
  return [];
}

const keyName = (k: number) => PC_FLAT[k];
const tagLabel = (tags: string[]) => (tags.length ? ` · ${tags.join(' + ')}` : '');

export function buildSet(spec: SetSpec, data: { voicings: Voicing[]; contexts: Context[]; tunes: Tune[] }): BuiltSet {
  const { voicings, contexts, tunes } = data;
  const tagKey = [...spec.tags].sort().join('+');
  const skipped: string[] = [];

  if (spec.source === 'ii-v-i') {
    const progs = shuffle(contexts.filter(c => c.type === 'progression' && (spec.key == null || c.key === spec.key)));
    const steps: Step[] = [];
    for (const c of progs) {
      let prev: Voicing | null = null;
      for (const s of c.steps) {
        const pinned = s.voicing_id ? voicings.find(v => v.id === s.voicing_id && matchesTags(v, spec.tags)) : undefined;
        const cands = pinned ? [pinned] : candidatesFor(voicings, s.root, qualityFallbacks(s.quality), spec.tags);
        if (!cands.length) {
          skipped.push(s.symbol);
          continue;
        }
        const v = voiceLead(cands, prev);
        steps.push({ voicing: v, context_type: 'progression', context_id: c.id, symbol: s.symbol, group: c.name });
        prev = v;
      }
    }
    return {
      steps,
      label: `ii–V–Is${spec.key == null ? ', all keys' : ` in ${keyName(spec.key)}`}${tagLabel(spec.tags)}`,
      setKey: `ii-v-i:${spec.key ?? 'all'}:${tagKey}:${spec.mode}`,
      context_type: 'progression',
      skipped: [...new Set(skipped)],
    };
  }

  if (spec.source === 'tune') {
    const tune = tunes.find(t => t.id === spec.tuneId);
    if (!tune) return { steps: [], label: 'Tune', setKey: 'tune:none', context_type: 'tune', skipped: [] };
    const key = spec.key ?? tune.home_key;
    const shift = mod12(key - tune.home_key);
    const steps: Step[] = [];
    let prev: Voicing | null = null;
    for (const sym of tune.chords) {
      const moved = transposeSymbol(sym, shift);
      const chord = parseChartChord(moved);
      if (!chord) continue;
      const cands = candidatesFor(voicings, chord.root, chord.qualities, spec.tags);
      if (!cands.length) {
        skipped.push(moved);
        continue;
      }
      const v = voiceLead(cands, prev);
      steps.push({ voicing: v, context_type: 'tune', context_id: null, symbol: moved, group: tune.title });
      prev = v;
    }
    return {
      steps,
      label: `${tune.title} in ${keyName(key)}${tune.is_minor ? ' minor' : ''}${tagLabel(spec.tags)}`,
      setKey: `tune:${tune.id}:${key}:${tagKey}:${spec.mode}`,
      context_type: 'tune',
      skipped: [...new Set(skipped)],
    };
  }

  let pool: Voicing[];
  let label: string;
  if (spec.source === 'key') {
    const key = spec.key ?? 0;
    const chords = diatonicChords(key);
    pool = voicings.filter(v => chords.some(c => c.root === v.root && c.quality === v.quality) && matchesTags(v, spec.tags));
    label = `The chords of ${keyName(key)} major${tagLabel(spec.tags)}`;
  } else {
    pool = voicings.filter(v => matchesTags(v, spec.tags) && (spec.key == null || v.root === spec.key));
    label = `${spec.tags.length ? spec.tags.join(' + ') : 'All voicings'}${spec.key == null ? '' : ` on ${keyName(spec.key)}`}`;
  }
  shuffle(pool);
  if (spec.limit > 0) pool = pool.slice(0, spec.limit);
  return {
    steps: pool.map(v => ({ voicing: v, context_type: 'isolated', context_id: null, symbol: null, group: null })),
    label,
    setKey: `${spec.source}:${spec.key ?? 'all'}:${tagKey}:${spec.mode}:${spec.limit}`,
    context_type: 'isolated',
    skipped,
  };
}
