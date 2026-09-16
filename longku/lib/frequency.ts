// Frequency tiers and usage coverage.
//
// Chengyu frequency in this corpus is steeply Zipfian: 624 words account for
// half of all recorded usage, 2,750 for 90%, and the remaining 24,468 for one
// percent between them. Counting words against the 30,292-entry corpus is
// therefore a bad progress measure — a serious bank still reads as 2%.
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
 * Cuts chosen so each tier lands on a round share of usage:
 * core ≈ the first half, common ≈ up to 90%, uncommon ≈ up to 99%.
 */
export const TIERS: TierSpec[] = [
  { id: "core", label: "core", min: 4000, blurb: "624 words — over half of all chengyu usage" },
  { id: "common", label: "common", min: 700, blurb: "up to 90% of usage" },
  { id: "uncommon", label: "uncommon", min: 80, blurb: "up to 99% of usage" },
  { id: "rare", label: "rare", min: 0, blurb: "the long tail — 1% of usage between 24,000 words" },
];

export function tierOf(f: number | undefined): Tier {
  if (f === undefined || f === null) return "rare";
  for (const t of TIERS) if (f >= t.min) return t.id;
  return "rare";
}

export function tierSpec(id: Tier): TierSpec {
  return TIERS.find((t) => t.id === id) ?? TIERS[TIERS.length - 1];
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

/** Total corpus frequency mass per tier — the denominators for tier coverage. */
export type TierMass = Record<Tier, number>;
/** Corpus word count per tier — the denominator for each bar's mine/corpus. */
export type TierCount = Record<Tier, number>;

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
  bank: Array<{ f?: number }>,
  tierMass: TierMass,
  tierWords: TierCount,
): TierCoverage[] {
  const total = TIERS.reduce((n, t) => n + (tierMass[t.id] ?? 0), 0);
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
  return TIERS.map((t) => {
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
export function tierCounts(bank: Array<{ f?: number }>): Record<Tier, number> {
  const out: Record<Tier, number> = { core: 0, common: 0, uncommon: 0, rare: 0 };
  for (const e of bank) out[tierOf(e.f)] += 1;
  return out;
}
