// 龙库 as plain data, for the owner's agent (Muse) through /api/longku/read.
// Server-only: it reads the corpus files.
//
// Deliberately unopinionated: it reports the bank, the facts per syllable and
// the corpus words on any syllables asked for, the same measurements the app
// shows (chains, dead ends, playability, how often a syllable comes up), and
// leaves what to learn next to whoever reads it. Nothing is ranked by
// usefulness; syllables are alphabetical and corpus words by frequency, the
// corpus's own order.

import { bySyllable, entries, lookupWord, syllables } from "./data";
import { minChains } from "./chains";
import { freqTierOf } from "./frequency";
import { showSyl, stripTones } from "./pinyin";
import type { BankEntry } from "./store";

export interface BankRow {
  w: string;
  fs: string;
  ls: string | null;
  f: number | null;
  recalls: number;
  strength: number;
  misses: number;
  added: string;
  last_recalled: string | null;
  due: string | null;
}

let _ending: { count: Record<string, number>; share: Record<string, number> } | null = null;

/** Corpus words ending on each syllable, and the share of usage that does. */
function ending() {
  if (_ending) return _ending;
  const count: Record<string, number> = {};
  const mass: Record<string, number> = {};
  let total = 0;
  for (const e of entries()) {
    if (!e.ls) continue;
    count[e.ls] = (count[e.ls] ?? 0) + 1;
    mass[e.ls] = (mass[e.ls] ?? 0) + e.f;
    total += e.f;
  }
  const share: Record<string, number> = {};
  for (const [syl, m] of Object.entries(mass)) share[syl] = total > 0 ? m / total : 0;
  _ending = { count, share };
  return _ending;
}

/** A syllable as given (lü, lv, lǚ, Zhi), as 龙库 keeps it inside: lv, zhi. */
export function syllableKey(given: string): string {
  return stripTones(given.trim().normalize("NFC")).replace(/ü/g, "v");
}

const iso = (t: string | null) => (t ? new Date(t).toISOString() : null);

/**
 * Everything about the bank: its words, the facts per syllable and the
 * bank's measures. With `corpusOn`, the corpus words starting on those
 * syllables too, up to `per` each, marked held or removed, with how the
 * chain count would change if each were added.
 */
export function readLongku(
  rows: BankRow[],
  excluded: ReadonlySet<string>,
  opts: { corpusOn: string[]; per: number },
) {
  const buckets = bySyllable();
  const all = entries();
  const end = ending();

  const edges = rows.map((r) => ({ w: r.w, fs: r.fs, ls: r.ls }) as BankEntry);
  const chains = minChains(edges);
  const starts = new Map<string, number>();
  const arrive = new Map<string, number>();
  for (const r of rows) {
    starts.set(r.fs, (starts.get(r.fs) ?? 0) + 1);
    if (r.ls) arrive.set(r.ls, (arrive.get(r.ls) ?? 0) + 1);
  }
  const held = new Set(rows.map((r) => r.w));
  let playability = 0;
  for (const syl of starts.keys()) playability += end.share[syl] ?? 0;

  const bank = rows.map((r) => {
    const c = lookupWord(r.w);
    const f = r.f ?? c?.f ?? null;
    return {
      word: r.w,
      pinyin: c?.p ?? null,
      gloss: c?.e ?? null,
      starts: showSyl(r.fs),
      ends: showSyl(r.ls),
      f,
      tier: f === null ? null : freqTierOf(f),
      recalls: r.recalls,
      misses: r.misses ?? 0,
      strength: r.strength ?? 0,
      added: iso(r.added),
      lastRecalled: iso(r.last_recalled),
      due: iso(r.due),
    };
  });

  const perSyllable = syllables().map((s) => ({
    syllable: showSyl(s),
    yoursStart: starts.get(s) ?? 0,
    yoursEnd: arrive.get(s) ?? 0,
    corpusStart: buckets[s]?.length ?? 0,
    corpusEnd: end.count[s] ?? 0,
    comesUp: end.share[s] ?? 0,
  }));

  const corpus: Record<string, unknown[]> = {};
  for (const given of opts.corpusOn) {
    const s = syllableKey(given);
    corpus[showSyl(s)] = (buckets[s] ?? []).slice(0, opts.per).map((idx) => {
      const e = all[idx];
      const isHeld = held.has(e.w);
      return {
        word: e.w,
        pinyin: e.p,
        gloss: e.e,
        ends: showSyl(e.ls),
        f: e.f,
        tier: freqTierOf(e.f),
        held: isHeld,
        removed: excluded.has(e.w),
        // Fewer chains is negative. A held word is already counted.
        chainChange: isHeld ? 0 : minChains([...edges, { w: e.w, fs: e.fs, ls: e.ls } as BankEntry]) - chains,
      };
    });
  }

  return {
    measures: {
      words: rows.length,
      chains,
      playability,
      startSyllables: starts.size,
      deadEnds: [...arrive.keys()].filter((s) => !starts.has(s)).sort().map((s) => showSyl(s)),
    },
    bank,
    removed: [...excluded].sort(),
    syllables: perSyllable,
    ...(opts.corpusOn.length > 0 ? { corpus } : {}),
  };
}
