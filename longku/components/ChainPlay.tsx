"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  /** Chains already closed this sweep, oldest first. */
  const [history, setHistory] = useState<BankEntry[][]>([]);
  /** Revealing what the bank offers for the current syllable. */
  const [peek, setPeek] = useState(false);
  // Archiving happens from effects and handlers that don't have the current
  // chain in scope, so keep a live reference rather than adding it to deps.
  const chainRef = useRef<BankEntry[]>([]);
  chainRef.current = chain;

  /** Close the chain in progress, keeping it in the log if it has anything. */
  const archive = useCallback(() => {
    const cur = chainRef.current;
    if (cur.length > 0) setHistory((h) => [...h, cur]);
  }, []);

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
    archive();
    setChain([]);
    setNeed(startAt.syl);
    setDraft("");
    setMsg(null);
    setTeach(null);
    setPeek(false);
    // archive is stable; chain is read through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startAt.syl, startAt.nonce]);

  const stuck = need !== "" && !canContinue(need);

  // Chengyus from the reference corpus that start where the chain needs to go.
  // Wanted in two situations: the chain has dead-ended, and the user has asked
  // what else exists while still mid-chain. Learning one of these is what
  // merges two chains into a longer one.
  useEffect(() => {
    if ((!stuck && !peek) || !need) {
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
  }, [stuck, peek, need, state.bank]);

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
    setPeek(false);
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
    // Mid-peek the panel stays open, so the word shows up in the row above and
    // can be played straight away. At a dead end there is nothing to return to.
    if (!peek) setTeach(null);
  }

  function newChain() {
    const start = pickChainStart(state);
    if (!start) return;
    archive();
    setChain([]);
    setNeed(start.fs);
    setDraft("");
    setMsg(null);
    setTeach(null);
    setPeek(false);
  }

  /**
   * Bank a suggested word and play it immediately. It sits among the chain
   * options rather than the "worth learning" cards, so one click should
   * continue the chain — the cards below remain the add-without-playing path.
   */
  function learnAndPlay(sg: Suggestion) {
    const { state: added } = importWords([{ w: sg.w, fs: sg.fs, ls: sg.ls, f: sg.f }]);
    onChange(added);
    const entry = added.bank[sg.w];
    if (entry) play(entry);
  }

  /** Play a word straight from the revealed list. */
  function play(entry: BankEntry) {
    const next = recordRecall(entry.w);
    onChange(next);
    setChain((c) => [...c, entry]);
    setDraft("");
    setMsg(null);
    setPeek(false);
    setNeed(entry.ls ?? "");
  }

  function startOver() {
    const next = resetSweep();
    onChange(next);
    setChain([]);
    setHistory([]);
    setMsg(null);
    setPeek(false);
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
      {(history.length > 0 || chain.length > 0) && (
        <div className="longku-chain-log">
          {history.map((c, i) => (
            <ChainRow key={`done-${i}`} chain={c} index={i + 1} />
          ))}
          {chain.length > 0 && (
            <ChainRow chain={chain} index={history.length + 1} live />
          )}
        </div>
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
              <button
                type="button"
                className="longku-btn"
                onClick={() => setPeek((p) => !p)}
                aria-expanded={peek}
                title="Show what your bank offers for this syllable"
              >
                {peek ? "Hide" : "Stuck?"}
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
          {peek && (
            <div className="longku-peek">
              <span className="longku-peek-label">in your bank, starting with {need}</span>
              <div className="longku-peek-words">
                {available(state, need).length === 0 ? (
                  <span className="longku-hint">nothing yet</span>
                ) : (
                  available(state, need).map((e) => (
                    <button
                      key={e.w}
                      type="button"
                      className="longku-peek-word"
                      onClick={() => play(e)}
                      title={`${e.fs} → ${e.ls ?? "?"} · ${e.recalls} recall${e.recalls === 1 ? "" : "s"}`}
                    >
                      {e.w}
                    </button>
                  ))
                )}
                {teach && teach[0] && !state.bank[teach[0].w] && (
                  <button
                    type="button"
                    className="longku-peek-word is-new"
                    onClick={() => learnAndPlay(teach[0])}
                    title={`${teach[0].p} · not in your bank — adds it and plays it`}
                  >
                    {teach[0].w}
                    <span className="longku-peek-new">new</span>
                  </button>
                )}
              </div>

              {/* What you could add. Adding is deliberately separate from
                  playing: a word you were just shown hasn't been recalled, and
                  counting it as one would make the recall number a lie. */}
              <div className="longku-peek-add">
                <span className="longku-peek-label">worth learning for {need}</span>
                {loadingTeach && <span className="longku-hint">looking…</span>}
                {teach && teach.length > 0 && (
                  <div className="longku-teach">
                    {teach.map((sg) => (
                      <button
                        key={sg.w}
                        type="button"
                        className="longku-teach-card"
                        onClick={() => learn(sg)}
                        title={`${sg.fs} → ${sg.ls}`}
                      >
                        <span className="longku-teach-word">{sg.w}</span>
                        <span className="longku-teach-pinyin">{sg.p}</span>
                        <TierPill f={sg.f} />
                        <span className="longku-teach-add">+ add to bank</span>
                      </button>
                    ))}
                  </div>
                )}
                {teach && teach.length === 0 && !loadingTeach && (
                  <span className="longku-hint">
                    you already hold everything common here
                  </span>
                )}
              </div>
            </div>
          )}
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

/**
 * One chain in the log. Closed chains stay visible so a sweep reads as a
 * record of what you got through, not just whatever you're on right now.
 */
function ChainRow({
  chain,
  index,
  live = false,
}: {
  chain: BankEntry[];
  index: number;
  live?: boolean;
}) {
  return (
    <div className={`longku-chain-row ${live ? "is-live" : ""}`}>
      <span className="longku-chain-n">{index}</span>
      <ol className="longku-chain-strip">
        {chain.map((c, i) => (
          <li key={c.w}>
            {i > 0 && <span className="longku-chain-arrow">→</span>}
            <span className="longku-chain-word" title={`${c.fs} → ${c.ls ?? "?"}`}>
              {c.w}
            </span>
          </li>
        ))}
      </ol>
      <span className="longku-chain-len">{chain.length}</span>
    </div>
  );
}
