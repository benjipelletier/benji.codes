"use client";

import { useEffect, useMemo, useState } from "react";
import { importWords, removeWord, type State } from "@longku/lib/store";
import { TierPill } from "./AddChengyu";
import { gloss } from "@longku/lib/gloss";

interface CorpusWord {
  w: string;
  p: string;
  fs: string;
  ls: string;
  f: number;
  /** CEDICT definition. */
  e?: string;
}

/** How many unbanked corpus words get the full treatment before the chips. */
const TOP = 5;

interface Props {
  syllable: string;
  /** Corpus words starting with and ending on the syllable, when known. */
  corpus?: { count: number; ending: number };
  state: State;
  onClose: () => void;
  onChange: (s: State) => void;
  onStartChain: (syl: string) => void;
  readOnly?: boolean;
}

/**
 * Inspector for one syllable bucket: what you hold, and what the corpus could
 * add. Producing words under pressure is ChainPlay's job — this is for looking
 * at a bucket and filling it out.
 */
export function DrillModal({
  syllable,
  corpus,
  state,
  onClose,
  onChange,
  onStartChain,
  readOnly = false,
}: Props) {
  const [pool, setPool] = useState<CorpusWord[]>([]);
  const [loading, setLoading] = useState(true);

  const mine = useMemo(
    () =>
      Object.values(state.bank)
        .filter((e) => e.fs === syllable)
        .sort((a, b) => (a.strength ?? 0) - (b.strength ?? 0) || a.w.localeCompare(b.w)),
    [state, syllable],
  );

  // Yours that end here: the chains a word starting with this syllable would
  // carry on.
  const arriving = useMemo(
    () =>
      Object.values(state.bank)
        .filter((e) => e.ls === syllable)
        .sort((a, b) => a.w.localeCompare(b.w)),
    [state, syllable],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/longku/syllable/${encodeURIComponent(syllable)}?limit=60`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setPool(d?.chengyus ?? []))
      .catch(() => !cancelled && setPool([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [syllable]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The corpus comes back most frequent first, so the head of what you don't
  // hold is what you're likeliest to meet.
  const missing = useMemo(() => pool.filter((c) => !state.bank[c.w]), [pool, state]);
  const top = missing.slice(0, TOP);
  const suggestions = missing.slice(TOP, TOP + 24);

  // Where each would take a chain: how many of yours start on its last
  // syllable. A word that lands where you can carry on is worth more than one
  // that makes a new dead end.
  const startsAt = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of Object.values(state.bank)) m.set(e.fs, (m.get(e.fs) ?? 0) + 1);
    return m;
  }, [state]);

  function add(c: CorpusWord) {
    const { state: next } = importWords([{ w: c.w, fs: c.fs, ls: c.ls, f: c.f }]);
    onChange(next);
  }

  function drop(w: string) {
    onChange(removeWord(w));
  }

  return (
    <div className="longku-modal-overlay" onClick={onClose} role="presentation">
      <div
        className="longku-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Bucket ${syllable}`}
      >
        <header className="longku-modal-head">
          <h2 className="longku-modal-syllable">{syllable}</h2>
          <span className="longku-modal-sub">
            {corpus ? (
              <>
                starts <b className="longku-modal-n">{mine.length}</b>/{corpus.count}
                {" · "}
                ends <b className="longku-modal-n">{arriving.length}</b>/{corpus.ending}
              </>
            ) : (
              <>
                {mine.length} of yours start here · {arriving.length} end here ·{" "}
                {pool.length > 0 ? `${pool.length}+ in the corpus` : "—"}
              </>
            )}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {mine.length > 0 && (
              <button className="longku-btn" onClick={() => onStartChain(syllable)}>
                Chain from here
              </button>
            )}
            <button className="longku-modal-close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        </header>

        <section className="longku-modal-section">
          <h3 className="longku-subhead">In your bank</h3>
          {mine.length === 0 ? (
            <p className="longku-hint">Nothing here yet.</p>
          ) : (
            <ul className="longku-bucket-list">
              {mine.map((e) => (
                <li key={e.w} className="longku-bucket-item">
                  <span className="longku-bucket-word">{e.w}</span>
                  <TierPill f={e.f} offCorpus={e.offCorpus} />
                  <span className="longku-bucket-meta">
                    {e.fs} → {e.ls ?? "?"}
                  </span>
                  <span className="longku-bucket-stats">
                    <span className="longku-bucket-stat" title="times produced in play">
                      <b>{e.recalls}</b> recall{e.recalls === 1 ? "" : "s"}
                    </span>
                    <span
                      className={`longku-bucket-stat ${(e.misses ?? 0) > 0 ? "is-miss" : ""}`}
                      title="times it was available under a prompt and not produced"
                    >
                      <b>{e.misses ?? 0}</b> miss{(e.misses ?? 0) === 1 ? "" : "es"}
                    </span>
                    <span
                      className="longku-bucket-stat is-since"
                      title={
                        e.lastSeen
                          ? `last available ${new Date(e.lastSeen).toLocaleString()}`
                          : "never come up in play"
                      }
                    >
                      {since(e.lastSeen)}
                    </span>
                    <span className="longku-bucket-pct">
                      {Math.round((e.strength ?? 0) * 100)}%
                    </span>
                    <span
                      className="longku-strength"
                      title={`strength ${Math.round((e.strength ?? 0) * 100)}%`}
                      aria-hidden
                    >
                      <span
                        className="longku-strength-fill"
                        style={{ width: `${Math.round((e.strength ?? 0) * 100)}%` }}
                      />
                    </span>
                  </span>
                  {!readOnly && (
                    <button
                      className="longku-bucket-drop"
                      onClick={() => drop(e.w)}
                      aria-label={`Remove ${e.w}`}
                      title="Remove from bank"
                    >
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {arriving.length > 0 && (
          <section className="longku-modal-section">
            <h3 className="longku-subhead">
              Ending on {syllable}
              {arriving.length > mine.length && (
                <span className="longku-arrive-note">
                  {" "}
                  — {arriving.length - mine.length} more than can leave; each word you add
                  here carries one on
                </span>
              )}
            </h3>
            <div className="longku-arrive-words">
              {arriving.map((e) => (
                <span key={e.w} className="longku-arrive-word" title={`${e.fs} → ${e.ls}`}>
                  {e.w}
                </span>
              ))}
            </div>
          </section>
        )}

        <section className="longku-modal-section">
          <h3 className="longku-subhead">Most common you don&rsquo;t have</h3>
          {loading ? (
            <p className="longku-hint">Loading…</p>
          ) : top.length === 0 ? (
            <p className="longku-hint">You already hold everything common here.</p>
          ) : (
            <ol className="longku-top-list">
              {top.map((c) => {
                const onward = startsAt.get(c.ls) ?? 0;
                return (
                  <li key={c.w} className="longku-top-item">
                    <span className="longku-top-word">{c.w}</span>
                    <TierPill f={c.f} />
                    <span className="longku-top-pinyin">{c.p}</span>
                    <span
                      className={`longku-top-leads ${onward > 0 ? "is-on" : ""}`}
                      title={
                        onward > 0
                          ? `${onward} of yours start with ${c.ls} — a chain carries on from it`
                          : `none of yours start with ${c.ls} — a chain would stop there`
                      }
                    >
                      → {c.ls}
                      {onward > 0 && ` · ${onward}`}
                    </span>
                    {c.e && <span className="longku-top-gloss">{gloss(c.e, 2)}</span>}
                    {!readOnly && (
                      <button
                        type="button"
                        className="longku-top-add"
                        onClick={() => add(c)}
                        aria-label={`Add ${c.w} to your bank`}
                        title="Add to your bank"
                      >
                        +
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {!readOnly && suggestions.length > 0 && (
        <section className="longku-modal-section">
          <h3 className="longku-subhead">More from the corpus</h3>
          {(
            <div className="longku-chips">
              {suggestions.map((c) => (
                <button
                  key={c.w}
                  className="longku-chip"
                  onClick={() => add(c)}
                  title={`${c.p} · ${c.fs} → ${c.ls}`}
                >
                  <span className="longku-chip-word">{c.w}</span>
                  <span className="longku-chip-syl">+</span>
                </button>
              ))}
            </div>
          )}
        </section>
        )}
      </div>
    </div>
  );
}

/**
 * How long ago, in the coarsest unit that still says something.
 *
 * Reports when the word was last *available* under a prompt rather than when
 * it was last recalled — a word can come up repeatedly and be missed every
 * time, and "never" is the more useful reading of a word that has sat in the
 * bank untouched.
 */
function since(ms?: number): string {
  if (!ms) return "never seen";
  const secs = Math.max(0, (Date.now() - ms) / 1000);
  if (secs < 90) return "just now";
  const mins = secs / 60;
  if (mins < 60) return `${Math.round(mins)}m ago`;
  const hours = mins / 60;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}
