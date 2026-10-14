"use client";

// Fast review: every Read card due, as a grid of words to scroll through.
//
// Cards start grey: not looked at yet. Scrolling brings them up, and a card
// whose whole cell has risen into the top two thirds of the grid turns
// ungreyed and counts as Got it, unless it was tapped, which marks it
// forgotten (and shows what it means). Holding a card shows its answer in a
// popup while held, and marks it forgotten too. Nothing is sent until Done, and Done
// first shows what the answers would do, to be confirmed.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FastCard, ReviewInput } from "@chongfuxi/lib/api";
import { get, today } from "@chongfuxi/lib/client";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import * as outbox from "@chongfuxi/lib/outbox";
import * as resume from "@chongfuxi/lib/resume";
import { newId } from "@chongfuxi/lib/upload";
import { fmt, message, span, useBackLayer, type Shell } from "./shared";

const PAGE = 150;
/** Fetch more when fewer than this many cards are left below what has been uncovered. */
const AHEAD = 60;

/** Where the next waits fall, for the confirm page. */
const BUCKETS = [
  { label: "Within a week", max: 7 },
  { label: "1 to 4 weeks", max: 28 },
  { label: "1 to 3 months", max: 91 },
  { label: "3 months or more", max: Infinity },
] as const;

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export function FastReview({
  shell,
  onEnd,
  saved,
}: {
  shell: Shell;
  onEnd: () => void;
  /** Where this sweep was left today: the cards loaded, the ones marked forgotten, how far down. */
  saved: resume.FastResume | null;
}) {
  const { canWrite, refresh } = shell;
  const [cards, setCards] = useState<FastCard[]>(saved?.cards ?? []);
  const [total, setTotal] = useState<number | null>(saved?.total ?? null);
  const [error, setError] = useState<string | null>(null);
  const [forgot, setForgot] = useState<Set<number>>(() => new Set(saved?.forgot ?? []));
  // How many cards, from the top, have risen far enough to count.
  const [uncovered, setUncovered] = useState(0);
  const [stage, setStage] = useState<"grid" | "confirm" | "sending" | "done">("grid");
  const [sent, setSent] = useState(0);
  const [outcome, setOutcome] = useState<outbox.Flushed | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const loading = useRef(false);
  const exhausted = useRef(false);
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const uncoveredRef = useRef(0);
  const session = useRef(saved?.session ?? `fast:${newId()}`);
  // Holding a card: its answer in a small popup, and the card marked forgotten.
  const [peek, setPeek] = useState<{ card: FastCard; x: number; y: number; below: boolean } | null>(null);
  const holdTimer = useRef<number | null>(null);
  const held = useRef(false);
  // The card being pressed, and where the press began.
  const press = useRef<{ id: number; x: number; y: number } | null>(null);

  const load = useCallback(async () => {
    if (loading.current || exhausted.current) return;
    loading.current = true;
    try {
      const r = await get<{ cards: FastCard[]; total: number | null }>("fast", {
        ...today(),
        offset: cardsRef.current.length,
        limit: PAGE,
      });
      if (r.total !== null) setTotal(r.total);
      if (r.cards.length < PAGE) exhausted.current = true;
      // The due list may have moved since a sweep was carried on: no card twice.
      setCards((c) => {
        const have = new Set(c.map((x) => x.id));
        return [...c, ...r.cards.filter((x) => !have.has(x.id))];
      });
    } catch (e) {
      setError(message(e));
    } finally {
      loading.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Count the cards whose bottom edge has risen into the top two thirds, and fetch more when near the end. */
  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const line = el.scrollTop + (el.clientHeight * 2) / 3;
    const cells = el.querySelectorAll<HTMLElement>(".cf-fast-cell");
    // What is above the line now: scrolling back up greys cards again. Cells
    // are in order, so the counted ones are a prefix; find where it ends.
    let lo = 0;
    let hi = cells.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cells[mid].offsetTop + cells[mid].offsetHeight <= line) lo = mid + 1;
      else hi = mid;
    }
    const n = lo;
    if (n !== uncoveredRef.current) {
      uncoveredRef.current = n;
      setUncovered(n);
    }
    if (cells.length - n < AHEAD) void load();
  }, [load]);

  // Carried on: back to where the grid was scrolled, before it is measured.
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (restored.current || !saved || !scroller.current || !cards.length) return;
    restored.current = true;
    scroller.current.scrollTop = saved.scrollTop;
  }, [cards, saved]);
  useLayoutEffect(measure, [cards, measure]);

  // Kept on the device as it goes: marks are not answers until Done, and
  // leaving or closing the site must not lose them.
  useEffect(() => {
    if (stage !== "grid") return;
    resume.save("fast", {
      open: true,
      session: session.current,
      cards,
      total,
      forgot: [...forgot],
      // Read when it runs, after the render that declares it.
      marked: answers.length,
      scrollTop: scroller.current?.scrollTop ?? 0,
    });
  }, [cards, total, forgot, uncovered, stage]);

  /** Half the popup's width: 260px, or the screen less its margins if narrower. Matches the stylesheet. */
  const PEEK_HALF = () => Math.min(260, window.innerWidth - 32) / 2;

  /** A press held this long is a peek rather than a tap. */
  const HOLD_MS = 380;

  const clearHold = useCallback(() => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
    press.current = null;
    setPeek(null);
  }, []);

  const startHold = (card: FastCard, e: React.PointerEvent<HTMLElement>) => {
    if (stage !== "grid" || !canWrite) return;
    clearHold();
    held.current = false;
    const el = e.currentTarget;
    press.current = { id: card.id, x: e.clientX, y: e.clientY };
    holdTimer.current = window.setTimeout(() => {
      // Only if the same card is still pressed, where it was.
      if (press.current?.id !== card.id) return;
      held.current = true;
      setForgot((f) => (f.has(card.id) ? f : new Set(f).add(card.id)));
      const r = el.getBoundingClientRect();
      // Above the finger, unless that would run off the top of the screen.
      const below = r.top < 150;
      setPeek({
        card,
        // Centred on the card but kept 16px inside the screen: the popup is up to 260px wide.
        x: Math.min(Math.max(r.left + r.width / 2, 16 + PEEK_HALF()), window.innerWidth - 16 - PEEK_HALF()),
        y: below ? r.bottom + 8 : r.top - 8,
        below,
      });
      navigator.vibrate?.(12);
    }, HOLD_MS);
  };

  /** A press that wanders (a scroll starting) is not a hold. */
  const moveHold = (e: React.PointerEvent<HTMLElement>) => {
    const p = press.current;
    if (p && !held.current && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) clearHold();
  };

  // Lifting the finger anywhere ends a hold and closes its peek.
  useEffect(() => {
    window.addEventListener("pointerup", clearHold);
    window.addEventListener("pointercancel", clearHold);
    return () => {
      window.removeEventListener("pointerup", clearHold);
      window.removeEventListener("pointercancel", clearHold);
    };
  }, [clearHold]);

  const toggle = (id: number) => {
    // The click that ends a hold isn't a tap: the card stays forgotten.
    if (held.current) {
      held.current = false;
      return;
    }
    if (stage !== "grid" || !canWrite) return;
    setForgot((f) => {
      const next = new Set(f);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // What Done would send: every uncovered card, plus any marked forgotten further down.
  const answers = useMemo(() => {
    const out: Array<{ card: FastCard; good: boolean }> = [];
    cards.forEach((c, i) => {
      if (forgot.has(c.id)) out.push({ card: c, good: false });
      else if (i < uncovered) out.push({ card: c, good: true });
    });
    return out;
  }, [cards, forgot, uncovered]);
  const nGood = answers.filter((a) => a.good).length;
  const nForgot = answers.length - nGood;

  const submit = async () => {
    setStage("sending");
    setSent(0);
    const day = today();
    const inputs: ReviewInput[] = answers.map((a, i) => ({
      id: newId(),
      cardId: a.card.id,
      grade: a.good ? "good" : "forgot",
      at: Date.now(),
      ...day,
      session: session.current,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      utcOffset: -new Date().getTimezoneOffset(),
      device: window.innerWidth < 700 ? "phone" : "desktop",
      position: i + 1,
    }));
    // Kept on the device before any is sent: whatever doesn't get through now goes when the connection is back.
    outbox.add(...inputs);
    // They are answers now, kept in the outbox; the sweep is done with.
    resume.clear("fast");
    const r = await outbox.flush((n) => setSent(Math.min(n, inputs.length)));
    setOutcome(r);
    setStage("done");
    refresh();
  };

  // Leaving keeps the marks (resume): Fast review on Today carries on.
  useBackLayer(stage === "confirm", () => setStage("grid"));

  if (stage === "confirm" || stage === "sending") {
    return (
      <Confirm
        answers={answers}
        sending={stage === "sending"}
        sent={sent}
        onBack={() => setStage("grid")}
        onSend={submit}
        error={error}
      />
    );
  }

  if (stage === "done" && outcome) {
    return (
      <div className="cf-review cf-fast-done">
        <div className="cf-done">
          <p className="cf-done-zh">快</p>
          <p>
            {outcome.done > 0 || !outcome.left ? (
              <>
                <b>{fmt(outcome.done)}</b> answered
                {outcome.refused > 0 && `, ${fmt(outcome.refused)} skipped (no longer due)`}.
              </>
            ) : (
              <>
                <b>{fmt(outcome.left)}</b> answers saved.
              </>
            )}
          </p>
          {/* Nothing is lost: what didn't get through waits on the device. */}
          {outcome.left > 0 && (
            <p className="cf-warn">
              {outcome.done > 0 && `${fmt(outcome.left)} more saved on this device. `}
              {outcome.error} They go when the connection is back.
            </p>
          )}
          <p className="cf-muted">
            {outcome.recallOpened > 0 && `${fmt(outcome.recallOpened)} Recall cards opened. `}
            {outcome.revived > 0 && `${fmt(outcome.revived)} retired sentences brought back.`}
          </p>
          {error && <p className="cf-error">{error}</p>}
          <button className="cf-btn" onClick={onEnd}>
            Back to today
          </button>
        </div>
      </div>
    );
  }

  const left = total === null ? null : Math.max(0, total - uncovered);
  return (
    <div className="cf-fast">
      <div className="cf-fast-top">
        <button className="cf-close" onClick={onEnd} aria-label="Leave fast review">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <p className="cf-fast-count" aria-live="polite">
          <span className="is-good">
            <b>{fmt(nGood)}</b> got it
          </span>
          <span className="is-forgot">
            <b>{fmt(nForgot)}</b> forgot
          </span>
          {left !== null && (
            <span>
              <b>{fmt(left)}</b> left
            </span>
          )}
        </p>
        <button
          className="cf-btn cf-fast-done-btn"
          disabled={!canWrite || answers.length === 0}
          onClick={() => setStage("confirm")}
        >
          Done
        </button>
      </div>

      {error && <p className="cf-error">{error}</p>}

      <div className="cf-fast-body">
        <div
          className="cf-fast-scroll"
          ref={scroller}
          onScroll={() => {
            if (press.current && !held.current) clearHold();
            measure();
          }}
        >
          <p className="cf-muted cf-fast-note">
            {canWrite
              ? "Tap a card you've forgotten, or hold it to see the answer."
              : "Read-only: only Benji can answer these."}
          </p>
          <ul className="cf-fast-grid">
            {cards.map((c, i) => {
              const isForgot = forgot.has(c.id);
              const n = [...c.word].length;
              return (
                <li key={c.id} className={`cf-fast-cell${isForgot ? " is-forgot" : i < uncovered ? " is-seen" : " is-ahead"}`}>
                  <button
                    onClick={() => toggle(c.id)}
                    onPointerDown={(e) => startHold(c, e)}
                    onPointerMove={moveHold}
                    onContextMenu={(e) => e.preventDefault()}
                    aria-pressed={isForgot}
                    aria-label={`${c.word}${isForgot ? ", forgotten" : ""}`}
                  >
                    <span className="cf-fast-word" style={{ "--n": Math.min(Math.max(n, 2), 5) } as React.CSSProperties}>
                      {c.word}
                    </span>
                    {isForgot && (
                      <span className="cf-fast-meaning">
                        {c.pinyin && <span>{displayPinyin(c.pinyin)}</span>}
                        {c.gloss && <span>{c.gloss}</span>}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {/* Room to bring the last rows up far enough to count. */}
          <div className="cf-fast-tail">
            {exhausted.current && cards.length > 0 ? "That's every Read card due." : "Loading more…"}
          </div>
        </div>
        {/* Over the grey cards, while there are any below: they aren't part of this. */}
        {cards.length > uncovered && (
          <p className="cf-fast-ahead" aria-hidden="true">
            Grey cards won't be reviewed until scrolled up
          </p>
        )}
      </div>
      {peek && (
        <div className={`cf-fast-peek${peek.below ? " is-below" : ""}`} style={{ left: peek.x, top: peek.y }} role="status">
          <b>{peek.card.word}</b>
          {peek.card.pinyin && <span className="cf-fast-peek-py">{displayPinyin(peek.card.pinyin)}</span>}
          <span>{peek.card.gloss ?? "No definition on file."}</span>
        </div>
      )}
    </div>
  );
}

/** Before anything is sent: how many of each, where the cards would go, and what else would happen. */
function Confirm({
  answers,
  sending,
  sent,
  onBack,
  onSend,
  error,
}: {
  answers: Array<{ card: FastCard; good: boolean }>;
  sending: boolean;
  sent: number;
  onBack: () => void;
  onSend: () => void;
  error: string | null;
}) {
  const good = answers.filter((a) => a.good);
  const forgotten = answers.filter((a) => !a.good);
  const next = answers.map((a) => (a.good ? a.card.intervals.good : a.card.intervals.forgot));
  const before = median(answers.map((a) => a.card.was).filter((d): d is number => d !== null));
  const after = median(next);
  const buckets = BUCKETS.map((b, i) => ({
    ...b,
    n: next.filter((d) => d <= b.max && (i === 0 || d > BUCKETS[i - 1].max)).length,
  }));
  const most = Math.max(1, ...buckets.map((b) => b.n));
  const opening = good.filter((a) => a.card.opensRecall).length;

  return (
    <div className="cf-review cf-fast-confirm">
      <h2 className="cf-h2">Answer {fmt(answers.length)} cards?</h2>

      <div className="cf-fast-split">
        <div className="is-good">
          <b>{fmt(good.length)}</b>
          <span>Got it</span>
        </div>
        <div className="is-forgot">
          <b>{fmt(forgotten.length)}</b>
          <span>Forgot</span>
        </div>
      </div>

      <dl className="cf-fast-facts">
        {before !== null && after !== null && (
          <div>
            <dt>Typical wait</dt>
            <dd>
              {span(before)} <em>→</em> <b>{span(after)}</b>
            </dd>
          </div>
        )}
        <div>
          <dt>Recall cards that open</dt>
          <dd>
            <b>{fmt(opening)}</b>
          </dd>
        </div>
      </dl>

      <h3 className="cf-fast-h3">When they come back</h3>
      <ul className="cf-fast-buckets">
        {buckets.map((b) => (
          <li key={b.label}>
            <span>{b.label}</span>
            <i style={{ width: `${(100 * b.n) / most}%` }} />
            <b>{fmt(b.n)}</b>
          </li>
        ))}
      </ul>

      {forgotten.length > 0 && (
        <>
          <h3 className="cf-fast-h3">Forgotten, back tomorrow</h3>
          <p className="cf-fast-forgot">{forgotten.map((a) => a.card.word).join("　")}</p>
        </>
      )}

      {error && <p className="cf-error">{error}</p>}

      <div className="cf-answer is-floor">
        {sending ? (
          <div
            className="cf-fast-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={answers.length}
            aria-valuenow={sent}
          >
            <i style={{ width: `${(100 * sent) / Math.max(1, answers.length)}%` }} />
            <span>
              Sending {fmt(sent)} of {fmt(answers.length)}
            </span>
          </div>
        ) : (
          <>
            <button className="cf-answer-btn cf-answer-ghost" onClick={onBack}>
              Back
            </button>
            <button className="cf-answer-btn cf-answer-good" onClick={onSend}>
              Answer {fmt(answers.length)}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
