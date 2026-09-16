"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  importWords,
  recordRecall,
  resetSweep,
  type BankEntry,
  type State,
} from "@longku/lib/store";
import { available, pickChainStart, unused } from "@longku/lib/chains";
import { TierPill } from "./AddChengyu";

interface Suggestion {
  w: string;
  p: string;
  fs: string;
  ls: string;
  f?: number;
}

interface Props {
  state: State;
  onChange: (s: State) => void;
  /** Bumped by the caller to force a new chain from a chosen syllable. */
  startAt: { syl: string; nonce: number };
  onRerollStart: () => void;
}

export function ChainPlay({ state, onChange, startAt, onRerollStart }: Props) {
  /** Words in the current chain, in order. */
  const [chain, setChain] = useState<BankEntry[]>([]);
  const [need, setNeed] = useState<string>("");
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [teach, setTeach] = useState<Suggestion[] | null>(null);
  const [loadingTeach, setLoadingTeach] = useState(false);

  const remaining = useMemo(() => unused(state), [state]);
  const bankSize = Object.keys(state.bank).length;
  const doneThisSweep = state.sweep.length;

  /** Can the chain go on from `syl` using something not yet used this sweep? */
  const canContinue = useCallback(
    (syl: string) => available(state, syl).length > 0,
    [state],
  );

  // Open a chain whenever the caller asks for one.
  useEffect(() => {
    if (!startAt.syl) return;
    setChain([]);
    setNeed(startAt.syl);
    setDraft("");
    setMsg(null);
    setTeach(null);
  }, [startAt.syl, startAt.nonce]);

  const stuck = need !== "" && !canContinue(need);

  // When the chain can't continue, fetch chengyus from the reference corpus
  // that start where we're stuck. Learning one of these is what merges two
  // chains into a longer one.
  useEffect(() => {
    if (!stuck || !need) {
      setTeach(null);
      return;
    }
    let cancelled = false;
    setLoadingTeach(true);
    fetch(`/api/longku/syllable/${encodeURIComponent(need)}?limit=6`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        const have = new Set(Object.keys(state.bank));
        const list: Suggestion[] = (d?.chengyus ?? [])
          .filter((c: Suggestion) => !have.has(c.w))
          .slice(0, 3);
        setTeach(list);
      })
      .catch(() => !cancelled && setTeach([]))
      .finally(() => !cancelled && setLoadingTeach(false));
    return () => {
      cancelled = true;
    };
  }, [stuck, need, state.bank]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const word = draft.trim();
    if (!word) return;

    const entry = state.bank[word];
    if (!entry) {
      setMsg({
        kind: "error",
        text: `"${word}" isn't in your bank. Add it up top, then it can join a chain.`,
      });
      return;
    }
    if (entry.fs !== need) {
      setMsg({ kind: "error", text: `"${word}" starts with ${entry.fs}, not ${need}.` });
      return;
    }
    if (state.sweep.includes(word)) {
      setMsg({ kind: "error", text: `Already used "${word}" this sweep.` });
      return;
    }

    const next = recordRecall(word);
    onChange(next);
    setChain((c) => [...c, entry]);
    setDraft("");
    setMsg(null);
    setNeed(entry.ls ?? "");
    if (entry.ls === null) {
      setMsg({
        kind: "success",
        text: `Added. No reading for its last syllable, so the chain ends here.`,
      });
    }
  }

  function learn(s: Suggestion) {
    const { state: next } = importWords([{ w: s.w, fs: s.fs, ls: s.ls, f: s.f }]);
    onChange(next);
    setMsg({ kind: "success", text: `${s.w} added to your bank — the chain can go on.` });
    setTeach(null);
  }

  function newChain() {
    const start = pickChainStart(state);
    if (!start) return;
    setChain([]);
    setNeed(start.fs);
    setDraft("");
    setMsg(null);
    setTeach(null);
  }

  function startOver() {
    const next = resetSweep();
    onChange(next);
    setChain([]);
    setMsg(null);
    onRerollStart();
  }

  if (bankSize === 0) {
    return (
      <div className="longku-dock-inner">
        <span className="longku-dock-label">接龙</span>
        <p className="longku-play-empty">
          Your bank is empty — add a chengyu up top and it&rsquo;ll start chaining here.
        </p>
      </div>
    );
  }

  const sweepDone = remaining.length === 0;

  return (
    <section aria-label="Play">
      {chain.length > 0 && (
        <ol className="longku-chain-strip" style={{ marginBottom: 10 }}>
          {chain.map((c, i) => (
            <li key={c.w}>
              {i > 0 && <span className="longku-chain-arrow">→</span>}
              <span className="longku-chain-word" title={`${c.fs} → ${c.ls ?? "?"}`}>
                {c.w}
              </span>
            </li>
          ))}
        </ol>
      )}

      {sweepDone ? (
        <div className="longku-play-done">
          <p className="longku-input-msg is-success">
            Every chengyu in your bank has been through a chain. That&rsquo;s the whole
            sweep.
          </p>
          <button className="longku-btn is-primary" onClick={startOver}>
            Start a new sweep
          </button>
        </div>
      ) : stuck ? (
        <div className="longku-stuck">
          <p className="longku-stuck-line">
            Nothing left in your bank starts with <strong>{need}</strong> — this chain
            is finished{chain.length > 0 ? ` at ${chain.length}` : ""}.
          </p>
          {loadingTeach && <p className="longku-hint">Looking for one to learn…</p>}
          {teach && teach.length > 0 && (
            <>
              <p className="longku-hint">
                Learn one of these and the chain keeps going:
              </p>
              <div className="longku-teach">
                {teach.map((s) => (
                  <button
                    key={s.w}
                    className="longku-teach-card"
                    onClick={() => learn(s)}
                    title={`${s.fs} → ${s.ls}`}
                  >
                    <span className="longku-teach-word">{s.w}</span>
                    <span className="longku-teach-pinyin">{s.p}</span>
                    <TierPill f={s.f} />
                    <span className="longku-teach-add">+ add to bank</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {teach && teach.length === 0 && !loadingTeach && (
            <p className="longku-hint">
              The corpus has nothing new starting with {need} either.
            </p>
          )}
          <button className="longku-btn" onClick={newChain}>
            Start a new chain ({remaining.length} left)
          </button>
        </div>
      ) : (
        <>
          <form className="longku-dock-inner" onSubmit={submit}>
            <span className="longku-dock-label">接龙</span>
            <label className="longku-play-prompt" htmlFor="longku-chain-input">
              starting with <strong>{need}</strong>
            </label>
            <div className="longku-play-input-row">
              <input
                id="longku-chain-input"
                className="longku-input"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setMsg(null);
                }}
                placeholder={need}
                autoComplete="off"
                spellCheck={false}
              />
              <button className="longku-btn is-primary" type="submit">
                Chain it
              </button>
            </div>
            <div className="longku-sweep">
              <div className="longku-sweep-bar">
                <div
                  className="longku-sweep-fill"
                  style={{
                    width: `${Math.round((doneThisSweep / Math.max(1, bankSize)) * 100)}%`,
                  }}
                />
              </div>
              <span className="longku-sweep-text">
                {doneThisSweep} / {bankSize}
              </span>
            </div>
          </form>
          {msg ? (
            <p className={`longku-input-msg is-${msg.kind}`} style={{ marginTop: 6 }}>
              {msg.text}
            </p>
          ) : (
            <p className="longku-play-sub" style={{ marginTop: 6 }}>
              {available(state, need).length} in your bank start with {need}
            </p>
          )}
        </>
      )}
    </section>
  );
}
