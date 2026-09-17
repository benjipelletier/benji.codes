"use client";

import { useEffect, useMemo, useState } from "react";
import { importWords, removeWord, type State } from "@longku/lib/store";
import { TierPill } from "./AddChengyu";

interface CorpusWord {
  w: string;
  p: string;
  fs: string;
  ls: string;
  f: number;
}

interface Props {
  syllable: string;
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

  const suggestions = useMemo(
    () => pool.filter((c) => !state.bank[c.w]).slice(0, 24),
    [pool, state],
  );

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
            {mine.length} of yours · {pool.length > 0 ? `${pool.length}+ in the corpus` : "—"}
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
                  <span
                    className="longku-bucket-recalls"
                    title={`${e.recalls} recall${e.recalls === 1 ? "" : "s"}, ${e.misses ?? 0} miss${(e.misses ?? 0) === 1 ? "" : "es"}`}
                  >
                    <span className="longku-strength" aria-hidden>
                      <span
                        className="longku-strength-fill"
                        style={{ width: `${Math.round((e.strength ?? 0) * 100)}%` }}
                      />
                    </span>
                    {Math.round((e.strength ?? 0) * 100)}%
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

        {!readOnly && (
        <section className="longku-modal-section">
          <h3 className="longku-subhead">Add from the corpus</h3>
          {loading ? (
            <p className="longku-hint">Loading…</p>
          ) : suggestions.length === 0 ? (
            <p className="longku-hint">You already hold everything common here.</p>
          ) : (
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
