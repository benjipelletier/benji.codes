// Server-side loaders. Read the build artifacts in longku/data/.
// Runtime caches by module scope so each cold function loads once.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface ChengyuEntry {
  /** word */
  w: string;
  /** pinyin with tone marks */
  p: string;
  /** frequency from JioNLP corpus */
  f: number;
  /** first syllable, toneless */
  fs: string;
  /** last syllable, toneless */
  ls: string;
  /** explanation */
  e: string;
  /** derivation */
  d: string;
  /** example */
  x: string;
}

let _entries: ChengyuEntry[] | null = null;
let _bySyllable: Record<string, number[]> | null = null;
let _syllables: string[] | null = null;
let _byWord: Map<string, number> | null = null;

function dataDir(): string {
  return join(process.cwd(), "longku", "data");
}

/** Chengyus at or above this corpus frequency count as "common" for cell stats. */
export const COMMON_FREQ_THRESHOLD = 100;

export function entries(): ChengyuEntry[] {
  if (!_entries) {
    _entries = JSON.parse(readFileSync(join(dataDir(), "chengyu.json"), "utf8"));
  }
  return _entries!;
}

export function bySyllable(): Record<string, number[]> {
  if (!_bySyllable) {
    _bySyllable = JSON.parse(readFileSync(join(dataDir(), "by-first-syllable.json"), "utf8"));
  }
  return _bySyllable!;
}

export function syllables(): string[] {
  if (!_syllables) {
    _syllables = JSON.parse(readFileSync(join(dataDir(), "syllables.json"), "utf8"));
  }
  return _syllables!;
}

function byWord(): Map<string, number> {
  if (!_byWord) {
    _byWord = new Map();
    entries().forEach((e, idx) => _byWord!.set(e.w, idx));
  }
  return _byWord!;
}

export function lookupWord(word: string): ChengyuEntry | null {
  const idx = byWord().get(word);
  return idx === undefined ? null : entries()[idx];
}

/** Top N chengyus for a syllable, ranked by frequency. */
export function topForSyllable(syl: string, limit = 50): ChengyuEntry[] {
  const ids = bySyllable()[syl] ?? [];
  const all = entries();
  return ids.slice(0, limit).map((i) => all[i]);
}

/** Count chengyus per syllable that meet the COMMON_FREQ_THRESHOLD. */
let _commonCounts: Record<string, number> | null = null;
export function commonCounts(): Record<string, number> {
  if (_commonCounts) return _commonCounts;
  const buckets = bySyllable();
  const all = entries();
  const out: Record<string, number> = {};
  for (const [syl, ids] of Object.entries(buckets)) {
    let c = 0;
    for (const i of ids) {
      if (all[i].f >= COMMON_FREQ_THRESHOLD) c++;
      else break; // ids are sorted by freq desc — short-circuit
    }
    out[syl] = c;
  }
  _commonCounts = out;
  return out;
}

/**
 * First-character reading table, derived from the corpus itself.
 *
 * The corpus is missing some real chengyus (不入虎穴焉得虎子 and 张三李四 among
 * them), and a user's own list will always outrun a fixed word list. To file
 * such a word we only need its *first* syllable, and the 30k entries we do have
 * supply readings for ~3,100 leading characters. Readings are counted rather
 * than merely collected, so a polyphonic character resolves to its commonest
 * reading and we can tell when that choice was contested.
 */
let _firstCharReadings: Map<string, Array<[string, number]>> | null = null;
let _lastCharReadings: Map<string, Array<[string, number]>> | null = null;

function tallyReadings(
  charOf: (e: ChengyuEntry) => string,
  sylOf: (e: ChengyuEntry) => string,
): Map<string, Array<[string, number]>> {
  const tally = new Map<string, Map<string, number>>();
  for (const e of entries()) {
    const ch = charOf(e);
    if (!ch) continue;
    let m = tally.get(ch);
    if (!m) {
      m = new Map();
      tally.set(ch, m);
    }
    const syl = sylOf(e);
    m.set(syl, (m.get(syl) ?? 0) + 1);
  }
  const out = new Map<string, Array<[string, number]>>();
  for (const [ch, m] of tally) {
    out.set(ch, [...m.entries()].sort((a, b) => b[1] - a[1]));
  }
  return out;
}

function firstCharReadings(): Map<string, Array<[string, number]>> {
  if (!_firstCharReadings) {
    _firstCharReadings = tallyReadings((e) => e.w[0], (e) => e.fs);
  }
  return _firstCharReadings;
}

function lastCharReadings(): Map<string, Array<[string, number]>> {
  if (!_lastCharReadings) {
    _lastCharReadings = tallyReadings((e) => e.w[e.w.length - 1], (e) => e.ls);
  }
  return _lastCharReadings;
}

/**
 * Readings for words outside the corpus, from CC-CEDICT.
 *
 * Consulted before the character tables below, because a stated reading beats
 * an inferred one: the majority vote filed 重色轻友 under chong, since 61 corpus
 * entries read 重 as chóng against 15 as zhòng, and this idiom is one of the 15.
 */
let _readings: Map<string, [string, string]> | null = null;

function readings(): Map<string, [string, string]> {
  if (_readings) return _readings;
  const m = new Map<string, [string, string]>();
  try {
    const raw = readFileSync(join(dataDir(), "readings.txt"), "utf8");
    for (const line of raw.split("\n")) {
      const [w, fs, ls] = line.split("\t");
      if (w && fs && ls) m.set(w, [fs, ls.trim()]);
    }
  } catch {
    // Optional artifact — without it the character tables still answer.
  }
  _readings = m;
  return m;
}

export interface SyllableGuess {
  /** Best-guess starting syllable. */
  fs: string;
  /** True when the leading character has more than one attested reading. */
  ambiguous: boolean;
  /** Runner-up readings, commonest first. Empty unless ambiguous. */
  alternatives: string[];
}

function guessFrom(
  table: Map<string, Array<[string, number]>>,
  ch: string,
): SyllableGuess | null {
  const readings = table.get(ch);
  if (!readings || readings.length === 0) return null;
  return {
    fs: readings[0][0],
    ambiguous: readings.length > 1,
    alternatives: readings.slice(1).map(([s]) => s),
  };
}

/** Which bucket an off-corpus word belongs in — stated reading first, else inferred. */
export function guessFirstSyllable(word: string): SyllableGuess | null {
  const known = readings().get(word);
  if (known) return { fs: known[0], ambiguous: false, alternatives: [] };
  return guessFrom(firstCharReadings(), word[0]);
}

/**
 * Guess the syllable an off-corpus word *ends* on, from its last character.
 * Chaining needs this: without it a word the corpus lacks can start a chain
 * but never continue one.
 */
export function guessLastSyllable(word: string): SyllableGuess | null {
  const known = readings().get(word);
  if (known) return { fs: known[1], ambiguous: false, alternatives: [] };
  return guessFrom(lastCharReadings(), word[word.length - 1]);
}

/* ---------- Search: by characters or by pinyin ---------- */

import { stripTones } from "./pinyin";

interface SearchRow {
  /** Index into entries(). */
  i: number;
  /** Toneless pinyin, no spaces: "yixinyiyi". */
  flat: string;
  /** Syllable initials: "yxyy". */
  initials: string;
}

let _searchRows: SearchRow[] | null = null;

function searchRows(): SearchRow[] {
  if (_searchRows) return _searchRows;
  _searchRows = entries().map((e, i) => {
    const sylls = (e.p ?? "").trim().split(/\s+/).map(stripTones).filter(Boolean);
    return {
      i,
      flat: sylls.join(""),
      initials: sylls.map((s) => s[0] ?? "").join(""),
    };
  });
  return _searchRows;
}

const HAS_HAN = /[㐀-䶿一-鿿]/;

export interface SearchHit extends ChengyuEntry {
  /** Why it matched, for ordering and for showing the user. */
  via: "chars" | "pinyin" | "initials";
  /**
   * Alternate written forms of the same idiom, rarer than this one.
   * Chinese idiom dictionaries list orthographic variants as separate
   * headwords — 小题大做 / 小题大作, 莫名其妙 / 莫明其妙 — and this corpus has
   * about 1,100 such groups. Showing them as sibling rows reads as a bug, so
   * the dominant spelling carries the others.
   */
  variants?: string[];
}

/** Same reading, same length, differing in exactly one character. */
function isVariantOf(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i] && ++diff > 1) return false;
  }
  return diff === 1;
}

/**
 * Fold orthographic variants into their dominant spelling.
 *
 * Grouped by reading first so this stays linear in the number of hits — a
 * pairwise scan was O(n²) and, run over every match before the limit was
 * applied, turned a one-letter query into a 58-second request.
 *
 * The form the user typed always wins, so searching the rare spelling still
 * finds it; otherwise corpus frequency decides, which is decisive here — the
 * standard form typically outweighs its variant by orders of magnitude.
 */
function collapseVariants(hits: SearchHit[], query: string): SearchHit[] {
  const byReading = new Map<string, SearchHit[]>();
  for (const h of hits) {
    const g = byReading.get(h.p);
    if (g) g.push(h);
    else byReading.set(h.p, [h]);
  }
  const claimed = new Set<string>();
  const primaryOf = new Map<string, SearchHit>();
  for (const group of byReading.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      if (claimed.has(group[i].w)) continue;
      const fam = [group[i]];
      for (let j = i + 1; j < group.length; j++) {
        if (!claimed.has(group[j].w) && isVariantOf(group[i].w, group[j].w)) fam.push(group[j]);
      }
      if (fam.length < 2) continue;
      const exact = fam.find((g) => g.w === query);
      const primary = exact ?? fam.reduce((best, g) => (g.f > best.f ? g : best), fam[0]);
      for (const g of fam) claimed.add(g.w);
      primaryOf.set(primary.w, {
        ...primary,
        variants: fam.filter((g) => g.w !== primary.w).map((g) => g.w),
      });
    }
  }
  if (primaryOf.size === 0 && claimed.size === 0) return hits;
  const out: SearchHit[] = [];
  for (const h of hits) {
    const folded = primaryOf.get(h.w);
    if (folded) out.push(folded);
    else if (!claimed.has(h.w)) out.push(h);
  }
  return out;
}

/**
 * How many matches to gather before ranking and folding.
 *
 * `entries()` is ordered by corpus frequency descending, so scanning in order
 * and stopping here yields the most frequent matches without a sort — and
 * keeps a one-letter query (3,319 hits for "y") from materializing thousands
 * of objects per keystroke.
 */
const SEARCH_WINDOW = 200;

/**
 * Find corpus entries by Han characters or by romanization.
 *
 * Pinyin is matched tone-insensitively and space-insensitively, so "yixin",
 * "yi xin" and "yīxīn" all reach 一心一意. Initials are matched too ("yxyy"),
 * which is how people usually half-remember an idiom. Prefix matches rank
 * above interior ones, and within each band the corpus order already puts the
 * common word a learner actually means first.
 */
export function searchCorpus(query: string, limit = 12): SearchHit[] {
  const q = query.trim();
  if (!q) return [];
  const all = entries();

  if (HAS_HAN.test(q)) {
    const starts: number[] = [];
    const contains: number[] = [];
    for (let i = 0; i < all.length; i++) {
      const w = all[i].w;
      if (w.startsWith(q)) starts.push(i);
      else if (w.includes(q)) contains.push(i);
      if (starts.length + contains.length >= SEARCH_WINDOW) break;
    }
    const hits = [...starts, ...contains]
      .slice(0, SEARCH_WINDOW)
      .map((i) => ({ ...all[i], via: "chars" as const }));
    return collapseVariants(hits, q).slice(0, limit);
  }

  const needle = stripTones(q.toLowerCase()).replace(/[^a-z]/g, "");
  if (!needle) return [];

  const rows = searchRows();
  const pinyinPrefix: number[] = [];
  const initialsPrefix: number[] = [];
  const pinyinInner: number[] = [];
  let found = 0;
  for (const r of rows) {
    if (r.flat.startsWith(needle)) pinyinPrefix.push(r.i);
    else if (r.initials.startsWith(needle)) initialsPrefix.push(r.i);
    else if (r.flat.includes(needle)) pinyinInner.push(r.i);
    else continue;
    if (++found >= SEARCH_WINDOW) break;
  }

  const hits: SearchHit[] = [
    ...pinyinPrefix.map((i) => ({ ...all[i], via: "pinyin" as const })),
    ...initialsPrefix.map((i) => ({ ...all[i], via: "initials" as const })),
    ...pinyinInner.map((i) => ({ ...all[i], via: "pinyin" as const })),
  ];
  return collapseVariants(hits, q).slice(0, limit);
}
