"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getState,
  importWords,
  linkWord,
  playBridge,
  playWord,
  recordMiss,
  startChain,
  resetSweep,
  type BankEntry,
  type Bridge,
  type Link,
  type State,
} from "@longku/lib/store";
import { available, pickChainStart, unused } from "@longku/lib/chains";
import { TierPill } from "./AddChengyu";
import { dayStart, dueAt, isDue } from "@longku/lib/srs";

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
  /** Bumped by the caller to break the chain and carry on from a chosen syllable. */
  startAt: { syl: string; nonce: number };
  /** Collapse the dock, handing the wall the space back. */
  onCollapse: () => void;
}

const PRACTICE_KEY = "longku:practice";

/**
 * The last jump request acted on. Module-level so it outlives the component:
 * collapsing and reopening the dock remounts it with the same request, which
 * must not break the chain a second time.
 */
let handledJump = 0;

/** Where a link leaves the chain — null for a bank word with no known ending. */
function linkEnd(l: Link, bank: Record<string, BankEntry>): string | null {
  return typeof l === "string" ? (bank[l]?.ls ?? null) : l.ls;
}

/** The last link of the pass, if it has one. */
function lastLink(s: State): Link | null {
  for (let i = s.chains.length - 1; i >= 0; i--) {
    const seg = s.chains[i];
    if (seg.length > 0) return seg[seg.length - 1];
  }
  return null;
}

/**
 * Syllables the bank can still answer, most in need of practice first.
 *
 * A bridge lands on whichever of these it reaches in the fewest words, so this
 * order only decides between bridges of equal length — enough to steer the
 * pass toward weak words without making you read further to get to them.
 */
function targets(s: State, practice: boolean): string[] {
  const weakest = new Map<string, number>();
  for (const e of unused(s, practice)) {
    const had = weakest.get(e.fs);
    if (had === undefined || (e.strength ?? 0) < had) weakest.set(e.fs, e.strength ?? 0);
  }
  return [...weakest.entries()].sort((a, b) => a[1] - b[1]).map(([syl]) => syl);
}

/**
 * The 接龙 game: one chain through the whole bank.
 *
 * You play every bank word once, and the pass ends when there are none left.
 * Where your bank has nothing starting on the syllable the chain needs, the app
 * bridges with one to three corpus words to a syllable it does — so the chain
 * keeps going instead of fragmenting into one-word stubs, and every bridge is a
 * word that would have joined your bank to itself.
 */
export function ChainPlay({ state, onChange, startAt, onCollapse }: Props) {
  const [need, setNeed] = useState<string>("");
  const [bridging, setBridging] = useState(false);
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [teach, setTeach] = useState<Suggestion[] | null>(null);
  const [loadingTeach, setLoadingTeach] = useState(false);
  /**
   * How much help is showing for the current syllable: none, the meanings of
   * the words that would answer it, or the words themselves.
   */
  const [help, setHelp] = useState<0 | 1 | 2>(0);
  const peek = help === 2;
  const setPeek = (open: boolean) => setHelp(open ? 2 : 0);
  /** Meanings of the words under the current prompt, once asked for. */
  const [hints, setHints] = useState<Record<string, string> | null>(null);
  /** Restart is behind a confirm — it discards the whole pass. */
  const [confirmReset, setConfirmReset] = useState(false);
  /** Words just added to the chain, marked briefly so the landing is visible. */
  const [landed, setLanded] = useState<Set<string>>(new Set());
  /**
   * Playing the whole bank unscored, for when nothing is due. Remembered per
   * device so a reload mid-practice doesn't turn it into a scored pass.
   */
  // Read before the first render, not in an effect: a scored first render
  // would try to resume the practice chain as a due pass. This component only
  // mounts client-side, after the bank has loaded, so storage is there to read.
  const [practice, setPracticeState] = useState(() => {
    try {
      return localStorage.getItem(PRACTICE_KEY) === "1";
    } catch {
      return false;
    }
  });
  function setPractice(on: boolean) {
    setPracticeState(on);
    try {
      localStorage.setItem(PRACTICE_KEY, on ? "1" : "0");
    } catch {
      // As above.
    }
  }
  /** Guards against a slow bridge landing after the chain has moved on. */
  const bridgeReq = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);

  const links = useMemo(() => state.chains.flat(), [state.chains]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [links.length]);

  useEffect(() => {
    if (landed.size === 0) return;
    const t = setTimeout(() => setLanded(new Set()), 900);
    return () => clearTimeout(t);
  }, [landed]);

  const remaining = useMemo(() => unused(state, practice), [state, practice]);
  /** Due words, whatever the mode — what a practice round is standing in for. */
  const dueNow = useMemo(() => (practice ? unused(state).length : remaining.length), [
    state,
    practice,
    remaining.length,
  ]);
  const bankSize = Object.keys(state.bank).length;
  // Words of yours on the chain: in a due pass, what's been reviewed so far.
  const doneThisSweep = state.chains.flat().filter((l) => typeof l === "string").length;
  /** What this pass asks for: what's been played, plus what's still due. */
  const passSize = practice ? bankSize : doneThisSweep + remaining.length;
  /**
   * Sticky once reached: banking a bridge from the end screen adds an unplayed
   * word, and without this the finished pass would reopen under your cursor.
   */
  const [finished, setFinished] = useState(false);
  useEffect(() => {
    // Only a pass that happened can finish; an empty one is just nothing due,
    // and should start by itself the moment something is.
    if (remaining.length === 0 && links.length > 0) setFinished(true);
  }, [remaining.length, links.length]);
  const sweepDone = finished || remaining.length === 0;

  /** Break the chain and pick it up somewhere the bank can answer. */
  const jump = useCallback(() => {
    const start = pickChainStart(getState(), practice);
    if (!start) {
      setNeed("");
      return;
    }
    onChange(startChain());
    setNeed(start.fs);
  }, [onChange, practice]);

  /**
   * Move the chain on from `syl`.
   *
   * Reads the store directly rather than the `state` prop: this runs straight
   * after a play, before React has handed the new state back down, and the old
   * prop would still count the word just played as available.
   */
  const advance = useCallback(
    (syl: string | null) => {
      const s = getState();
      // Supersedes any bridge still in flight, whose own cleanup is now skipped.
      bridgeReq.current++;
      setBridging(false);
      if (syl && available(s, syl, practice).length > 0) {
        setNeed(syl);
        return;
      }
      if (unused(s, practice).length === 0) {
        setNeed("");
        return;
      }
      // Nothing to bridge from: a word with no known ending closes its segment.
      if (!syl) {
        jump();
        return;
      }

      const req = bridgeReq.current;
      setNeed("");
      setBridging(true);
      const exclude = [
        ...Object.keys(s.bank),
        ...s.chains.flat().filter((l): l is Bridge => typeof l !== "string").map((l) => l.w),
      ];
      fetch("/api/longku/bridge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: syl, to: targets(s, practice), exclude }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (req !== bridgeReq.current) return;
          const path = (d?.path ?? []) as Omit<Bridge, "bridge">[];
          const end = path[path.length - 1];
          if (!end) {
            jump();
            return;
          }
          onChange(playBridge(path));
          setLanded(new Set(path.map((b) => b.w)));
          if (available(getState(), end.ls, practice).length > 0) setNeed(end.ls);
          else jump();
        })
        .catch(() => req === bridgeReq.current && jump())
        .finally(() => req === bridgeReq.current && setBridging(false));
    },
    [onChange, jump, practice],
  );

  /** Pick the pass up from wherever the chain stands. */
  const resume = useCallback(() => {
    const s = getState();
    const last = lastLink(s);
    if (!last) {
      const start = pickChainStart(s, practice);
      setNeed(start?.fs ?? "");
      return;
    }
    advance(linkEnd(last, s.bank));
  }, [advance, practice]);

  // Whenever the prompt can't be answered — on first open, after a reset, or
  // because a word under it was removed — work out where the chain goes next.
  useEffect(() => {
    if (bridging || sweepDone || remaining.length === 0) return;
    if (need && available(state, need, practice).length > 0) return;
    resume();
  }, [state, need, bridging, sweepDone, remaining.length, resume]);

  // Break the chain and restart from a syllable the caller chose.
  useEffect(() => {
    if (!startAt.nonce || !startAt.syl || startAt.nonce === handledJump) return;
    handledJump = startAt.nonce;
    onChange(startChain());
    advance(startAt.syl);
    setDraft("");
    setMsg(null);
    setPeek(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startAt.syl, startAt.nonce]);

  // Corpus words starting where the chain needs to go, for the "Stuck?" reveal.
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

  // Help belongs to one prompt; a new syllable starts from none.
  useEffect(() => {
    setHelp(0);
    setHints(null);
  }, [need]);

  // Meanings for the hint: only the words that would answer this prompt, and
  // only their definitions — the characters are what you're trying to recall.
  useEffect(() => {
    if (help === 0 || !need) {
      setHints(null);
      return;
    }
    if (hints) return;
    let cancelled = false;
    const words = available(state, need, practice).map((e) => e.w);
    const qs = words.map((w) => `w=${encodeURIComponent(w)}`).join("&");
    fetch(`/api/longku/gloss?${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setHints(d?.glosses ?? {}))
      .catch(() => !cancelled && setHints({}));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [help, need]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const word = draft.trim();
    if (!word || !need) return;

    const entry = state.bank[word];
    if (!entry) {
      setMsg({
        kind: "error",
        text: `"${word}" isn't in your bank. Add it up top, then it can join the chain.`,
      });
      return;
    }
    if (entry.fs !== need) {
      setMsg({ kind: "error", text: `"${word}" starts with ${entry.fs}, not ${need}.` });
      return;
    }
    // Practice covers each word once. A due pass goes by the schedule: a word
    // already on the chain can't be replayed unless it has come due again,
    // as one played yesterday on a chain left unfinished can.
    const repeat = practice ? state.sweep.includes(word) : links.includes(word) && !isDue(entry);
    if (repeat) {
      setMsg({ kind: "error", text: `"${word}" is already in this chain.` });
      return;
    }

    // Recalled from its meaning: still yours, but it counts for half.
    onChange(playWord(word, true, help === 1 ? 0.5 : 1, practice));
    setLanded(new Set([word]));
    setDraft("");
    setMsg(null);
    setPeek(false);
    advance(entry.ls);
  }

  /** Bank a corpus word without disturbing the chain. */
  function bank(sg: Suggestion) {
    const { state: next } = importWords([{ w: sg.w, fs: sg.fs, ls: sg.ls, f: sg.f }]);
    onChange(next);
  }

  function learn(s: Suggestion) {
    bank(s);
    setMsg({ kind: "success", text: `${s.w} added to your bank — play it to carry on.` });
  }

  /** Play a word the user was shown rather than recalled. */
  function play(entry: BankEntry) {
    onChange(playWord(entry.w, false, 1, practice));
    setLanded(new Set([entry.w]));
    setDraft("");
    setMsg(null);
    setPeek(false);
    advance(entry.ls);
  }

  function startOver() {
    bridgeReq.current++;
    setBridging(false);
    onChange(resetSweep());
    setFinished(false);
    setNeed("");
    setConfirmReset(false);
    setMsg(null);
    setPeek(false);
  }

  /** Switch between a due pass and practice. Either way the chain starts fresh. */
  function switchMode(toPractice: boolean) {
    setPractice(toPractice);
    startOver();
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

  const offered = need ? available(state, need, practice) : [];
  const bridges = links.filter((l): l is Bridge => typeof l !== "string");
  const yours = links.length - bridges.length;

  const controls = (
    <div className="longku-dock-controls">
      {confirmReset ? (
        <>
          <span className="longku-dock-confirm">discard this pass?</span>
          <button type="button" className="longku-btn" onClick={startOver}>
            Restart
          </button>
          <button
            type="button"
            className="longku-icon-btn"
            onClick={() => setConfirmReset(false)}
            title="Keep it"
          >
            ✕
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="longku-icon-btn"
            onClick={() => setConfirmReset(true)}
            title="Restart the pass — clears the chain"
            aria-label="Restart the pass"
          >
            ↺
          </button>
          <button
            type="button"
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
      {links.length > 0 && (
        <div className="longku-chain-log" ref={logRef}>
          <div className="longku-chain-row is-live">
            <ol className="longku-chain-strip">
              {state.chains.map((seg, si) =>
                seg.map((l, i) => {
                  const w = linkWord(l);
                  const first = i === 0;
                  const isLast = si === state.chains.length - 1 && i === seg.length - 1;
                  return (
                    <li key={`${si}-${i}-${w}`}>
                      {first && state.chains.slice(0, si).some((p) => p.length > 0) && (
                        <span className="longku-chain-break" title="the chain broke here">
                          ⋯
                        </span>
                      )}
                      {!first && <span className="longku-chain-arrow">→</span>}
                      {typeof l === "string" ? (
                        <span
                          className={`longku-chain-word ${isLast ? "" : "is-past"} ${landed.has(w) ? "is-landed" : ""}`}
                          title={`${state.bank[w]?.fs ?? "?"} → ${state.bank[w]?.ls ?? "?"}`}
                        >
                          {w}
                        </span>
                      ) : (
                        <BridgeLink
                          link={l}
                          banked={!!state.bank[l.w]}
                          landed={landed.has(w)}
                          onBank={() => bank(l)}
                        />
                      )}
                    </li>
                  );
                }),
              )}
            </ol>
            <span className="longku-chain-len" title="words you played · bridges read">
              {yours}
              {bridges.length > 0 && <span className="longku-chain-len-b"> +{bridges.length}</span>}
            </span>
          </div>
        </div>
      )}

      {sweepDone ? (
        <PassDone
          yours={yours}
          bridges={bridges}
          bank={state.bank}
          dueNow={dueNow}
          practice={practice}
          onBank={bank}
          onRestart={startOver}
          onMode={switchMode}
          onCollapse={onCollapse}
        />
      ) : (
        <>
          <form className="longku-play" onSubmit={submit}>
            <div className="longku-play-head">
              <span className="longku-dock-label">接龙</span>
              {practice && (
                <button
                  type="button"
                  className="longku-practice-tag"
                  onClick={() => switchMode(false)}
                  title="Practice — nothing here is scored. Click to end it."
                >
                  practice{dueNow > 0 ? ` · ${dueNow} due` : ""} ✕
                </button>
              )}
              <label className="longku-play-prompt" htmlFor="longku-chain-input">
                {need ? (
                  <>
                    starting with <strong>{need}</strong>
                  </>
                ) : (
                  <span className="longku-hint">{bridging ? "bridging…" : "…"}</span>
                )}
              </label>
              <div className="longku-sweep">
                <div className="longku-sweep-bar">
                  <div
                    className="longku-sweep-fill"
                    style={{
                      width: `${Math.round((doneThisSweep / Math.max(1, passSize)) * 100)}%`,
                    }}
                  />
                </div>
                <span className="longku-sweep-text">
                  {doneThisSweep} / {passSize}
                </span>
              </div>
              {controls}
            </div>
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
              <button className="longku-btn is-primary" type="submit" disabled={!need}>
                Chain it
              </button>
              <button
                type="button"
                className="longku-btn"
                disabled={!need}
                onClick={() => {
                  if (help === 2) {
                    setHelp(0);
                    return;
                  }
                  // Seeing the words is evidence: every one sitting there was
                  // available under this prompt and none was produced. Seeing
                  // their meanings isn't — you may still produce one.
                  if (help === 1 && !practice) onChange(recordMiss(need));
                  setHelp(help === 0 ? 1 : 2);
                }}
                aria-expanded={help > 0}
                title={
                  help === 0
                    ? "Show what your words for this syllable mean"
                    : help === 1
                      ? "Show the words themselves"
                      : "Hide"
                }
              >
                {help === 0 ? "Stuck?" : help === 1 ? "Show words" : "Hide"}
              </button>
            </div>
          </form>
          {help === 1 && need && (
            <div className="longku-peek">
              <span className="longku-peek-label">
                {offered.length === 1
                  ? `your ${need} word means`
                  : `your ${need} words mean`}
              </span>
              {!hints ? (
                <span className="longku-hint">looking…</span>
              ) : (
                <ol className="longku-hint-list">
                  {offered.map((e) => (
                    <li key={e.w}>
                      {hints[e.w] || (
                        <span className="longku-hint">no definition — {e.fs} → {e.ls ?? "?"}</span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
          {peek && need && (
            <div className="longku-peek">
              <span className="longku-peek-label">
                {practice ? "in your bank" : "due in your bank"}, starting with {need}
              </span>
              <div className="longku-peek-words">
                {offered.map((e) => (
                  <button
                    key={e.w}
                    type="button"
                    className="longku-peek-word"
                    onClick={() => play(e)}
                    title={`${e.fs} → ${e.ls ?? "?"} · ${e.recalls} recall${e.recalls === 1 ? "" : "s"}`}
                  >
                    {e.w}
                  </button>
                ))}
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
            need && (
              <p className="longku-play-sub" style={{ marginTop: 6 }}>
                {offered.length} {practice ? "" : "due "}in your bank start with {need}
              </p>
            )
          )}
        </>
      )}
    </section>
  );
}

/**
 * A corpus word the app played. Dashed, like every unbanked suggestion, and a
 * button: banking it is the one action that would have made it unnecessary.
 */
function BridgeLink({
  link,
  banked,
  landed,
  onBank,
}: {
  link: Bridge;
  banked: boolean;
  landed: boolean;
  onBank: () => void;
}) {
  const detail = `${link.p}${link.e ? ` — ${link.e}` : ""}`;
  return (
    <button
      type="button"
      className={`longku-chain-next longku-chain-bridge ${banked ? "is-banked" : ""} ${landed ? "is-landed" : ""}`}
      onClick={banked ? undefined : onBank}
      disabled={banked}
      title={banked ? `${detail} · now in your bank` : `${detail} · bridge — click to bank it`}
    >
      {link.w}
      {!banked && <TierPill f={link.f} />}
    </button>
  );
}

const WORTH_SHOWN = 12;

/**
 * The end of a pass. The bridges it needed are the best case for what to learn
 * next: each one sat exactly where your bank had a gap.
 */
function PassDone({
  yours,
  bridges,
  bank,
  dueNow,
  practice,
  onBank,
  onRestart,
  onMode,
  onCollapse,
}: {
  yours: number;
  bridges: Bridge[];
  bank: Record<string, BankEntry>;
  /** Words due since the pass ended — banked from here, or a day turning over. */
  dueNow: number;
  practice: boolean;
  onBank: (s: Suggestion) => void;
  /** Start a practice pass (true) or go back to due words (false). */
  onMode: (practice: boolean) => void;
  onRestart: () => void;
  onCollapse: () => void;
}) {
  const worth = [...new Map(bridges.filter((b) => !bank[b.w]).map((b) => [b.w, b])).values()].sort(
    (a, b) => (b.f ?? 0) - (a.f ?? 0),
  );
  // A small bank needs dozens of bridges; the commonest few are the case for
  // learning, and the rest are still on the chain above.
  const shown = worth.slice(0, WORTH_SHOWN);
  const next = nextDue(bank);
  return (
    <div className="longku-play-done">
      {practice ? (
        <p className="longku-input-msg is-success">
          Practice complete — all {yours} word{yours === 1 ? "" : "s"}
          {bridges.length > 0 &&
            `, joined by ${bridges.length} bridge${bridges.length === 1 ? "" : "s"}`}
          . Nothing was scored.
        </p>
      ) : yours + bridges.length > 0 ? (
        <p className="longku-input-msg is-success">
          Pass complete — {yours} due word{yours === 1 ? "" : "s"} played
          {bridges.length > 0 &&
            `, joined by ${bridges.length} bridge${bridges.length === 1 ? "" : "s"}`}
          .
        </p>
      ) : (
        <p className="longku-input-msg is-success">Nothing is due right now.</p>
      )}
      {next && dueNow === 0 && (
        <p className="longku-hint" style={{ margin: 0 }}>
          Next: {next.count} word{next.count === 1 ? "" : "s"} due {next.when}.
        </p>
      )}
      {worth.length > 0 && (
        <div className="longku-peek-add">
          <span className="longku-peek-label">bridges worth banking</span>
          <div className="longku-peek-words">
            {shown.map((b) => (
              <button
                key={b.w}
                type="button"
                className="longku-peek-word is-new"
                onClick={() => onBank(b)}
                title={`${b.p}${b.e ? ` — ${b.e}` : ""}`}
              >
                {b.w}
                <TierPill f={b.f} />
              </button>
            ))}
            {worth.length > shown.length && (
              <span className="longku-hint">+{worth.length - shown.length} more on the chain</span>
            )}
          </div>
        </div>
      )}
      <div className="longku-dock-inner">
        {dueNow > 0 ? (
          <button
            className="longku-btn is-primary"
            onClick={practice ? () => onMode(false) : onRestart}
          >
            Start a new pass · {dueNow} due
          </button>
        ) : practice ? (
          <>
            <button className="longku-btn is-primary" onClick={onRestart}>
              Practice again
            </button>
            <button className="longku-btn" onClick={() => onMode(false)}>
              Done
            </button>
          </>
        ) : (
          <button
            className="longku-btn is-primary"
            onClick={() => onMode(true)}
            title="Every word in your bank, once each. Nothing is scored or rescheduled."
          >
            Practice the whole deck
          </button>
        )}
        <button className="longku-icon-btn" onClick={onCollapse} title="Hide the chain game">
          ⌄
        </button>
      </div>
    </div>
  );
}

/** The next day anything falls due, and how much does. */
function nextDue(bank: Record<string, BankEntry>): { when: string; count: number } | null {
  const now = Date.now();
  let first = Infinity;
  const byDay = new Map<number, number>();
  for (const e of Object.values(bank)) {
    const due = dueAt(e);
    if (due <= now) continue;
    const day = dayStart(due);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
    if (day < first) first = day;
  }
  if (!Number.isFinite(first)) return null;
  const days = Math.round((first - dayStart(now)) / 86_400_000);
  const when =
    days <= 1
      ? "tomorrow"
      : days < 7
        ? `on ${new Date(first).toLocaleDateString(undefined, { weekday: "long" })}`
        : `in ${days} days`;
  return { when, count: byDay.get(first) ?? 0 };
}
