// Frequency tiers and usage coverage.
//
// Chengyu frequency is steeply Zipfian: 572 words account for half of all
// recorded usage, 3,500 for 93%, and the 24,500 too rare to be measured for
// under one percent between them. Counting words against the 31,600-entry
// corpus is therefore a bad progress measure — a serious bank still reads as 2%.
//
// Frequencies come from wordfreq (see longku/scripts/build-frequency.py), which
// blends subtitles, web text and news. The previous source counted newspapers
// only and left three quarters of the corpus unmeasured, which put 不好意思 in
// the rare tier. The first wordfreq build then read idioms through its word
// splitter, which filed 画龙点睛 as rare and 文章经济 as core; each is now looked
// up whole.
//
// Token coverage is the honest one: of all the times a chengyu gets used, what
// share would you recognize? It answers a real question, and it weights effort
// the way the language does — learning 画蛇添足 is worth more than learning a
// variant nobody writes.

export type Tier = "core" | "common" | "uncommon" | "rare";

export interface TierSpec {
  id: Tier;
  label: string;
  /** Inclusive lower bound on corpus frequency. */
  min: number;
  /** What holding this tier buys you, for tooltips. */
  blurb: string;
}

/**
 * Cuts at round decades of frequency per billion, each landing near a round
 * share of usage: core is the first half, common runs to 93%, and uncommon is
 * the rest of what wordfreq measures, to 99%. Its list stops at about 10 per
 * billion, so rare means exactly "too rare to be measured". Re-derive these
 * whenever the frequency source changes — they are properties of that
 * distribution, not constants.
 */
export const FREQUENCY_TIERS: TierSpec[] = [
  { id: "core", label: "core", min: 1000, blurb: "572 words — about half of all chengyu usage" },
  { id: "common", label: "common", min: 100, blurb: "up to 93% of usage" },
  { id: "uncommon", label: "uncommon", min: 10, blurb: "up to 99% of usage — the rarest still measured" },
  {
    id: "rare",
    label: "rare",
    min: 0,
    blurb: "the long tail — 24,500 words too rare to be measured, under 1% of usage between them",
  },
];

/** All tiers, for labelling. */
export const TIERS: TierSpec[] = FREQUENCY_TIERS;

/** A word's tier. One with no frequency yet (still being hydrated) counts as rare until it has one. */
export function tierOf(f: number | undefined): Tier {
  if (f === undefined || f === null) return "rare";
  return freqTierOf(f);
}

export function tierSpec(id: Tier): TierSpec {
  return TIERS.find((t) => t.id === id) ?? FREQUENCY_TIERS[FREQUENCY_TIERS.length - 1];
}

/**
 * Share of total chengyu usage the bank covers.
 *
 * Words added before frequencies were stored contribute nothing rather than
 * guessing — they simply don't move the bar until a reading is backfilled.
 */
export function usageCoverage(
  bank: Array<{ f?: number }>,
  corpusMass: number,
): { mass: number; share: number } {
  const mass = bank.reduce((n, e) => n + (e.f ?? 0), 0);
  return { mass, share: corpusMass > 0 ? Math.min(1, mass / corpusMass) : 0 };
}

/**
 * Playability: the chance you can reply when someone plays a chengyu — the
 * share of usage that ends on a syllable at least one of your words starts
 * with. Usage is corpus frequency, the same wordfreq figures as the tiers.
 *
 * Weighted by usage, not by word, because an opponent says 一模一样 far more
 * often than a variant nobody writes, and common chengyu end on a few
 * syllables: yi, shi, zhi, ji and li close about a sixth of all usage between
 * them. So this runs well ahead of the share of syllables held, and holding
 * one word on yi is worth more than holding words on a dozen rare endings.
 *
 * One move only. Whether your reply lands somewhere you can answer again is
 * the chain's question, not this one.
 */
/**
 * How often each syllable comes up: the share of usage ending on it, so the
 * chance that a chengyu someone plays lands you there. Playability is these
 * summed over the syllables you start on.
 *
 * A sum over every chengyu ending there, not just the commonest, though in
 * practice the commonest usually carries most of it.
 */
export function comesUpBySyllable(endingMass: Record<string, number>): Record<string, number> {
  let total = 0;
  for (const m of Object.values(endingMass)) total += m;
  const out: Record<string, number> = {};
  for (const [syl, m] of Object.entries(endingMass)) out[syl] = total > 0 ? m / total : 0;
  return out;
}

/** A small share as a percentage, keeping two significant places down to 0.01%. */
export function formatShare(share: number): string {
  const p = share * 100;
  if (p === 0) return "0%";
  if (p < 0.01) return "<0.01%";
  return `${p >= 10 ? p.toFixed(0) : p >= 1 ? p.toFixed(1) : p.toFixed(2)}%`;
}

export function playabilityOf(
  bank: Array<{ fs: string }>,
  endingMass: Record<string, number>,
): number {
  let total = 0;
  for (const m of Object.values(endingMass)) total += m;
  if (total <= 0) return 0;
  let mine = 0;
  for (const syl of new Set(bank.map((e) => e.fs))) mine += endingMass[syl] ?? 0;
  return Math.min(1, mine / total);
}

/** A tier a corpus word can hold: every word in 龙库 is in the corpus. */
export type FreqTier = Tier;

/** Which frequency band a known frequency falls in. */
export function freqTierOf(f: number): FreqTier {
  for (const t of FREQUENCY_TIERS) if (f >= t.min) return t.id as FreqTier;
  return "rare";
}

/** Total corpus frequency mass per tier — the denominators for tier coverage. */
export type TierMass = Record<FreqTier, number>;
/** Corpus word count per tier — the denominator for each bar's mine/corpus. */
export type TierCount = Record<FreqTier, number>;

export interface TierCoverage {
  id: Tier;
  label: string;
  blurb: string;
  /** Bank words in this tier. */
  words: number;
  /** Corpus words in this tier. */
  corpusWords: number;
  /** Share of this tier's usage the bank covers, 0..1. */
  share: number;
  /** This tier's share of all chengyu usage, 0..1 — how much it's worth. */
  weight: number;
}

/**
 * Coverage within each tier, so progress reads as "how far into the words that
 * matter" rather than one flat number. Core moves fast and is worth the most;
 * rare barely moves and is worth under 1% of usage between 24,500 words.
 */
export function coverageByTier(
  bank: Array<{ f?: number }>,
  tierMass: TierMass,
  tierWords: TierCount,
): TierCoverage[] {
  const total = FREQUENCY_TIERS.reduce((n, t) => n + (tierMass[t.id] ?? 0), 0);
  const held: Record<Tier, { mass: number; words: number }> = {
    core: { mass: 0, words: 0 },
    common: { mass: 0, words: 0 },
    uncommon: { mass: 0, words: 0 },
    rare: { mass: 0, words: 0 },
  };
  for (const e of bank) {
    const id = tierOf(e.f);
    held[id].mass += e.f ?? 0;
    held[id].words += 1;
  }
  return FREQUENCY_TIERS.map((t) => {
    const denom = tierMass[t.id] ?? 0;
    return {
      id: t.id,
      label: t.label,
      blurb: t.blurb,
      words: held[t.id].words,
      corpusWords: tierWords[t.id] ?? 0,
      share: denom > 0 ? Math.min(1, held[t.id].mass / denom) : 0,
      weight: total > 0 ? denom / total : 0,
    };
  });
}

/** Count of bank words per tier. */
export function tierCounts(
  bank: Array<{ f?: number }>,
): Record<Tier, number> {
  const out: Record<Tier, number> = {
    core: 0,
    common: 0,
    uncommon: 0,
    rare: 0,
  };
  for (const e of bank) out[tierOf(e.f)] += 1;
  return out;
}
