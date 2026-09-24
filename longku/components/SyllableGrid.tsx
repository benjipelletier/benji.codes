"use client";

import React, { useMemo } from "react";
import type { State } from "@longku/lib/store";
import { suggestSyllables } from "@longku/lib/chains";

export interface SyllableSummary {
  syl: string;
  count: number;
  /** Corpus chengyus ending on this syllable — every way a chain can arrive. */
  ending: number;
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

  // The same, by ending syllable: your words that arrive at each one.
  const ending = useMemo(() => {
    const m = new Map<string, { total: number; recalled: number }>();
    for (const e of Object.values(state.bank)) {
      if (!e.ls) continue;
      const cur = m.get(e.ls) ?? { total: 0, recalled: 0 };
      cur.total += 1;
      if (e.recalls > 0) cur.recalled += 1;
      m.set(e.ls, cur);
    }
    return m;
  }, [state]);

  const bank = useMemo(() => Object.values(state.bank), [state]);
  const suggested = useMemo(() => suggestSyllables(bank, syllables), [bank, syllables]);

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
    <>
    {suggested.length > 0 && (
      <div className="longku-wall-head">
        <div className="longku-suggest" aria-label="Syllables worth learning a word for">
          <span className="longku-suggest-label">learn a word starting with</span>
          {suggested.map((g, i) => (
            <button
              key={g.syl}
              type="button"
              className={`longku-suggest-chip ${i === 0 ? "is-top" : ""}`}
              onClick={() => onPick(g.syl)}
              title={`${g.in} of your words end on ${g.syl}, ${g.out} start with it — ${g.in - g.out} chain${g.in - g.out === 1 ? "" : "s"} stop here. ${g.common} common word${g.common === 1 ? "" : "s"} start with ${g.syl}.`}
            >
              <span className="longku-suggest-syl">{g.syl}</span>
              <span className="longku-suggest-flow">
                {g.in} in · {g.out} out
              </span>
            </button>
          ))}
          <span className="longku-suggest-why">
            more of your words end on these than start with them
          </span>
        </div>
      </div>
    )}
    <div className="longku-grid" role="grid" aria-label="Bank by syllable">
      {grouped.map(({ letter, rows }) => (
        <div className="longku-row" key={letter} role="row">
          <div className="longku-row-letter" aria-hidden>{letter}</div>
          <div className="longku-row-cells">
            {rows.map((s) => {
              const held = mine.get(s.syl);
              const have = held?.total ?? 0;
              // Yours that end here: the chains that arrive.
              const arrive = ending.get(s.syl)?.total ?? 0;
              // Background tracks the share of this bucket you hold. Real
              // shares are tiny (a few words against a bucket of hundreds), so
              // a linear ramp would leave nearly every cell blank; the square
              // root keeps 0 at 0 and 100% at full while making a 2% bucket
              // visibly different from an empty one.
              const share = s.count > 0 ? Math.min(1, have / s.count) : 0;
              const fill = share > 0 ? Math.sqrt(share) : 0;
              const status = have === 0 ? "empty" : held!.recalled > 0 ? "active" : "fresh";
              // Past roughly half fill the ground is too dark for ink type, so
              // the label flips to the light-on-accent pair instead.
              const deep = fill >= 0.55;
              // More of yours arrive than can leave: chains stop here.
              const stuck = arrive > have;
              const title =
                `${s.syl} — starts: ${have} of yours / ${s.count} in the corpus` +
                ` · ends: ${arrive} of yours / ${s.ending} in the corpus` +
                (stuck ? ` · ${arrive - have} more of yours arrive than can leave` : "") +
                (have === 0 && s.top ? ` · top: ${s.top}` : "");
              return (
                <div
                  key={s.syl}
                  className={`longku-cell status-${status}${deep ? " is-deep" : ""}${stuck ? " is-stuck" : ""}`}
                  style={{ "--lg-cell-share": fill.toFixed(3) } as React.CSSProperties}
                  onClick={() => onPick(s.syl)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onPick(s.syl);
                    }
                  }}
                  title={title}
                  role="gridcell"
                  tabIndex={0}
                  aria-label={`${s.syl}: ${have} of yours start with it out of ${s.count}; ${arrive} of yours end on it out of ${s.ending}${stuck ? "; chains stop here" : ""}`}
                >
                  <span className="longku-cell-syl">{s.syl}</span>
                  <span className="longku-cell-count">
                    <span className="longku-cell-mine">{have}</span>
                    <span className="longku-cell-slash">/</span>
                    <span className="longku-cell-all">{s.count}</span>
                  </span>
                  {/* Yours that end here, as a badge on the corner: chains
                      arriving. Amber when more arrive than can leave. Hover
                      widens it to show the corpus total — every way a chain
                      could arrive — and shows it on cells with none of yours
                      yet, where it otherwise stays hidden. */}
                  <span
                    className={`longku-cell-badge${arrive === 0 ? " is-zero" : ""}`}
                    aria-hidden
                  >
                    {arrive}
                    <span className="longku-cell-badge-of">/{s.ending}</span>
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
    </>
  );
}
