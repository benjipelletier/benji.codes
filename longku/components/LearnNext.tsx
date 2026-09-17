"use client";

import { useEffect, useMemo, useState } from "react";
import { importWords, type BankEntry, type State } from "@longku/lib/store";
import { minChains, stats as bankStats } from "@longku/lib/chains";
import { TierPill } from "./AddChengyu";

interface Candidate {
  w: string;
  p: string;
  fs: string;
  ls: string;
  f: number;
  e: string;
}

interface Scored extends Candidate {
  /** Chains removed by learning this word. */
  saves: number;
}

interface Props {
  state: State;
  onChange: (s: State) => void;
  readOnly?: boolean;
}

/**
 * What to learn next, ranked by how much it shortens the work.
 *
 * The bank's chain count is the app's score, and it moves on which words you
 * know rather than how many: three hundred words picked at random need 153
 * chains averaging two words, while three hundred chosen to connect need 60
 * averaging five. This turns that measurement into a list.
 */
export function LearnNext({ state, onChange, readOnly = false }: Props) {
  const [raw, setRaw] = useState<Candidate[] | null>(null);
  const [loading, setLoading] = useState(false);

  const s = useMemo(() => bankStats(state), [state]);
  const bank = useMemo(() => Object.values(state.bank), [state]);
  const starts = useMemo(() => [...new Set(bank.map((e) => e.fs))], [bank]);

  useEffect(() => {
    if (s.deadEnds.length === 0) {
      setRaw([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch("/api/longku/learn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deadEnds: s.deadEnds,
        starts,
        have: Object.keys(state.bank),
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setRaw(d?.candidates ?? []))
      .catch(() => !cancelled && setRaw([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // Recomputed when the shape of the bank changes, not on every recall.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.deadEnds.join(","), starts.join(","), bank.length]);

  // The endpoint narrows 30k words to a shortlist by structure; the real metric
  // decides the order, since only it knows how much each actually saves.
  const ranked = useMemo<Scored[]>(() => {
    if (!raw || raw.length === 0) return [];
    const base = minChains(bank);
    return raw
      .map((c) => {
        const probe: BankEntry = {
          w: c.w,
          fs: c.fs,
          ls: c.ls,
          f: c.f,
          recalls: 0,
          strength: 0,
          misses: 0,
          added: 0,
        };
        return { ...c, saves: base - minChains([...bank, probe]) };
      })
      .filter((c) => c.saves > 0)
      .sort((a, b) => b.saves - a.saves || b.f - a.f)
      .slice(0, 18);
  }, [raw, bank]);

  function learn(c: Scored) {
    const { state: next } = importWords([{ w: c.w, fs: c.fs, ls: c.ls, f: c.f }]);
    onChange(next);
  }

  if (bank.length === 0) {
    return (
      <p className="longku-wall-empty">
        Add some chengyus and this will show which ones would join them up.
      </p>
    );
  }

  return (
    <section className="longku-learn" aria-label="What to learn next">
      <header className="longku-learn-head">
        <p className="longku-learn-lede">
          Your {s.total} words need <strong>{s.chains}</strong> chains to work
          through, averaging {(s.total / Math.max(1, s.chains)).toFixed(1)} words.
          Each of these joins two of those chains into one — they start where a
          chain of yours dies and end where you can keep going.
        </p>
      </header>

      {loading && <p className="longku-hint">Working out what would help…</p>}

      {!loading && ranked.length === 0 && (
        <p className="longku-hint">
          {s.deadEnds.length === 0
            ? "Nothing to join — every syllable you reach has a way out."
            : "No corpus word joins two of your chains yet. Adding more words will open some up."}
        </p>
      )}

      <div className="longku-learn-grid">
        {ranked.map((c) => (
          <div className="longku-learn-card" key={c.w}>
            <div className="longku-learn-word">{c.w}</div>
            <div className="longku-learn-pinyin">{c.p}</div>
            {c.e && <div className="longku-learn-gloss">{c.e}</div>}
            <div className="longku-learn-foot">
              <TierPill f={c.f} />
              <span className="longku-learn-join">
                {c.fs} → {c.ls}
              </span>
              <span className="longku-learn-saves">
                −{c.saves} chain{c.saves === 1 ? "" : "s"}
              </span>
            </div>
            {!readOnly && (
              <button className="longku-btn is-primary longku-learn-add" onClick={() => learn(c)}>
                Add to bank
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
