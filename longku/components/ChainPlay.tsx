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

/**
 * Top corpus suggestion per starting syllable, cached across rows.
 *
 * Every closed chain in the log wants the most frequent chengyu that would
 * have continued it. Several chains often end on the same syllable, and the
 * log re-renders on every keystroke, so the fetch is memoised by syllable and
 * shared rather than repeated per row.
 */
const topCache = new Map<string, Promise<Suggestion[]>>();

function topForSyllable(syl: string): Promise<Suggestion[]> {
  let p = topCache.get(syl);
  if (!p) {
    p = fetch(`/api/longku/syllable/${encodeURIComponent(syl)}?limit=8`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d?.chengyus ?? []) as Suggestion[])
      .catch(() => []);
    topCache.set(syl, p);
  }
  return p;
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

  /** Bank a suggested word without disturbing the chain in progress. */
  function bank(sg: Suggestion) {
    const { state: added } = importWords([{ w: sg.w, fs: sg.fs, ls: sg.ls, f: sg.f }]);
    onChange(added);
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
            <ChainRow
              key={`done-${i}`}
              chain={c}
              index={i + 1}
              bank={state.bank}
              onBank={bank}
            />
          ))}
          {chain.length > 0 && (
            <ChainRow
              chain={chain}
              index={history.length + 1}
              bank={state.bank}
              onBank={bank}
              live
            />
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
            Nothing in your bank starts with <strong>{need}</strong> — chain
            finished{chain.length > 0 ? ` at ${chain.length}` : ""}.
          </p>
          <div className="longku-peek-row">
            <span className="longku-peek-label">worth learning for {need}</span>
            {loadingTeach && <span className="longku-hint">looking…</span>}
            {teach && teach.length > 0 && (
              <div className="longku-peek-words">
                {teach.map((sg) => (
                  <button
                    key={sg.w}
                    type="button"
                    className="longku-peek-word is-new"
                    onClick={() => learn(sg)}
                    title={`${sg.p} · ${sg.fs} → ${sg.ls} · not in your bank`}
                  >
                    {sg.w}
                    <TierPill f={sg.f} />
                  </button>
                ))}
              </div>
            )}
            {teach && teach.length === 0 && !loadingTeach && (
              <span className="longku-hint">nothing new in the corpus either</span>
            )}
            <button className="longku-btn longku-stuck-next" onClick={newChain}>
              New chain ({remaining.length} left)
            </button>
          </div>
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
              </div>

              {/* What you could add. Adding is deliberately separate from
                  playing: a word you were just shown hasn't been recalled, and
                  counting it as one would make the recall number a lie. */}
              <div className="longku-peek-add">
                <span className="longku-peek-label">worth learning for {need}</span>
                {loadingTeach && <span className="longku-hint">looking…</span>}
                {teach && teach.length > 0 && (
                  <div className="longku-peek-words">
                    {teach.map((sg) => (
                      <button
                        key={sg.w}
                        type="button"
                        className="longku-peek-word is-new"
                        onClick={() => learn(sg)}
                        title={`${sg.p} · ${sg.fs} → ${sg.ls} · not in your bank`}
                      >
                        {sg.w}
                        <TierPill f={sg.f} />
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
  bank,
  onBank,
  live = false,
}: {
  chain: BankEntry[];
  index: number;
  /** Words already held, so a suggestion is never something you own. */
  bank: Record<string, BankEntry>;
  onBank: (s: Suggestion) => void;
  live?: boolean;
}) {
  const endsOn = chain.length > 0 ? chain[chain.length - 1].ls : null;
  const [next, setNext] = useState<Suggestion | null>(null);

  // What the most frequent continuation would have been. The endpoint returns
  // the bucket already ranked by corpus frequency, so the first word not
  // already held is the most frequent one worth learning.
  useEffect(() => {
    if (!endsOn) {
      setNext(null);
      return;
    }
    let cancelled = false;
    topForSyllable(endsOn).then((list) => {
      if (cancelled) return;
      setNext(list.find((c) => !bank[c.w]) ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [endsOn, bank]);

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
        {next && (
          <li>
            <span className="longku-chain-arrow">→</span>
            <button
              type="button"
              className="longku-chain-next"
              onClick={() => onBank(next)}
              title={`${next.p} — not in your bank. Learn it and this chain goes on.`}
            >
              {next.w}
              <TierPill f={next.f} />
            </button>
          </li>
        )}
      </ol>
      <span className="longku-chain-len">{chain.length}</span>
    </div>
  );
}
