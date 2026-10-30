// Which syllables to learn a chengyu on next, for the owner's agent (Muse)
// through /api/longku/next. Server-only: it reads the corpus files.
//
// A syllable is new when nothing in the bank starts on it. Learning one word
// that starts there buys two things the app already measures:
//
//   playability — the share of usage ending on the syllable (comesUp) is the
//                 chance an opponent's chengyu lands you there, and holding a
//                 word on it adds exactly that to playability
//   chains      — if words of yours already end there, it's a dead end, and a
//                 word out of it that lands where you can go on merges two
//                 chains into one (see chains.ts and the learn route)
//
// So dead ends come first, each group by how often it comes up. Within a
// syllable the words go by tier first, since a core word is worth meeting
// whatever it joins, then by chains saved, then by frequency.

import { bySyllable, entries, lookupWord, syllables } from "./data";
import { minChains } from "./chains";
import { freqTierOf, type Tier } from "./frequency";
import { showSyl } from "./pinyin";
import type { BankEntry } from "./store";

export interface NextWord {
  word: string;
  pinyin: string;
  gloss: string;
  tier: Tier;
  /** Corpus frequency (wordfreq, per billion). */
  f: number;
  /** Its last syllable, as shown. */
  ends: string;
  /** Whether a word of yours starts on that last syllable, so a chain can go on. */
  endsOnYours: boolean;
  /** Chains the bank would need fewer of with this word in it. */
  saves: number;
}

export interface NextSyllable {
  syllable: string;
  /** Share of chengyu usage ending here: what playability rises by. */
  comesUp: number;
  /** Words of yours end here and none start here, so your chains die here. */
  deadEnd: boolean;
  /** Your words ending here. */
  arrive: number;
  /** Corpus chengyu starting here. */
  starts: number;
  why: string;
  chengyu: NextWord[];
}

const TIER_RANK: Record<Tier, number> = { core: 0, common: 1, uncommon: 2, rare: 3 };
/** How deep into a syllable's bucket (by frequency) to look for its words. */
const BUCKET_DEPTH = 30;

let _comesUp: Record<string, number> | null = null;

/** Share of usage ending on each syllable, as the app's wall computes it. */
function comesUp(): Record<string, number> {
  if (_comesUp) return _comesUp;
  const mass: Record<string, number> = {};
  let total = 0;
  for (const e of entries()) {
    if (!e.ls) continue;
    mass[e.ls] = (mass[e.ls] ?? 0) + e.f;
    total += e.f;
  }
  _comesUp = {};
  for (const [syl, m] of Object.entries(mass)) _comesUp[syl] = total > 0 ? m / total : 0;
  return _comesUp;
}

const pct = (share: number) => `${(share * 100).toFixed(share >= 0.01 ? 1 : 2)}%`;

/**
 * The new syllables worth a word next, with the words to learn on each.
 *
 * `bank` is the owner's 龙库 bank; `excluded` the words they took out of it,
 * never offered back. A word read the same as one already held is an
 * orthographic variant of it (莫名其妙 / 莫明其妙) and is skipped too.
 */
export function nextSyllables(
  bank: Array<{ w: string; fs: string; ls: string | null }>,
  excluded: ReadonlySet<string>,
  opts: { limit: number; per: number },
) {
  const all = entries();
  const buckets = bySyllable();
  const up = comesUp();

  const starts = new Set(bank.map((e) => e.fs));
  const arrive = new Map<string, number>();
  for (const e of bank) if (e.ls) arrive.set(e.ls, (arrive.get(e.ls) ?? 0) + 1);
  const have = new Set(bank.map((e) => e.w));
  const readings = new Set(bank.map((e) => lookupWord(e.w)?.p).filter(Boolean));

  const edges = bank as BankEntry[];
  const chains = minChains(edges);
  let playability = 0;
  for (const syl of starts) playability += up[syl] ?? 0;

  const deadEnds = [...arrive.keys()].filter((s) => !starts.has(s));

  const open = syllables()
    .filter((s) => !starts.has(s) && (buckets[s]?.length ?? 0) > 0)
    .map((s) => ({ syl: s, deadEnd: arrive.has(s), up: up[s] ?? 0 }))
    .sort((a, b) => Number(b.deadEnd) - Number(a.deadEnd) || b.up - a.up);

  const out: NextSyllable[] = [];
  for (const { syl, deadEnd, up: share } of open) {
    if (out.length >= opts.limit) break;
    const seen = new Set<string>();
    const words: NextWord[] = [];
    for (const idx of (buckets[syl] ?? []).slice(0, BUCKET_DEPTH)) {
      const e = all[idx];
      if (have.has(e.w) || excluded.has(e.w) || readings.has(e.p) || seen.has(e.p)) continue;
      seen.add(e.p);
      const probe = { w: e.w, fs: e.fs, ls: e.ls } as BankEntry;
      words.push({
        word: e.w,
        pinyin: e.p,
        gloss: e.e,
        tier: freqTierOf(e.f),
        f: e.f,
        ends: showSyl(e.ls),
        endsOnYours: starts.has(e.ls),
        saves: chains - minChains([...edges, probe]),
      });
    }
    if (words.length === 0) continue;
    words.sort(
      (a, b) =>
        TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
        b.saves - a.saves ||
        Number(b.endsOnYours) - Number(a.endsOnYours) ||
        b.f - a.f,
    );
    const n = arrive.get(syl) ?? 0;
    out.push({
      syllable: showSyl(syl),
      comesUp: share,
      deadEnd,
      arrive: n,
      starts: buckets[syl]?.length ?? 0,
      why: deadEnd
        ? `${n === 1 ? "one of your words ends" : `${n} of your words end`} on ${showSyl(syl)} and none start there, so chains die there; it also comes up ${pct(share)} of the time`
        : `nothing of yours starts on ${showSyl(syl)}; it comes up ${pct(share)} of the time`,
      chengyu: words.slice(0, opts.per),
    });
  }

  return {
    bank: {
      words: bank.length,
      chains,
      startsOn: starts.size,
      playability,
      deadEnds: deadEnds.map((s) => showSyl(s)).sort(),
    },
    syllables: out,
  };
}
