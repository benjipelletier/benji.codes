"use client";

import type { BankStats } from "@longku/lib/chains";
import { OFF_CORPUS, type TierCoverage } from "@longku/lib/frequency";

interface Props {
  /** Share of syllables holding at least one word, 0..1 — the headline. */
  syllableShare: number;
  /** Syllables held / syllables that exist, for the note under it. */
  syllablesCovered: number;
  corpusSyllables: number;
  /** Chance a chengyu someone plays ends where one of yours starts — see playabilityOf. */
  playability: number;
  byTier: TierCoverage[];
  offCorpusCount: number;
  stats: BankStats;
  onOpenStats: () => void;
}

/** A share as a percentage: one decimal under 10%, and never a false 0. */
function percent(share: number): string {
  if (share > 0 && share < 0.001) return "<0.1";
  return (share * 100).toFixed(share < 0.1 ? 1 : 0);
}

/**
 * Tier and coverage progress, on the page rather than behind a click.
 *
 * These are the numbers that change as the bank grows, so they belong where
 * they're seen without asking. Kept to one band: a headline share, then a bar
 * per tier reading mine-over-corpus, and the sheet still holds the detail.
 */
export function ProgressStrip({
  syllableShare,
  syllablesCovered,
  corpusSyllables,
  playability,
  byTier,
  offCorpusCount,
  stats,
  onOpenStats,
}: Props) {
  if (stats.total === 0) return null;
  const pct = percent(syllableShare);
  const play = percent(playability);

  return (
    <section className="longku-progress-strip" aria-label="Progress">
      <button
        className="longku-strip-lead"
        onClick={onOpenStats}
        title={`${syllablesCovered} of ${corpusSyllables} syllables have at least one word — full statistics`}
      >
        <span className="longku-strip-pct">{pct}%</span>
        <span className="longku-strip-lead-label">
          {syllablesCovered} / {corpusSyllables} syllables
        </span>
        <span
          className="longku-strip-playability"
          title={`Playability: if someone plays a chengyu — weighted by corpus frequency, so common ones come up as often as they're really used — there's a ${play}% chance it ends on a syllable you hold a word for, so you have a reply.`}
        >
          <span className="longku-strip-playability-n">{play}%</span> playability
        </span>
      </button>

      <div className="longku-strip-tiers">
        {byTier.map((t) => (
          <div className={`longku-strip-tier tier-${t.id}`} key={t.id}>
            <div className="longku-strip-tier-head">
              <span className="longku-strip-tier-label">{t.label}</span>
              <span className="longku-strip-tier-n">
                <span className="longku-strip-mine">{t.words}</span>
                <span className="longku-strip-slash">/</span>
                {t.corpusWords.toLocaleString()}
              </span>
            </div>
            <div className="longku-strip-track">
              <div
                className="longku-strip-fill"
                style={{ width: `${t.share > 0 ? Math.max(t.share * 100, 1.5) : 0}%` }}
              />
            </div>
          </div>
        ))}

        {offCorpusCount > 0 && (
          <div className="longku-strip-tier tier-offcorpus" title={OFF_CORPUS.blurb}>
            <div className="longku-strip-tier-head">
              <span className="longku-strip-tier-label">{OFF_CORPUS.label}</span>
              <span className="longku-strip-tier-n">
                <span className="longku-strip-mine">{offCorpusCount}</span>
              </span>
            </div>
            {/* No bar: an unmeasured word has no share of usage to fill one. */}
            <div className="longku-strip-track is-empty" />
          </div>
        )}
      </div>
    </section>
  );
}
