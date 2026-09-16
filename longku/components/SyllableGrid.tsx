"use client";

import React, { useMemo } from "react";
import type { State } from "@longku/lib/store";

export interface SyllableSummary {
  syl: string;
  count: number;
  /** Number of chengyus in this bucket with corpus frequency >= COMMON_FREQ_THRESHOLD. */
  common: number;
  top: string;
}

interface Props {
  syllables: SyllableSummary[];
  state: State;
  onPick: (syl: string) => void;
  onStartChain: (syl: string) => void;
}

export function SyllableGrid({ syllables, state, onPick, onStartChain }: Props) {
  // Bank size and recall count per starting syllable.
  const mine = useMemo(() => {
    const m = new Map<string, { total: number; recalled: number }>();
    for (const e of Object.values(state.bank)) {
      const cur = m.get(e.fs) ?? { total: 0, recalled: 0 };
      cur.total += 1;
      if (e.recalls > 0) cur.recalled += 1;
      m.set(e.fs, cur);
    }
    return m;
  }, [state]);

  const grouped = useMemo(() => {
    const byInitial = new Map<string, SyllableSummary[]>();
    for (const s of syllables) {
      const k = s.syl[0];
      if (!byInitial.has(k)) byInitial.set(k, []);
      byInitial.get(k)!.push(s);
    }
    return [...byInitial.keys()].sort().map((k) => ({
      letter: k,
      rows: byInitial.get(k)!.sort((a, b) => a.syl.localeCompare(b.syl)),
    }));
  }, [syllables]);

  return (
    <div className="longku-grid" role="grid" aria-label="Bank by starting syllable">
      {grouped.map(({ letter, rows }) => (
        <div className="longku-row" key={letter} role="row">
          <div className="longku-row-letter" aria-hidden>{letter}</div>
          <div className="longku-row-cells">
            {rows.map((s) => {
              const held = mine.get(s.syl);
              const have = held?.total ?? 0;
              // Background tracks the share of this bucket you hold. Real
              // shares are tiny (a few words against a bucket of hundreds), so
              // a linear ramp would leave nearly every cell blank; the square
              // root keeps 0 at 0 and 100% at full while making a 2% bucket
              // visibly different from an empty one.
              const share = s.count > 0 ? Math.min(1, have / s.count) : 0;
              const fill = share > 0 ? Math.sqrt(share) : 0;
              const status = have === 0 ? "empty" : (held!.recalled > 0 ? "active" : "fresh");
              // Past roughly half fill the ground is too dark for ink type, so
              // the label flips to the light-on-accent pair instead.
              const deep = fill >= 0.55;
              const title =
                have === 0
                  ? `${s.syl} — none of yours yet · ${s.count} in the corpus · top: ${s.top}`
                  : `${s.syl} — ${have} of yours (${held!.recalled} recalled) · ${s.count} in the corpus`;
              return (
                <div
                  key={s.syl}
                  className={`longku-cell status-${status}${deep ? " is-deep" : ""}`}
                  style={{ "--lg-cell-share": fill.toFixed(3) } as React.CSSProperties}
                  onClick={() => onPick(s.syl)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onPick(s.syl);
                    }
                  }}
                  title={`${title} · ${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`}
                  role="gridcell"
                  tabIndex={0}
                  aria-label={`${s.syl}, ${have} of yours out of ${s.count} in the corpus`}
                >
                  <span className="longku-cell-syl">{s.syl}</span>
                  <span className="longku-cell-count">
                    <span className="longku-cell-mine">{have}</span>
                    <span className="longku-cell-slash">/</span>
                    <span className="longku-cell-all">{s.count}</span>
                  </span>
                  {have > 0 && (
                    <button
                      type="button"
                      className="longku-cell-play"
                      onClick={(e) => {
                        e.stopPropagation();
                        onStartChain(s.syl);
                      }}
                      aria-label={`Start chain from ${s.syl}`}
                      title={`Start chain from ${s.syl}`}
                    >
                      ▸
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
