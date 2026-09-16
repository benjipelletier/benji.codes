"use client";

import { useEffect } from "react";
import type { BankStats } from "@longku/lib/chains";
import { TIERS, type TierCoverage } from "@longku/lib/frequency";

interface Props {
  stats: BankStats;
  coverage: number;
  byTier: TierCoverage[];
  tierCounts: Record<string, number>;
  corpusWords: number;
  onClose: () => void;
  /** Open a syllable's bucket — how a gap gets closed. */
  onPickSyllable: (syl: string) => void;
}

/**
 * Everything the rail condenses, in three groups rather than one pile: what the
 * bank covers, how it chains, and where it breaks. The last of those used to be
 * a bare count, which named a problem without offering a way at it.
 */
export function StatsSheet({
  stats,
  coverage,
  byTier,
  tierCounts,
  corpusWords,
  onClose,
  onPickSyllable,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="longku-modal-overlay" onClick={onClose} role="presentation">
      <div
        className="longku-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Bank statistics"
      >
        <header className="longku-modal-head">
          <h2 className="longku-modal-syllable">统计</h2>
          <button className="longku-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <section className="longku-modal-section">
          <div className="longku-coverage-lead">
            <span className="longku-coverage-pct">
              {(coverage * 100).toFixed(coverage < 0.1 ? 1 : 0)}%
            </span>
            <p className="longku-coverage-note">
              of all chengyu usage you&rsquo;d recognize, from{" "}
              <strong>{stats.total}</strong> words against a corpus of{" "}
              {corpusWords.toLocaleString()}. Each tier is worth what it is used, not
              what it costs to learn — core is 624 words carrying over half the
              language.
            </p>
          </div>
          <div className="longku-coverage-bars">
            {byTier.map((t) => (
              <TierBar key={t.id} t={t} />
            ))}
          </div>
          <div className="longku-tiers" style={{ marginTop: 16 }}>
            {TIERS.map((t) => (
              <span
                key={t.id}
                className={`longku-pill tier-${t.id} ${(tierCounts[t.id] ?? 0) > 0 ? "is-on" : ""}`}
                title={t.blurb}
              >
                <span className="longku-pill-n">{tierCounts[t.id] ?? 0}</span>
                <span className="longku-pill-label">{t.label}</span>
              </span>
            ))}
          </div>
        </section>

        <section className="longku-modal-section">
          <h3 className="longku-subhead">How it chains</h3>
          <div className="longku-sheet-fig">
            <Fig
              label="Chains to exhaust"
              value={String(stats.chains)}
              sub={
                stats.total > 0
                  ? `avg ${(stats.total / Math.max(1, stats.chains)).toFixed(1)} words each — lower is better`
                  : "add words to begin"
              }
            />
            <Fig
              label="Longest chain"
              value={String(stats.longest)}
              sub={
                stats.longest > 0
                  ? "words in one unbroken run, as far as a bounded search found"
                  : "add words to begin"
              }
            />
            <Fig
              label="Loops"
              value={String(stats.cycles)}
              sub="independent cycles — where a chain can double back instead of running out"
            />
            <Fig
              label="Dead ends"
              value={`${stats.deadEnds.length} / ${stats.endings}`}
              sub={
                stats.deadEnds.length > 0
                  ? "of the syllables you can land on, this many have nothing leaving them"
                  : "every ending has a continuation"
              }
            />
          </div>
        </section>

        {stats.deadEnds.length > 0 && (
          <section className="longku-modal-section">
            <h3 className="longku-subhead">Gaps</h3>
            <p className="longku-hint" style={{ marginBottom: 8 }}>
              Chains die on these syllables because nothing in your bank starts with
              them. Learning one word for any of them joins two chains into one —
              click a syllable to open its bucket.
            </p>
            <div className="longku-chips">
              {stats.deadEnds.map((syl) => (
                <button
                  key={syl}
                  type="button"
                  className="longku-chip longku-gap"
                  onClick={() => onPickSyllable(syl)}
                  title={`Open the ${syl} bucket and add a word for it`}
                >
                  {syl}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function TierBar({ t }: { t: TierCoverage }) {
  // Sub-1% shares get a decimal so early progress reads as progress, not "0%".
  const label =
    t.share > 0 && t.share < 0.1
      ? `${(t.share * 100).toFixed(1)}%`
      : `${Math.round(t.share * 100)}%`;
  // Keep a sliver visible once anything is banked, so the bar reads as started.
  const width = t.share > 0 ? Math.max(t.share * 100, 1.5) : 0;
  return (
    <div className={`longku-tierbar tier-${t.id}`} title={`${t.label} — ${t.blurb}`}>
      <div className="longku-tierbar-head">
        <span className="longku-tierbar-label">{t.label}</span>
        <span className="longku-tierbar-pct">{label}</span>
      </div>
      <div className="longku-tierbar-track">
        <div className="longku-tierbar-fill" style={{ width: `${width}%` }} />
      </div>
      <div className="longku-tierbar-sub">
        <span className="longku-tierbar-mine">{t.words}</span>
        <span className="longku-tierbar-slash"> / </span>
        {t.corpusWords.toLocaleString()}
        <br />
        worth {Math.round(t.weight * 100)}% of usage
      </div>
    </div>
  );
}

function Fig({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <div className="longku-stat-label">{label}</div>
      <div className="longku-stat-value">{value}</div>
      <div className="longku-stat-sub">{sub}</div>
    </div>
  );
}
