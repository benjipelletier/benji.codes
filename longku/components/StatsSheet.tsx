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
  corpusSyllables: number;
  syllablesCovered: number;
  onClose: () => void;
}

/** Everything the rail condenses, in full. Reuses the modal overlay pattern. */
export function StatsSheet({
  stats,
  coverage,
  byTier,
  tierCounts,
  corpusWords,
  corpusSyllables,
  syllablesCovered,
  onClose,
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
              of all chengyu usage you&rsquo;d recognize. Each tier is worth what it
              is used, not what it costs to learn — core is 624 words carrying
              over half the language.
            </p>
          </div>
          <div className="longku-coverage-bars">
            {byTier.map((t) => (
              <TierBar key={t.id} t={t} />
            ))}
          </div>
        </section>

        <section className="longku-modal-section">
          <h3 className="longku-subhead">Bank by tier</h3>
          <div className="longku-tiers">
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
          <h3 className="longku-subhead">The bank</h3>
          <div className="longku-sheet-fig">
            <Fig
              label="Word bank"
              value={`${stats.total} / ${corpusWords.toLocaleString()}`}
              sub="of the reference corpus"
            />
            <Fig
              label="Playable"
              value={`${pct(syllablesCovered, corpusSyllables)}%`}
              sub={`${syllablesCovered} / ${corpusSyllables} syllables — one word for every syllable means a chain can always go on`}
            />
            <Fig
              label="Recalled"
              value={`${stats.recalled} / ${stats.total}`}
              sub={`${stats.totalRecalls} recall${stats.totalRecalls === 1 ? "" : "s"} in total`}
            />
            <Fig
              label="Chains to exhaust"
              value={String(stats.chains)}
              sub={
                stats.total > 0
                  ? `avg ${(stats.total / Math.max(1, stats.chains)).toFixed(1)} words per chain`
                  : "add words to begin"
              }
            />
            <Fig
              label="Longest chain"
              value={String(stats.longest)}
              sub={
                stats.longest > 0
                  ? "words in one unbroken run — the best a bounded search found, so a floor not a ceiling"
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
          <p className="longku-stat-sub" style={{ marginTop: 14 }}>
            Chains to exhaust is the fewest 接龙 runs that use every word once. It
            drops when you learn a word starting where a chain dead-ends, and
            rises when you add one nothing connects to.
          </p>
        </section>
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

function pct(n: number, d: number) {
  if (d <= 0) return "0";
  const v = (n / d) * 100;
  return v > 0 && v < 1 ? v.toFixed(1) : String(Math.round(v));
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
