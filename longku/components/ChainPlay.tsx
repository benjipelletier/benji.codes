"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  importWords,
  playWord,
  recordMiss,
  startChain,
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
  /** Collapse the dock, handing the wall the space back. */
  onCollapse: () => void;
}

export function ChainPlay({ state, onChange, startAt, onRerollStart, onCollapse }: Props) {
  const [need, setNeed] = useState<string>("");
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [teach, setTeach] = useState<Suggestion[] | null>(null);
  const [loadingTeach, setLoadingTeach] = useState(false);
  /** Revealing what the bank offers for the current syllable. */
  const [peek, setPeek] = useState(false);
  /** Restart is behind a confirm — it discards the whole chain log. */
  const [confirmReset, setConfirmReset] = useState(false);
  /** The word just played, marked briefly so the landing is visible. */
  const [landed, setLanded] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // The sweep's chains live in the store so they survive a reload, and are
  // rendered as bank entries here. A word removed from the bank mid-sweep is
  // dropped rather than rendered as a hole.
  // Empty chains are kept: the one being built is the last entry whether or not
  // it has words yet, and dropping it would mark the chain just finished as
  // live — hiding the very suggestion that explains why it ended.
  const chains = useMemo(
    () => state.chains.map((c) => c.map((w) => state.bank[w]).filter(Boolean)),
    [state],
  );

  /** The chain in progress: whatever the store's last chain holds. */
  const chain = chains.length > 0 ? chains[chains.length - 1] : [];

  // The log grows downward and is capped, so without this a new chain lands
  // out of sight once there are more than a few.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.sweep.length, state.chains.length]);

  // Clear the landing mark once its animation has run.
  useEffect(() => {
    if (!landed) return;
    const t = setTimeout(() => setLanded(null), 900);
    return () => clearTimeout(t);
  }, [landed]);

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
    onChange(startChain());
    // Through advance, not straight to setNeed: the caller's syllable may have
    // nothing unused left behind it — a bucket whose only word was already
    // played this sweep — and prompting for it strands the game on a syllable
    // that can never be answered.
    advance(startAt.syl);
    setDraft("");
    setMsg(null);
    setTeach(null);
    setPeek(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startAt.syl, startAt.nonce]);

  /**
   * Move to `syl`, or open a new chain if nothing in the bank starts there.
   *
   * A dead end used to stop everything behind a button, which asked the user to
   * confirm a decision the app had already made — there was no other move. Now
   * the next chain starts immediately and the finished one carries the
   * explanation in the log, where it stays visible instead of being dismissed.
   */
  const advance = useCallback(
    (syl: string | null) => {
      if (syl && available(state, syl).length > 0) {
        setNeed(syl);
        return;
      }
      const start = pickChainStart(state);
      if (!start) {
        setNeed("");
        return;
      }
      onChange(startChain());
      setNeed(start.fs);
    },
    [state, onChange],
  );

  // Chengyus from the reference corpus that start where the chain needs to go,
  // for the "Stuck?" reveal. A dead end no longer asks for these — the finished
  // chain in the log shows its own continuation.
  useEffect(() => {
    if (!peek || !need) {
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
  }, [peek, need, state.bank]);

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

    onChange(playWord(word, true));
    setLanded(word);
    setDraft("");
    setMsg(null);
    setPeek(false);
    advance(entry.ls);
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
    onChange(startChain());
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

  /** Play a word the user was shown rather than recalled. */
  function play(entry: BankEntry) {
    onChange(playWord(entry.w, false));
    setLanded(entry.w);
    setDraft("");
    setMsg(null);
    setPeek(false);
    advance(entry.ls);
  }

  function startOver() {
    onChange(resetSweep());
    setConfirmReset(false);
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
        <button className="longku-icon-btn" onClick={onCollapse} title="Hide the chain game">
          ⌄
        </button>
      </div>
    );
  }

  const sweepDone = remaining.length === 0;

  const controls = (
    <div className="longku-dock-controls">
      {confirmReset ? (
        <>
          <span className="longku-dock-confirm">
            discard {chains.filter((c) => c.length > 0).length} chains?
          </span>
          <button className="longku-btn" onClick={startOver}>
            Restart
          </button>
          <button className="longku-icon-btn" onClick={() => setConfirmReset(false)} title="Keep them">
            ✕
          </button>
        </>
      ) : (
        <>
          <button
            className="longku-icon-btn"
            onClick={() => setConfirmReset(true)}
            title="Restart the sweep — clears the chain log"
            aria-label="Restart the sweep"
          >
            ↺
          </button>
          <button
            className="longku-icon-btn"
            onClick={onCollapse}
            title="Hide the chain game"
            aria-label="Hide the chain game"
          >
            ⌄
          </button>
        </>
      )}
    </div>
  );

  return (
    <section aria-label="Play">
      {chains.some((c) => c.length > 0) && (
        <div className="longku-chain-log" ref={logRef}>
          {chains.map((c, i) =>
            c.length === 0 ? null : (
              <ChainRow
                key={i}
                chain={c}
                index={i + 1}
                bank={state.bank}
                onBank={bank}
                live={i === chains.length - 1}
                landed={landed}
              />
            ),
          )}
        </div>
      )}

      {sweepDone ? (
        <div className="longku-play-done">
          <p className="longku-input-msg is-success">
            Every chengyu in your bank has been through a chain. That&rsquo;s the whole
            sweep.
          </p>
          <div className="longku-dock-inner">
            <button className="longku-btn is-primary" onClick={startOver}>
              Start a new sweep
            </button>
            <button className="longku-icon-btn" onClick={onCollapse} title="Hide the chain game">
              ⌄
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
                onClick={() => {
                  // Opening the list is evidence: every word sitting there was
                  // available under this prompt and none was produced.
                  if (!peek) onChange(recordMiss(need));
                  setPeek((p) => !p);
                }}
                aria-expanded={peek}
                title="Show what your bank offers for this syllable"
              >
                {peek ? "Hide" : "Stuck?"}
              </button>
            </div>
            {controls}
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
  landed = null,
}: {
  chain: BankEntry[];
  index: number;
  /** Words already held, so a suggestion is never something you own. */
  bank: Record<string, BankEntry>;
  onBank: (s: Suggestion) => void;
  live?: boolean;
  /** Word played a moment ago, if it's in this chain. */
  landed?: string | null;
}) {
  const endsOn = chain.length > 0 ? chain[chain.length - 1].ls : null;
  const [next, setNext] = useState<Suggestion | null>(null);

  // The single most frequent word that would have carried this chain on, shown
  // as its last link. Only for finished chains: offering a word for the chain
  // in progress reads as the answer to the prompt you're filling.
  useEffect(() => {
    if (!endsOn || live) {
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
  }, [endsOn, bank, live]);

  return (
    <div className={`longku-chain-row ${live ? "is-live" : ""}`}>
      <span className="longku-chain-n">{index}</span>
      <ol className="longku-chain-strip">
        {chain.map((c, i) => (
          <li key={c.w}>
            {i > 0 && <span className="longku-chain-arrow">→</span>}
            <span
              className={`longku-chain-word ${landed === c.w ? "is-landed" : ""}`}
              title={`${c.fs} → ${c.ls ?? "?"}`}
            >
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
