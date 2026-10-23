// Look up's fuzzy English (the owner's ask: "smart and fuzzy, unlike a normal
// dictionary"). Typed English finds words through their English keys
// (lib/synonyms.ts): forgiving word forms (delayed, delays, delaying → delay)
// and typos (dleay → delay), then one hop through meaning (a word reached
// directly brings the others sharing one of its first keys: delay → 延误,
// whose "hold up" brings 耽误). Words matching more of what was typed come
// first. Pure: the index is built by the caller.

/** One English key of a corpus word, as kept in chongfuxi_gloss_key. */
export interface KeyRow {
  key: string;
  word: string;
  /** How early in the word's entry the sense giving it comes (0 first). */
  rank: number;
}

/** A word reached, with how strongly and through which keys. */
export interface FuzzyHit {
  word: string;
  score: number;
  /** The keys it was reached through. */
  via: string[];
}

/** Score for a key matched directly, exactly or as part of a phrase; and for a word one hop away. */
const DIRECT_EXACT = 3;
const DIRECT_PART = 2;
const NEIGHBOUR = 1;
/** A typo costs this much of a match. */
const TYPO_COST = 0.5;
/** Only keys this early in a word's entry lead on to neighbours, and only keys shared by this few words. */
const HOP_RANK = 1;
const HOP_GROUP = 25;

/** An English word cut to a stem shared by its forms: delayed, delays, delaying → delay; stopped → stop; hoped, hope → hop. */
export function stem(word: string): string {
  let w = word.toLowerCase();
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && /ie[sd]$/.test(w)) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 4 && /(sh|ch|x|ss|z)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && /[^su]s$/.test(w)) w = w.slice(0, -1);
  if (w.length > 3 && /([b-df-hj-np-tv-z])\1$/.test(w)) w = w.slice(0, -1);
  if (w.length > 4 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

/** Edits allowed for a typo in a word this long: none when short. */
export const typosAllowed = (n: number) => (n <= 3 ? 0 : n <= 6 ? 1 : 2);

/** Edit distance, a swap of neighbours counting as one; past `max` it stops early and returns max + 1. */
export function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let low = i;
    for (let j = 1; j <= b.length; j++) {
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      cur.push(d);
      low = Math.min(low, d);
    }
    if (low > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

/** The keys' words, stemmed, to the keys holding each: built once per index. */
export interface KeyIndex {
  rows: KeyRow[];
  /** Stem of a word in a key → the keys it is in. */
  byStem: Map<string, Set<string>>;
  /** Key → its words (the corpus words having it). */
  byKey: Map<string, KeyRow[]>;
  /** Word → its keys. */
  byWord: Map<string, KeyRow[]>;
}

export function buildIndex(rows: KeyRow[]): KeyIndex {
  const byStem = new Map<string, Set<string>>();
  const byKey = new Map<string, KeyRow[]>();
  const byWord = new Map<string, KeyRow[]>();
  for (const r of rows) {
    (byKey.get(r.key) ?? byKey.set(r.key, []).get(r.key)!).push(r);
    (byWord.get(r.word) ?? byWord.set(r.word, []).get(r.word)!).push(r);
    for (const w of r.key.split(" ")) {
      const s = stem(w);
      (byStem.get(s) ?? byStem.set(s, new Set()).get(s)!).add(r.key);
    }
  }
  return { rows, byStem, byKey, byWord };
}

/** The stems in the index a typed stem stands for: itself, else those a typo away (the closest only). */
export function stemsFor(index: KeyIndex, s: string): Array<{ stem: string; typo: boolean }> {
  if (index.byStem.has(s)) return [{ stem: s, typo: false }];
  const max = typosAllowed(s.length);
  if (!max) return [];
  let best = max + 1;
  let found: string[] = [];
  for (const k of index.byStem.keys()) {
    const d = distance(s, k, Math.min(max, best));
    if (d < best) {
      best = d;
      found = [k];
    } else if (d === best) found.push(k);
  }
  return best <= max ? found.slice(0, 3).map((stem) => ({ stem, typo: true })) : [];
}

/**
 * Words for typed English terms (already stemmed): for each term, the words
 * with a key holding it (more for the key being just that word, an earlier
 * sense, no typo), then their neighbours through their first keys; summed
 * over the terms, so a word matching more of them comes first.
 */
export function fuzzyWords(index: KeyIndex, terms: string[], limit = 30): FuzzyHit[] {
  const total = new Map<string, { score: number; via: Set<string> }>();
  for (const term of terms) {
    const best = new Map<string, { score: number; via: string }>();
    const take = (word: string, score: number, via: string) => {
      const had = best.get(word);
      if (!had || had.score < score) best.set(word, { score, via });
    };
    for (const { stem: s, typo } of stemsFor(index, term)) {
      for (const key of index.byStem.get(s) ?? []) {
        const exact = key.split(" ").length === 1;
        for (const r of index.byKey.get(key) ?? []) {
          take(r.word, (exact ? DIRECT_EXACT : DIRECT_PART) - (typo ? TYPO_COST : 0) - Math.min(r.rank, 3) * 0.1, key);
        }
      }
    }
    // One hop through meaning: the first keys of the words reached, to the other words sharing them.
    const direct = [...best.entries()].filter(([, v]) => v.score >= DIRECT_PART - TYPO_COST - 0.3);
    for (const [word] of direct) {
      for (const k of index.byWord.get(word) ?? []) {
        if (k.rank > HOP_RANK) continue;
        const sharing = index.byKey.get(k.key) ?? [];
        if (sharing.length > HOP_GROUP) continue;
        for (const r of sharing) if (r.word !== word && r.rank <= HOP_RANK) take(r.word, NEIGHBOUR, k.key);
      }
    }
    for (const [word, v] of best) {
      const t = total.get(word) ?? { score: 0, via: new Set<string>() };
      t.score += v.score;
      t.via.add(v.via);
      total.set(word, t);
    }
  }
  return [...total.entries()]
    .map(([word, v]) => ({ word, score: Math.round(v.score * 100) / 100, via: [...v.via] }))
    .sort((a, b) => b.score - a.score || a.word.length - b.word.length || a.word.localeCompare(b.word))
    .slice(0, limit);
}
