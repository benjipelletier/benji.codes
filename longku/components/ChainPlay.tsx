"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  importWords,
  playWord,
  recordMiss,
  type BankEntry,
  type State,
} from "@longku/lib/store";
import { available } from "@longku/lib/chains";
import { buildForest, placements, type ForestNode } from "@longku/lib/forest";
import { nextDueAt, dueWords, untilText } from "@longku/lib/review";
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
  /** Plan and begin a session. `force` drills the weakest when nothing is due. */
  onPlan: (opts?: { force?: boolean; firstSyllable?: string }) => void;
  /** Collapse the dock, handing the wall the space back. */
  onCollapse: () => void;
}

/**
 * The drill.
 *
 * A session is the words that came due, grouped into buckets, and it asks for
 * one syllable until that bucket is empty before moving to the next. What is
 * being asked for is therefore not a function of the last word played — it is
 * read straight off the plan — which is what let the chain-advancing machinery
 * this component used to carry come out entirely.
 */
export function ChainPlay({ state, onChange, onPlan, onCollapse }: Props) {
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [teach, setTeach] = useState<Suggestion[] | null>(null);
  const [loadingTeach, setLoadingTeach] = useState(false);
  /** Revealing what the bank offers for the current syllable. */
  const [peek, setPeek] = useState(false);
  /** Restarting is behind a confirm — it discards the session's log. */
  const [confirmReset, setConfirmReset] = useState(false);
  /** The word just played, marked briefly so the landing is visible. */
  const [landed, setLanded] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const now = Date.now();
  const bankArr = useMemo(() => Object.values(state.bank), [state]);
  const bankSize = bankArr.length;

  // What the session still owes, in plan order. A word dropped from the bank
  // mid-session is skipped rather than blocking the session's end.
  const remaining = useMemo(
    () => state.session.filter((w) => state.bank[w] && !state.sweep.includes(w)),
    [state],
  );

  /** The bucket being drilled: the syllable the next owed word starts with. */
  const need = remaining.length > 0 ? state.bank[remaining[0]].fs : "";

  /** What this bucket still owes, so the prompt can say how many are left. */
  const bucketLeft = useMemo(
    () => remaining.filter((w) => state.bank[w].fs === need),
    [remaining, state.bank, need],
  );

  const sessionDone = remaining.length === 0;
  const playedCount = state.sweep.length;
  const sessionSize = state.session.length;

  const forest = useMemo(
    () => buildForest(state.sweep, state.bank),
    [state.sweep, state.bank],
  );

  // The log grows downward and is capped, so without this a new word lands out
  // of sight once a session has a few branches in it.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.sweep.length]);

  // Clear the landing mark once its animation has run.
  useEffect(() => {
    if (!landed) return;
    const t = setTimeout(() => setLanded(null), 900);
    return () => clearTimeout(t);
  }, [landed]);

  // Moving to a new syllable closes the reveal: what it was showing was the
  // answer to a question that has been put away.
  useEffect(() => {
    setPeek(false);
    setTeach(null);
    setDraft("");
  }, [need]);

  // Chengyus from the reference corpus that start where the bucket does, for
  // the "Stuck?" reveal.
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
        setTeach(((d?.chengyus ?? []) as Suggestion[]).filter((c) => !have.has(c.w)).slice(0, 3));
      })
      .catch(() => !cancelled && setTeach([]))
      .finally(() => !cancelled && setLoadingTeach(false));
    return () => {
      cancelled = true;
    };
  }, [peek, need, state.bank]);

  /** Report where a word landed — the thing the forest is there to show. */
  const announce = useCallback(
    (word: string, played: string[]) => {
      const at = placements(played, state.bank, word);
      if (at === 0) return null;
      return `${word} — onto ${at} chain${at === 1 ? "" : "s"}.`;
    },
    [state.bank],
  );

  function commitPlay(entry: BankEntry, recalled: boolean) {
    const next = playWord(entry.w, recalled);
    onChange(next);
    setLanded(entry.w);
    setDraft("");
    setPeek(false);
    const note = announce(entry.w, next.sweep);
    setMsg(note ? { kind: "success", text: note } : null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const word = draft.trim();
    if (!word) return;

    const entry = state.bank[word];
    if (!entry) {
      setMsg({
        kind: "error",
        text: `"${word}" isn't in your bank. Add it up top, then it can be drilled.`,
      });
      return;
    }
    if (entry.fs !== need) {
      setMsg({ kind: "error", text: `"${word}" starts with ${entry.fs}, not ${need}.` });
      return;
    }
    if (state.sweep.includes(word)) {
      setMsg({ kind: "error", text: `Already played "${word}" this session.` });
      return;
    }
    commitPlay(entry, true);
  }

  function learn(s: Suggestion) {
    const { state: next } = importWords([{ w: s.w, fs: s.fs, ls: s.ls, f: s.f }]);
    onChange(next);
    setMsg({ kind: "success", text: `${s.w} added to your bank.` });
    if (!peek) setTeach(null);
  }

  /** Bank a suggested word without disturbing the drill. */
  function bank(sg: Suggestion) {
    onChange(importWords([{ w: sg.w, fs: sg.fs, ls: sg.ls, f: sg.f }]).state);
  }

  function startOver() {
    setConfirmReset(false);
    setMsg(null);
    setPeek(false);
    onPlan();
  }

  if (bankSize === 0) {
    return (
      <div className="longku-dock-inner">
        <span className="longku-dock-label">复习</span>
        <p className="longku-play-empty">
          Your bank is empty — add a chengyu up top and it&rsquo;ll come up for
          review here.
        </p>
        <button className="longku-icon-btn" onClick={onCollapse} title="Hide the drill">
          ⌄
        </button>
      </div>
    );
  }

  const controls = (
    <div className="longku-dock-controls">
      {confirmReset ? (
        <>
          <span className="longku-dock-confirm">discard this session?</span>
          <button className="longku-btn" onClick={startOver}>
            Restart
          </button>
          <button
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
            className="longku-icon-btn"
            onClick={() => setConfirmReset(true)}
            title="Plan a new session — clears this one's log"
            aria-label="Plan a new session"
          >
            ↺
          </button>
          <button
            className="longku-icon-btn"
            onClick={onCollapse}
            title="Hide the drill"
            aria-label="Hide the drill"
          >
            ⌄
          </button>
        </>
      )}
    </div>
  );

  return (
    <section aria-label="Review">
      {forest.roots.length > 0 && (
        <div className="longku-forest" ref={logRef}>
          <ol className="longku-forest-list">
            {forest.roots.map((root) => (
              <ForestBranch key={`${root.w}-${root.index}`} node={root} landed={landed} />
            ))}
          </ol>
          {forest.suppressed > 0 && (
            <p className="longku-forest-note">
              some continuations not drawn — the same words keep joining up
            </p>
          )}
        </div>
      )}

      {sessionDone ? (
        <SessionDone
          bank={bankArr}
          now={now}
          played={playedCount}
          onPlan={onPlan}
          onCollapse={onCollapse}
        />
      ) : (
        <>
          <form className="longku-dock-inner" onSubmit={submit}>
            <span className="longku-dock-label">复习</span>
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
                Recall
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
                    width: `${Math.round((playedCount / Math.max(1, sessionSize)) * 100)}%`,
                  }}
                />
              </div>
              <span className="longku-sweep-text">
                {playedCount} / {sessionSize}
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
                      onClick={() => commitPlay(e, false)}
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
                  <span className="longku-hint">you already hold everything common here</span>
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
              {bucketLeft.length} due for {need}
              {bucketLeft.length !== remaining.length &&
                ` · ${remaining.length - bucketLeft.length} after this bucket`}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/**
 * One node and everything hanging off it, flattened.
 *
 * A flat list indented by depth rather than nested lists: the log scrolls in a
 * small box, and a nested structure wraps its own indentation into a column an
 * inch wide once a phone runs out of room.
 */
function ForestBranch({ node, landed }: { node: ForestNode; landed: string | null }) {
  return (
    <>
      <li
        className={`longku-forest-node ${node.depth === 1 ? "is-root" : ""}`}
        style={{ paddingLeft: `${(node.depth - 1) * 16}px` }}
      >
        {node.depth > 1 && (
          <span className="longku-forest-arrow" aria-hidden>
            ↳
          </span>
        )}
        <span
          className={`longku-chain-word ${landed === node.w ? "is-landed" : ""}`}
          title={`depth ${node.depth}`}
        >
          {node.w}
        </span>
        {node.cut && (
          <span className="longku-forest-cut" title="more continuations than fit">
            +{node.hidden}
          </span>
        )}
      </li>
      {node.children.map((c) => (
        <ForestBranch key={`${c.w}-${c.index}-${c.depth}`} node={c} landed={landed} />
      ))}
    </>
  );
}

/**
 * The end of a session.
 *
 * The old sweep ended only when the bank was exhausted, so this screen was a
 * rare event and could afford to say nothing but "start another". Now it is
 * the normal way a day finishes, and the useful thing it can say is when the
 * next one is — which is a fact about the bank, not about the session.
 */
function SessionDone({
  bank,
  now,
  played,
  onPlan,
  onCollapse,
}: {
  bank: BankEntry[];
  now: number;
  played: number;
  onPlan: (opts?: { force?: boolean }) => void;
  onCollapse: () => void;
}) {
  const due = dueWords(bank, now).length;
  const next = nextDueAt(bank, now);

  return (
    <div className="longku-play-done">
      <p className="longku-input-msg is-success">
        {played > 0
          ? `Done for today — ${played} word${played === 1 ? "" : "s"} reviewed.`
          : "Nothing due right now."}{" "}
        {due > 0 ? (
          <span className="longku-done-next">
            {due} more {due === 1 ? "is" : "are"} due.
          </span>
        ) : (
          next !== null && (
            <span className="longku-done-next">Next {untilText(next, now)}.</span>
          )
        )}
      </p>
      <div className="longku-dock-inner">
        {due > 0 ? (
          <button className="longku-btn is-primary" onClick={() => onPlan()}>
            Keep going
          </button>
        ) : (
          <button className="longku-btn" onClick={() => onPlan({ force: true })}>
            Drill anyway
          </button>
        )}
        <button className="longku-icon-btn" onClick={onCollapse} title="Hide the drill">
          ⌄
        </button>
      </div>
    </div>
  );
}
