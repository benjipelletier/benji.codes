// Frequency tiers and usage coverage.
//
// Chengyu frequency is steeply Zipfian: 374 words account for half of all
// recorded usage, 3,700 for 90%, and the remaining 15,500 for under one percent
// between them. Counting words against the 30,292-entry corpus is therefore a
// bad progress measure — a serious bank still reads as 2%.
//
// Frequencies come from wordfreq (see longku/scripts/build-frequency.py), which
// blends subtitles, web text and news. The previous source counted newspapers
// only and left three quarters of the corpus unmeasured, which put 不好意思 in
// the rare tier.
//
// Token coverage is the honest one: of all the times a chengyu gets used, what
// share would you recognize? It answers a real question, and it weights effort
// the way the language does — learning 画蛇添足 is worth more than learning a
// variant nobody writes.

export type Tier = "core" | "common" | "uncommon" | "rare" | "offcorpus";

export interface TierSpec {
  id: Tier;
  label: string;
  /** Inclusive lower bound on corpus frequency. */
  min: number;
  /** What holding this tier buys you, for tooltips. */
  blurb: string;
}

/**
 * Cuts chosen so each tier lands on a round share of usage: core ≈ the first
 * half, common ≈ up to 90%, uncommon ≈ up to 99%. Re-derive these whenever the
 * frequency source changes — they are properties of that distribution, not
 * constants.
 */
export const FREQUENCY_TIERS: TierSpec[] = [
  { id: "core", label: "core", min: 1500, blurb: "374 words — nearly half of all chengyu usage" },
  { id: "common", label: "common", min: 60, blurb: "up to 90% of usage" },
  { id: "uncommon", label: "uncommon", min: 5, blurb: "up to 99% of usage" },
  { id: "rare", label: "rare", min: 0, blurb: "the long tail — under 1% of usage across 15,500 words" },
];

/**
 * Words the reference corpus doesn't contain.
 *
 * Not a frequency band — a word with no entry has no frequency at all, and
 * filing it under "rare" was a claim the data doesn't support: 各种各样 is one
 * of the commonest four-character expressions in Mandarin and the corpus
 * simply omits it. Its own tier says "unmeasured", which is the truth.
 */
export const OFF_CORPUS: TierSpec = {
  id: "offcorpus",
  label: "off-corpus",
  min: -1,
  blurb: "not in the reference dictionary, so its frequency is unknown",
};

/** All tiers, for labelling. Coverage bars use FREQUENCY_TIERS only. */
export const TIERS: TierSpec[] = [...FREQUENCY_TIERS, OFF_CORPUS];

export function tierOf(f: number | undefined, offCorpus?: boolean): Tier {
  if (offCorpus) return "offcorpus";
  // No frequency and not flagged: an entry that predates frequency storage, or
  // one still waiting to be hydrated. Treated as off-corpus rather than rare
  // for the same reason — we don't know, so don't assert.
  if (f === undefined || f === null) return "offcorpus";
  return freqTierOf(f);
}

export function tierSpec(id: Tier): TierSpec {
  return TIERS.find((t) => t.id === id) ?? OFF_CORPUS;
}

/**
 * Share of total chengyu usage the bank covers.
 *
 * Words added before frequencies were stored, and off-corpus words that have
 * no frequency at all, contribute nothing rather than guessing — they simply
 * don't move the bar until a reading is backfilled.
 */
export function usageCoverage(
  bank: Array<{ f?: number }>,
  corpusMass: number,
): { mass: number; share: number } {
  const mass = bank.reduce((n, e) => n + (e.f ?? 0), 0);
  return { mass, share: corpusMass > 0 ? Math.min(1, mass / corpusMass) : 0 };
}

/**
 * A tier a corpus word can hold. Off-corpus is excluded by construction: every
 * entry in the reference dictionary has a frequency, so the corpus-side totals
 * can never include it.
 */
export type FreqTier = Exclude<Tier, "offcorpus">;

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
 * rare barely moves and is worth 1% of usage between 24,000 words.
 */
export function coverageByTier(
  bank: Array<{ f?: number; offCorpus?: boolean }>,
  tierMass: TierMass,
  tierWords: TierCount,
): TierCoverage[] {
  const total = FREQUENCY_TIERS.reduce((n, t) => n + (tierMass[t.id] ?? 0), 0);
  const held: Record<Tier, { mass: number; words: number }> = {
    core: { mass: 0, words: 0 },
    common: { mass: 0, words: 0 },
    uncommon: { mass: 0, words: 0 },
    rare: { mass: 0, words: 0 },
    offcorpus: { mass: 0, words: 0 },
  };
  for (const e of bank) {
    const id = tierOf(e.f, e.offCorpus);
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
  bank: Array<{ f?: number; offCorpus?: boolean }>,
): Record<Tier, number> {
  const out: Record<Tier, number> = {
    core: 0,
    common: 0,
    uncommon: 0,
    rare: 0,
    offcorpus: 0,
  };
  for (const e of bank) out[tierOf(e.f, e.offCorpus)] += 1;
  return out;
}
