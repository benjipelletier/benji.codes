"use client";

import type { BankStats } from "@longku/lib/chains";
import { OFF_CORPUS, type TierCoverage } from "@longku/lib/frequency";

interface Props {
  coverage: number;
  byTier: TierCoverage[];
  offCorpusCount: number;
  stats: BankStats;
  onOpenStats: () => void;
}

/**
 * Tier and coverage progress, on the page rather than behind a click.
 *
 * These are the numbers that change as the bank grows, so they belong where
 * they're seen without asking. Kept to one band: a headline share, then a bar
 * per tier reading mine-over-corpus, and the sheet still holds the detail.
 */
export function ProgressStrip({
  coverage,
  byTier,
  offCorpusCount,
  stats,
  onOpenStats,
}: Props) {
  if (stats.total === 0) return null;
  const pct = coverage > 0 && coverage < 0.001 ? "<0.1" : (coverage * 100).toFixed(coverage < 0.1 ? 1 : 0);

  return (
    <section className="longku-progress-strip" aria-label="Progress">
      <button className="longku-strip-lead" onClick={onOpenStats} title="Full statistics">
        <span className="longku-strip-pct">{pct}%</span>
        <span className="longku-strip-lead-label">of usage</span>
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
