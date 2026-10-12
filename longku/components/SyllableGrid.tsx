"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { State } from "@longku/lib/store";
import { suggestSyllables } from "@longku/lib/chains";
import { formatShare } from "@longku/lib/frequency";

export interface SyllableSummary {
  syl: string;
  count: number;
  /** Corpus chengyus ending on this syllable — every way a chain can arrive. */
  ending: number;
  /** The commonest of them — what a game most often lands you here with. */
  endTop: string;
  /** Number of chengyus in this bucket with corpus frequency >= COMMON_FREQ_THRESHOLD. */
  common: number;
  top: string;
}

interface Props {
  syllables: SyllableSummary[];
  state: State;
  /** Share of usage ending on each syllable — see comesUpBySyllable. */
  comesUp: Record<string, number>;
  onPick: (syl: string) => void;
  onStartChain: (syl: string) => void;
}

/**
 * How the wall is laid out. Alphabetical is grouped by initial; the rest are
 * one ranking, largest first, so the syllables that matter most by that
 * measure are the first you see.
 */
type Order = "alpha" | "starts" | "ends" | "comesUp";

const ORDERS: Array<{ id: Order; label: string; hint: string }> = [
  { id: "alpha", label: "a–z", hint: "Alphabetical, grouped by initial" },
  { id: "starts", label: "starts", hint: "Most chengyu starting with the syllable first" },
  { id: "ends", label: "ends", hint: "Most chengyu ending on the syllable first" },
  {
    id: "comesUp",
    label: "comes up",
    hint: "Most likely to come up in a game first: the share of chengyu usage that ends on it",
  },
];

const ORDER_KEY = "longku:wall-order";

/** Yours per syllable, by first syllable and by last. */
interface Held {
  total: number;
  recalled: number;
}

export function SyllableGrid({ syllables, state, comesUp, onPick, onStartChain }: Props) {
  // Remembered per device: a wall that snapped back to a–z on every visit
  // would make the other orders a chore to use.
  const [order, setOrderState] = useState<Order>("alpha");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(ORDER_KEY);
      if (ORDERS.some((o) => o.id === saved)) setOrderState(saved as Order);
    } catch {
      // Storage unavailable; a–z it is.
    }
  }, []);
  function setOrder(o: Order) {
    setOrderState(o);
    try {
      localStorage.setItem(ORDER_KEY, o);
    } catch {
      // As above — the order still applies for this visit.
    }
  }

  // Bank size and recall count per starting syllable.
  const mine = useMemo(() => {
    const m = new Map<string, Held>();
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
    const m = new Map<string, Held>();
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

  const ranked = useMemo(() => {
    if (order === "alpha") return [];
    const key = (s: SyllableSummary) =>
      order === "starts" ? s.count : order === "ends" ? s.ending : (comesUp[s.syl] ?? 0);
    return [...syllables].sort((a, b) => key(b) - key(a) || a.syl.localeCompare(b.syl));
  }, [syllables, order, comesUp]);

  const cell = (s: SyllableSummary) => (
    <Cell
      key={s.syl}
      s={s}
      have={mine.get(s.syl)}
      arrive={ending.get(s.syl)?.total ?? 0}
      comesUp={comesUp[s.syl] ?? 0}
      order={order}
      onPick={onPick}
      onStartChain={onStartChain}
    />
  );

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
    <div className="longku-wall-order" role="group" aria-label="Order the wall">
      <span className="longku-wall-order-label">order</span>
      {ORDERS.map((o) => (
        <button
          key={o.id}
          type="button"
          className={`longku-wall-order-btn ${order === o.id ? "is-on" : ""}`}
          aria-pressed={order === o.id}
          onClick={() => setOrder(o.id)}
          title={o.hint}
        >
          {o.label}
        </button>
      ))}
    </div>
    <div className="longku-grid" role="grid" aria-label="Bank by syllable">
      {order === "alpha" ? (
        grouped.map(({ letter, rows }) => (
          <div className="longku-row" key={letter} role="row">
            <div className="longku-row-letter" aria-hidden>{letter}</div>
            <div className="longku-row-cells">{rows.map(cell)}</div>
          </div>
        ))
      ) : (
        // One ranking rather than rows by initial. The empty letter column
        // keeps the cells where a–z puts them, so switching doesn't jump.
        <div className="longku-row" role="row">
          <div className="longku-row-letter" aria-hidden />
          <div className="longku-row-cells">{ranked.map(cell)}</div>
        </div>
      )}
    </div>
    </>
  );
}

/**
 * One syllable on the wall.
 *
 * The face carries the syllable and whichever count the wall is ordered by.
 * Hovering opens it out into a card with all three — starts, ends and how
 * often the syllable comes up — and the start-a-chain action. On a touch
 * screen there's no hover: a tap opens the bucket, which shows the same.
 */
function Cell({
  s,
  have: held,
  arrive,
  comesUp,
  order,
  onPick,
  onStartChain,
}: {
  s: SyllableSummary;
  have: Held | undefined;
  /** Yours that end here: the chains that arrive. */
  arrive: number;
  comesUp: number;
  order: Order;
  onPick: (syl: string) => void;
  onStartChain: (syl: string) => void;
}) {
  const have = held?.total ?? 0;
  // Background tracks the share of this bucket you hold. Real shares are tiny
  // (a few words against a bucket of hundreds), so a linear ramp would leave
  // nearly every cell blank; the square root keeps 0 at 0 and 100% at full
  // while making a 2% bucket visibly different from an empty one.
  const share = s.count > 0 ? Math.min(1, have / s.count) : 0;
  const fill = share > 0 ? Math.sqrt(share) : 0;
  const status = have === 0 ? "empty" : held!.recalled > 0 ? "active" : "fresh";
  // Past roughly half fill the ground is too dark for ink type, so the label
  // flips to the light-on-accent pair instead.
  const deep = fill >= 0.55;
  // More of yours arrive than can leave: chains stop here.
  const stuck = arrive > have;
  const odds = formatShare(comesUp);

  // The card opens rightward from the cell; near the wall's right edge it
  // opens leftward instead, rather than being cut off. Measured as it opens,
  // since where a cell sits depends on the width and the order. A data
  // attribute, not a class, so React's next render doesn't wipe it.
  function place(e: React.SyntheticEvent<HTMLDivElement>) {
    const cell = e.currentTarget;
    const pop = cell.querySelector<HTMLElement>(".longku-cell-pop");
    const wall = cell.closest(".longku-grid");
    if (!pop || !wall) return;
    const room = wall.getBoundingClientRect().right - cell.getBoundingClientRect().left;
    cell.dataset.pop = pop.offsetWidth > room ? "left" : "right";
  }

  return (
    <div
      className={`longku-cell status-${status}${deep ? " is-deep" : ""}`}
      style={{ "--lg-cell-share": fill.toFixed(3) } as React.CSSProperties}
      onMouseEnter={place}
      onFocus={place}
      onClick={() => onPick(s.syl)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick(s.syl);
        }
      }}
      role="gridcell"
      tabIndex={0}
      aria-label={
        `${s.syl}: ${have} of yours start with it out of ${s.count}; ` +
        `${arrive} of yours end on it out of ${s.ending}; comes up ${odds} of the time` +
        (stuck ? "; chains stop here" : "")
      }
    >
      <span className="longku-cell-syl">{s.syl}</span>
      <span className="longku-cell-count">
        {order === "comesUp" ? (
          <span className="longku-cell-mine">{odds}</span>
        ) : (
          <>
            <span className="longku-cell-mine">{order === "ends" ? arrive : have}</span>
            <span className="longku-cell-slash">/</span>
            <span className="longku-cell-all">{order === "ends" ? s.ending : s.count}</span>
          </>
        )}
      </span>
      {/* Something of yours ends here. The counts are in the card. */}
      {arrive > 0 && <span className="longku-cell-dot" aria-hidden />}

      <div className="longku-cell-pop">
        <div className="longku-pop-head">
          <span className="longku-pop-syl">{s.syl}</span>
          {have > 0 && (
            <button
              type="button"
              className="longku-pop-chain"
              onClick={(e) => {
                e.stopPropagation();
                onStartChain(s.syl);
              }}
              aria-label={`Start chain from ${s.syl}`}
              title={`Break the chain and carry on from ${s.syl}`}
            >
              ▸ chain
            </button>
          )}
        </div>
        <div className="longku-pop-rows" aria-hidden>
          <div className={order === "starts" ? "is-key" : ""}>
            <span className="longku-pop-k">starts</span>
            <span className="longku-pop-v">
              <b>{have}</b> / {s.count.toLocaleString()}
            </span>
            {/* Every row fills all three columns, or the next row slides up into the gap. */}
            <span className="longku-pop-aside" />
          </div>
          <div className={order === "ends" ? "is-key" : ""}>
            <span className="longku-pop-k">ends</span>
            <span className="longku-pop-v">
              <b>{arrive}</b> / {s.ending.toLocaleString()}
            </span>
            <span className={`longku-pop-aside ${stuck ? "is-warn" : ""}`}>
              {stuck ? "chains stop here" : ""}
            </span>
          </div>
          <div className={order === "comesUp" ? "is-key" : ""}>
            <span className="longku-pop-k">comes up</span>
            <span className="longku-pop-v">
              <b>{odds}</b>
            </span>
            <span className="longku-pop-aside">{s.endTop ? `via ${s.endTop}` : ""}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
