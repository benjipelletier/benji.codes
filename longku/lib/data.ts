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

/**
 * Chengyus at or above this corpus frequency are common enough to bridge with
 * — the floor of the common tier (see FREQUENCY_TIERS).
 */
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
