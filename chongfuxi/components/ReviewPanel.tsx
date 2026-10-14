"use client";

// Review: first Today — what is due and what to include — then the session:
// one queue, one card at a time, two answers.
//
// The server decides what is due and what an answer does; this draws the card,
// times the answer and sends it. Answers are sent behind the next card, so the
// session moves at the speed of the thumb rather than the network, and one
// that fails to arrive stays in hand to be sent again.
//
// A session takes the whole screen: the shell puts its header and tabs away
// while one is running. A visitor can page through the cards but not answer.

import { useCallback, useEffect, useRef, useState } from "react";
import type { CardHistory, ReviewInput, ReviewResult, SessionCard, SessionKinds } from "@chongfuxi/lib/api";
import { ApiError, get, send, today } from "@chongfuxi/lib/client";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import { blankOut } from "@chongfuxi/lib/review";
import type { Grade } from "@chongfuxi/lib/schedule";
import { newId } from "@chongfuxi/lib/upload";
import { Highlighted, ago, fmt, message, plecoHref, span, type Shell } from "./shared";

/** Cards fetched at a time, and how few are left in hand before fetching more. */
const BATCH = 10;
const REFILL_AT = 3;
/** Answers still on their way that the server may not know about yet. */
const IN_FLIGHT = 20;
/** How long an answered card takes to slide away, in ms. Matches the stylesheet. */
const LEAVE_MS = 220;

const KIND_NAME = { read: "Read", produce: "Recall", sentence: "Sentence" } as const;

/** Bubbles shown at most: the latest answers, here first and Pleco's before them. */
const BUBBLES = 16;

/**
 * How the card has gone: a bubble per answer, oldest first — filled for got
 * it, a ring for forgot — Pleco's smaller and before a gap, then the ones
 * given here. And when it was last seen.
 */
function History({ h }: { h: CardHistory }) {
  const here = h.here.slice(-BUBBLES);
  const pleco = h.pleco.slice(-Math.max(0, BUBBLES - here.length));
  const count = (list: string[]) => `${list.filter((g) => g === "good").length} right, ${list.filter((g) => g === "forgot").length} wrong`;
  const label = [h.pleco.length ? `In Pleco: ${count(h.pleco)}` : "", h.here.length ? `Here: ${count(h.here)}` : ""].filter(Boolean).join(". ");
  return (
    <div className="cf-history">
      {(pleco.length > 0 || here.length > 0) && (
        <span className="cf-bubbles" role="img" aria-label={label}>
          {pleco.map((g, i) => (
            <i key={`p${i}`} className={`cf-bubble is-pleco is-${g}`} />
          ))}
          {pleco.length > 0 && here.length > 0 && <i className="cf-bubble-gap" />}
          {here.map((g, i) => (
            <i key={`h${i}`} className={`cf-bubble is-${g}`} />
          ))}
        </span>
      )}
      <span className="cf-history-when">
        {h.lastAt === null ? "First time" : `Last seen ${ago(h.lastAt)}${h.lastIn === "pleco" ? " in Pleco" : ""}`}
      </span>
    </div>
  );
}

/** The senses a Produce card asks with: the first few of the word's main definition. */
function promptOf(card: SessionCard): string[] {
  if (card.meaning) return [card.meaning.gloss];
  const defs = card.word?.defs ?? [];
  return (defs.find((d) => !d.own) ?? defs[0])?.senses.slice(0, 3) ?? [];
}

/** What an answer changed, itemised: the card first, then everything it touched. */
interface Receipt {
  title: string;
  grade: Grade;
  lines: string[];
}

function receiptOf(card: SessionCard, grade: Grade, r: ReviewResult): Receipt {
  const good = grade === "good";
  const was = (days: number | null) => (days === null ? "its first answer here" : `was ${span(days)}`);
  const lines: string[] = [];
  const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

  if (card.word) {
    lines.push(`${good ? "Back" : "Forgotten, back"} in ${span(r.days ?? 1)} (${was(r.was)})`);
    if (r.produceOpened) lines.push(`Recall card opened, first asked ${r.recallIn && r.recallIn > 1 ? `in ${span(r.recallIn)}` : "tomorrow"}`);
    if (r.firstSeen.length) lines.push("Read in a sentence for the first time");
    else if (r.exposed.length) lines.push("Counted as read in a sentence once more");
  } else {
    const reads = r.cleanReads;
    if (r.retired) lines.push(`Retired after ${count(reads?.now ?? 2, "clean read")}`);
    else lines.push(`${good ? "Back" : "Forgotten, back"} in ${span(r.days ?? 1)} (${was(r.was)})`);
    if (reads && good && !r.retired) {
      lines.push(
        reads.now === reads.before
          ? `Still ${reads.now} of ${reads.need} clean reads: today's was already counted`
          : `Clean read ${reads.now} of ${reads.need} before it retires`,
      );
    }
    if (reads && !good && reads.before > 0) lines.push(`Clean reads back to none (had ${reads.before})`);
    for (const l of r.lapses) lines.push(`${l.word} lapsed, back in ${span(l.days)} (${was(l.was)})`);
    if (r.exposed.length) lines.push(`${count(r.exposed.length, "word")} read in context: ${r.exposed.join(" ")}`);
    if (r.firstSeen.length) lines.push(`First time in a sentence: ${r.firstSeen.join(" ")}`);
  }
  for (const zh of r.revivedSentences) lines.push(`Retired sentence back tomorrow: ${zh}`);

  const what = card.word ? `${card.word.word}, ${card.kind === "produce" ? "recall" : "read"}` : "Sentence";
  return { title: what, grade, lines };
}

const RECEIPT_KEY = "chongfuxi:receipt";

/** What the last session included, kept on this device. */
const KINDS_KEY = "chongfuxi:session";
const EVERYTHING: SessionKinds = { read: true, recall: true, sentences: true };

/** Words with a card to show under these choices. A word with both cards due is shown once. */
function wordsDue(s: { dueWords: number; dueRead: number; dueRecall: number }, kinds: SessionKinds): number {
  if (kinds.read && kinds.recall) return s.dueWords;
  return kinds.read ? s.dueRead : kinds.recall ? s.dueRecall : 0;
}

function rememberedKinds(): SessionKinds {
  try {
    return { ...EVERYTHING, ...(JSON.parse(window.localStorage.getItem(KINDS_KEY) ?? "{}") as Partial<SessionKinds>) };
  } catch {
    return EVERYTHING;
  }
}

export function ReviewPanel({ shell, onImport }: { shell: Shell; onImport: () => void }) {
  const [kinds, setKinds] = useState<SessionKinds>(EVERYTHING);
  const [started, setStarted] = useState(false);
  useEffect(() => setKinds(rememberedKinds()), []);

  const choose = (next: SessionKinds) => {
    setKinds(next);
    try {
      window.localStorage.setItem(KINDS_KEY, JSON.stringify(next));
    } catch {
      // A private window may refuse; the choice still holds for this visit.
    }
  };

  const { setFocus, refresh } = shell;
  const begin = () => {
    setFocus(true);
    setStarted(true);
  };
  const end = useCallback(() => {
    setFocus(false);
    setStarted(false);
    refresh();
  }, [setFocus, refresh]);
  // Leaving the tab mid-session must give the header and tabs back.
  useEffect(() => () => setFocus(false), [setFocus]);

  if (started) return <Session shell={shell} kinds={kinds} onEnd={end} />;
  return <Today shell={shell} kinds={kinds} onChoose={choose} onStart={begin} onImport={onImport} />;
}

/** Before a session: what is due, what to include, and how many new sentences a day. */
function Today({
  shell,
  kinds,
  onChoose,
  onStart,
  onImport,
}: {
  shell: Shell;
  kinds: SessionKinds;
  onChoose: (k: SessionKinds) => void;
  onStart: () => void;
  onImport: () => void;
}) {
  const { summary: s, canWrite, refresh } = shell;
  const [busy, setBusy] = useState(false);
  if (!s) return null;

  const pace = async (n: number) => {
    setBusy(true);
    try {
      await send("settings", { newPerDay: n }, "PUT");
      refresh();
    } finally {
      setBusy(false);
    }
  };

  if (s.words === 0) {
    return (
      <div className="cf-review">
        <div className="cf-done">
          <p className="cf-done-zh">空</p>
          <p className="cf-muted">
            Nothing here yet.{" "}
            {canWrite ? (
              <button className="cf-link" onClick={onImport}>
                Import a Pleco backup
              </button>
            ) : (
              "Benji hasn't imported his deck."
            )}
          </p>
        </div>
      </div>
    );
  }

  const words = wordsDue(s, kinds);
  const sentences = kinds.sentences ? s.dueSentences + s.newLeftToday : 0;
  const total = words + sentences;
  const all = total + s.answeredToday;
  const share = (n: number) => `${all ? (100 * n) / all : 0}%`;

  return (
    <div className="cf-today">
      <p className="cf-today-date">{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</p>
      <h2 className="cf-today-title">Today</h2>

      <p className="cf-today-n">{fmt(total)}</p>
      <p className="cf-today-sub">{total === 1 ? "card to review" : "cards to review"}</p>
      {/* The day as one bar: what is done, then what is left, by kind. */}
      <div className="cf-daybar" role="img" aria-label={`${fmt(s.answeredToday)} done, ${fmt(total)} to go`}>
        <i className="is-done" style={{ width: share(s.answeredToday) }} />
        <i className="is-read" style={{ width: share(words) }} />
        <i className="is-sentence" style={{ width: share(kinds.sentences ? s.dueSentences : 0) }} />
        <i className="is-new" style={{ width: share(kinds.sentences ? s.newLeftToday : 0) }} />
      </div>
      {s.answeredToday > 0 && <p className="cf-today-done">{fmt(s.answeredToday)} done so far</p>}

      {/* Either side of today: what was done, what arrived, what is coming. */}
      <dl className="cf-days">
        <div>
          <dt>Yesterday</dt>
          <dd>
            <b>{fmt(s.answeredYesterday)}</b> reviewed
          </dd>
        </div>
        <div>
          <dt>Today</dt>
          <dd>
            <b>{fmt(s.cameDueToday)}</b> came due
          </dd>
        </div>
        <div>
          <dt>Tomorrow</dt>
          <dd>
            <b>{fmt(s.dueTomorrow)}</b> due
          </dd>
        </div>
      </dl>

      {/* What is due by kind, each row the choice to take that kind in or leave it out. */}
      <ul className="cf-kinds">
        <li>
          <label className={`cf-kind is-read${kinds.read ? "" : " is-off"}`}>
            <input type="checkbox" checked={kinds.read} onChange={(e) => onChoose({ ...kinds, read: e.target.checked })} />
            <i className="cf-tick" />
            <span>
              Words to read
              <small>See the word, know what it means</small>
            </span>
            <b>{fmt(s.dueRead)}</b>
          </label>
        </li>
        <li>
          <label className={`cf-kind is-produce${kinds.recall ? "" : " is-off"}`}>
            <input type="checkbox" checked={kinds.recall} onChange={(e) => onChoose({ ...kinds, recall: e.target.checked })} />
            <i className="cf-tick" />
            <span>
              Words to recall
              <small>See the meaning, produce the word</small>
            </span>
            <b>{fmt(s.dueRecall)}</b>
          </label>
        </li>
        <li>
          <label className={`cf-kind is-sentence${kinds.sentences ? "" : " is-off"}`}>
            <input type="checkbox" checked={kinds.sentences} onChange={(e) => onChoose({ ...kinds, sentences: e.target.checked })} />
            <i className="cf-tick" />
            <span>
              Sentences
              <small>
                {fmt(s.dueSentences)} due again, {fmt(s.newLeftToday)} new
              </small>
            </span>
            <b>{fmt(s.dueSentences + s.newLeftToday)}</b>
          </label>
        </li>
        {canWrite && (
          <li className="cf-kind is-new">
            <i className="cf-dot" />
            <span>
              New sentences a day
              <small>{fmt(s.newSentences)} unlocked and waiting</small>
            </span>
            <div className="cf-stepper">
              <button disabled={busy || s.newPerDay <= 0} onClick={() => pace(Math.max(0, s.newPerDay - 5))} aria-label="Five fewer">
                −
              </button>
              <b>{s.newPerDay}</b>
              <button disabled={busy || s.newPerDay >= 200} onClick={() => pace(Math.min(200, s.newPerDay + 5))} aria-label="Five more">
                +
              </button>
            </div>
          </li>
        )}
      </ul>

      <div className="cf-answer">
        <button className="cf-answer-btn cf-answer-show" disabled={total === 0} onClick={onStart}>
          {!kinds.read && !kinds.recall && !kinds.sentences
            ? "Nothing chosen"
            : total === 0
              ? "Nothing due"
              : canWrite
                ? "Start reviewing"
                : "Look through the cards"}
        </button>
      </div>
    </div>
  );
}

function Session({ shell, kinds, onEnd }: { shell: Shell; kinds: SessionKinds; onEnd: () => void }) {
  const { summary, canWrite, refresh } = shell;
  const [queue, setQueue] = useState<SessionCard[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "empty">("loading");
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  // After forgetting a sentence: choosing the words that were the trouble.
  const [tapped, setTapped] = useState<Set<string> | null>(null);
  // The note being written, while its box is open.
  const [noting, setNoting] = useState<string | null>(null);
  const [splitting, setSplitting] = useState<string | null>(null);
  const [last, setLast] = useState<Receipt | null>(null);
  // The receipt can be folded down to its first line; the choice is kept.
  const [itemised, setItemised] = useState(true);
  useEffect(() => {
    try {
      setItemised(window.localStorage.getItem(RECEIPT_KEY) !== "0");
    } catch {
      // Open, then.
    }
  }, []);
  const fold = () => {
    setItemised((open) => {
      try {
        window.localStorage.setItem(RECEIPT_KEY, open ? "0" : "1");
      } catch {
        // It still holds for this visit.
      }
      return !open;
    });
  };
  const [unsent, setUnsent] = useState<ReviewInput[]>([]);
  // The card on its way out, and which way: answered cards slide off before the next arrives.
  const [leaving, setLeaving] = useState<Grade | "skip" | null>(null);
  const [answered, setAnswered] = useState(0);

  const session = useRef(newId());
  const dealt = useRef(0);
  const recentIds = useRef<number[]>([]);
  const recentWords = useRef<string[]>([]);
  const loading = useRef(false);
  const exhausted = useRef(false);
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const shownAt = useRef(0);
  const revealedAt = useRef<number | null>(null);

  const card = queue[0] ?? null;

  const refill = useCallback(async () => {
    if (loading.current || exhausted.current) return;
    loading.current = true;
    try {
      const held = queueRef.current.map((c) => c.id);
      const { cards } = await get<{ cards: SessionCard[] }>("session", {
        ...today(),
        limit: BATCH,
        position: dealt.current + held.length,
        exclude: [...held, ...recentIds.current].join(","),
        skip: recentWords.current.join(","),
        read: kinds.read ? undefined : 0,
        recall: kinds.recall ? undefined : 0,
        sentences: kinds.sentences ? undefined : 0,
      });
      if (!cards.length) exhausted.current = true;
      // The same card can't be in hand twice, whatever the timing.
      const have = new Set(queueRef.current.map((c) => c.id));
      const added = cards.filter((c) => !have.has(c.id));
      setQueue((q) => [...q, ...added]);
      setStatus(queueRef.current.length + added.length ? "ready" : "empty");
      setError(null);
    } catch (e) {
      setError(message(e));
    } finally {
      loading.current = false;
    }
  }, [kinds]);

  useEffect(() => {
    if (queue.length <= REFILL_AT) void refill();
  }, [queue.length, refill]);

  // A new card: face down, and the clock starts.
  useEffect(() => {
    setRevealed(false);
    setTapped(null);
    setNoting(null);
    setSplitting(null);
    setLeaving(null);
    shownAt.current = performance.now();
    revealedAt.current = null;
  }, [card?.id]);

  const post = useCallback(
    async (input: ReviewInput, shown: SessionCard | null) => {
      try {
        const result = await send<ReviewResult>("review", input);
        setUnsent((list) => list.filter((r) => r.id !== input.id));
        if (shown && !result.duplicate) setLast(receiptOf(shown, input.grade, result));
        refresh();
      } catch (e) {
        // 409: the card had already left the queue (answered on another device). Nothing to resend.
        if (e instanceof ApiError && e.status === 409) return setUnsent((list) => list.filter((r) => r.id !== input.id));
        setUnsent((list) => (list.some((r) => r.id === input.id) ? list : [...list, input]));
      }
    },
    [refresh],
  );

  /** Take the top card off, after it has had time to slide away. */
  const next = (way: Grade | "skip") => {
    const drop = () => {
      dealt.current++;
      setQueue((q) => q.slice(1));
      if (queueRef.current.length <= 1 && exhausted.current) setStatus("empty");
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return drop();
    setLeaving(way);
    window.setTimeout(drop, LEAVE_MS);
  };

  const answer = (grade: Grade, words: string[] = []) => {
    if (!card || leaving) return;
    const now = performance.now();
    const input: ReviewInput = {
      id: newId(),
      cardId: card.id,
      grade,
      at: Date.now(),
      ...today(),
      session: session.current,
      ms: Math.round(now - shownAt.current),
      revealMs: revealedAt.current === null ? undefined : Math.round(revealedAt.current - shownAt.current),
      sentenceId: card.sentence?.id ?? null,
      tapped: words,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      utcOffset: -new Date().getTimezoneOffset(),
      device: window.innerWidth < 700 ? "phone" : "desktop",
      position: dealt.current + 1,
    };
    recentIds.current = [...recentIds.current, card.id].slice(-IN_FLIGHT);
    if (card.word) recentWords.current = [...recentWords.current, card.word.word].slice(-IN_FLIGHT);
    void post(input, card);
    setAnswered((n) => n + 1);
    next(grade);
  };

  const saveNote = async () => {
    if (!card || noting === null) return;
    const note = noting.trim() || null;
    try {
      await send("note", { cardId: card.id, note: noting });
      setQueue((q) => q.map((c) => (c.id === card.id ? { ...c, note } : c)));
      setNoting(null);
    } catch (e) {
      setError(message(e));
    }
  };

  const split = async (gloss: string) => {
    if (!card?.word) return;
    try {
      const { id } = await send<{ id: number }>("meaning", { word: card.word.word, gloss });
      setQueue((q) =>
        q.map((c) => (c.word?.word === card.word!.word ? { ...c, word: { ...c.word!, split: [...c.word!.split, { id, gloss }] } } : c)),
      );
      setSplitting(null);
    } catch (e) {
      setError(message(e));
    }
  };

  const merge = async (id: number) => {
    try {
      await send("meaning", { merge: id });
      setQueue((q) =>
        q.map((c) => (c.word ? { ...c, word: { ...c.word, split: c.word.split.filter((m) => m.id !== id) } } : c)),
      );
    } catch (e) {
      setError(message(e));
    }
  };

  const reveal = () => {
    revealedAt.current = performance.now();
    setRevealed(true);
  };

  const words = summary ? wordsDue(summary, kinds) : 0;
  const left = summary ? words + (kinds.sentences ? summary.dueSentences + summary.newLeftToday : 0) : 0;
  const progress = answered + left ? (100 * answered) / (answered + left) : 0;

  return (
    <div className="cf-review">
      <div className="cf-session-top">
        <button className="cf-close" onClick={onEnd} aria-label="End session">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden>
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
          </svg>
        </button>
        <div className="cf-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
          <i style={{ width: `${progress}%` }} />
        </div>
        <span className="cf-left">{fmt(left)}</span>
      </div>

      {error && <p className="cf-error">{error}</p>}
      {unsent.length > 0 && (
        <p className="cf-warn">
          {unsent.length} answer{unsent.length === 1 ? " hasn't" : "s haven't"} reached the server.{" "}
          <button className="cf-link" onClick={() => unsent.forEach((r) => void post(r, null))}>
            Send again
          </button>
        </p>
      )}

      {status === "loading" && !card && <p className="cf-muted cf-pad">Getting your cards…</p>}
      {status === "empty" && !card && (
        <div className="cf-done">
          <p className="cf-done-zh">完</p>
          <p className="cf-muted">
            {answered > 0 ? `${fmt(answered)} answered. ` : ""}
            {left > 0 ? "That's everything in hand." : "Nothing more due today."}
          </p>
          <button className="cf-btn" onClick={onEnd}>
            Back to today
          </button>
        </div>
      )}

      {card && (
        <article key={card.id} className={`cf-card is-${card.kind}${leaving ? ` is-leaving-${leaving}` : ""}`}>
          <div className="cf-card-kind">
            <i className="cf-dot" />
            {KIND_NAME[card.kind]}
            {card.isNew && <span className="cf-tag">new</span>}
            {card.kind === "sentence" && !card.isNew && <span className="cf-tag">{card.cleanReads} of 2 clean reads</span>}
          </div>
          <History h={card.history} />
          {card.note && noting === null && <p className="cf-note">{card.note}</p>}

          {card.kind === "read" && card.word && (
            <>
              <div className="cf-card-word">{card.word.word}</div>
              {card.meaning && !revealed && <p className="cf-card-hint">One of its other meanings, one you split off.</p>}
              {card.sentence && (
                <p className="cf-card-zh">
                  <Highlighted text={card.sentence.zh} word={card.word.word} />
                </p>
              )}
              {revealed && (
                <div className="cf-back">
                  {card.word.pinyin && <div className="cf-card-pinyin">{displayPinyin(card.word.pinyin)}</div>}
                  {card.meaning && <p className="cf-card-meaning">{card.meaning.gloss}</p>}
                  <Definitions
                    card={card}
                    canSplit={canWrite && !card.meaning}
                    splitting={splitting}
                    onPick={setSplitting}
                    onSplit={split}
                    onMerge={merge}
                  />
                  {card.sentence?.en && <p className="cf-en">{card.sentence.en}</p>}
                </div>
              )}
            </>
          )}

          {card.kind === "produce" && card.word && (
            <>
              <ul className="cf-prompt">
                {promptOf(card).map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              {card.sentence && blankOut(card.sentence.zh, card.word.word) && !revealed && (
                <p className="cf-card-zh">{blankOut(card.sentence.zh, card.word.word)}</p>
              )}
              {revealed && (
                <div className="cf-back">
                  <div className="cf-card-word">{card.word.word}</div>
                  {card.word.pinyin && <div className="cf-card-pinyin">{displayPinyin(card.word.pinyin)}</div>}
                  {card.alternatives && card.alternatives.length > 0 && (
                    <p className="cf-muted cf-also">Also means this: {card.alternatives.join("、")}</p>
                  )}
                  {card.sentence && (
                    <>
                      <p className="cf-card-zh">
                        <Highlighted text={card.sentence.zh} word={card.word.word} />
                      </p>
                      {card.sentence.en && <p className="cf-en">{card.sentence.en}</p>}
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {card.kind === "sentence" && card.sentence && (
            <>
              <p className="cf-card-sentence">{card.sentence.zh}</p>
              {revealed && (
                <div className="cf-back">
                  {card.sentence.en && <p className="cf-card-en">{card.sentence.en}</p>}
                  {tapped && (
                    <>
                      <p className="cf-muted">Which words tripped you? Tap them and they&apos;ll come back sooner.</p>
                      <div className="cf-tokens">
                        {[...new Set(card.sentence.words)].map((w) => (
                          <button
                            key={w}
                            className={`cf-token${tapped.has(w) ? " is-on" : ""}`}
                            aria-pressed={tapped.has(w)}
                            onClick={() => {
                              const set = new Set(tapped);
                              if (set.has(w)) set.delete(w);
                              else set.add(w);
                              setTapped(set);
                            }}
                          >
                            {w}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {revealed && (
            <div className="cf-card-foot">
              {card.word && (
                <a className="cf-link" href={plecoHref(card.word.word)}>
                  Open in Pleco
                </a>
              )}
              {canWrite && noting === null && (
                <button className="cf-link" onClick={() => setNoting(card.note ?? "")}>
                  {card.note ? "Edit note" : "Add a note"}
                </button>
              )}
            </div>
          )}
          {noting !== null && (
            <div className="cf-fix">
              <input
                className="cf-input"
                autoFocus
                maxLength={500}
                placeholder="What tells this one apart?"
                value={noting}
                onChange={(e) => setNoting(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void saveNote()}
              />
              <div className="cf-buttons">
                <button className="cf-btn cf-btn-ghost" onClick={() => setNoting(null)}>
                  Cancel
                </button>
                <button className="cf-btn" onClick={saveNote}>
                  {noting.trim() || !card.note ? "Save note" : "Remove note"}
                </button>
              </div>
            </div>
          )}
        </article>
      )}

      {/* What the last answer changed. */}
      {last && (
        <section className={`cf-receipt is-${last.grade}`} aria-live="polite">
          <button className="cf-receipt-head" aria-expanded={itemised} onClick={fold}>
            <i className={`cf-bubble${last.grade === "forgot" ? " is-forgot" : ""}`} />
            <b>{last.title}</b>
            <span>{itemised || last.lines.length < 2 ? (last.grade === "good" ? "Got it" : "Forgot") : last.lines[0]}</span>
            <small>{itemised ? "Hide" : `${last.lines.length} changes`}</small>
          </button>
          {itemised && (
            <ul>
              {last.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* The answer, at the foot of the screen, under the thumb. */}
      {card && (
        <div className="cf-answer is-floor">
          {!revealed ? (
            <button className="cf-answer-btn cf-answer-show" onClick={reveal}>
              Show answer
            </button>
          ) : !canWrite ? (
            <>
              <span className="cf-muted cf-answer-note">Read-only. Only Benji can answer.</span>
              <button className="cf-answer-btn cf-answer-show" onClick={() => !leaving && next("skip")}>
                Next card
              </button>
            </>
          ) : tapped ? (
            <>
              <button className="cf-answer-btn cf-answer-ghost" onClick={() => setTapped(null)}>
                Back
              </button>
              <button className="cf-answer-btn cf-answer-forgot" onClick={() => answer("forgot", [...tapped])}>
                Done
                <small>{tapped.size ? `${tapped.size} word${tapped.size === 1 ? "" : "s"} lapse` : "none in particular"}</small>
              </button>
            </>
          ) : (
            <>
              <button
                className="cf-answer-btn cf-answer-forgot"
                onClick={() => (card.kind === "sentence" ? setTapped(new Set()) : answer("forgot"))}
              >
                Forgot
                <small>{span(card.intervals.forgot)}</small>
              </button>
              <button className="cf-answer-btn cf-answer-good" onClick={() => answer("good")}>
                Got it
                <small>{card.wouldRetire ? "retires" : span(card.intervals.good)}</small>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Everything the word means. On a word's own card each sense can be split off onto a card of its own. */
function Definitions({
  card,
  canSplit,
  splitting,
  onPick,
  onSplit,
  onMerge,
}: {
  card: SessionCard;
  canSplit: boolean;
  splitting: string | null;
  onPick: (gloss: string | null) => void;
  onSplit: (gloss: string) => void;
  onMerge: (id: number) => void;
}) {
  const word = card.word!;
  const split = new Map(word.split.map((m) => [m.gloss, m.id]));
  if (!word.defs.length) return <p className="cf-muted">No definition on file. Look it up in Pleco.</p>;
  return (
    <div className="cf-defs">
      {word.defs.map((d, i) => (
        <div key={i} className="cf-def">
          {!d.own && d.p && d.p !== word.pinyin && <span className="cf-def-p">{displayPinyin(d.p)}</span>}
          <ul>
            {d.senses.map((s) => (
              <li key={s} className={card.meaning?.gloss === s ? "is-target" : undefined}>
                {canSplit && !d.own && !split.has(s) ? (
                  <button className="cf-sense" onClick={() => onPick(splitting === s ? null : s)}>
                    {s}
                  </button>
                ) : (
                  <span className="cf-sense-text">{s}</span>
                )}
                {split.has(s) && (
                  <>
                    {" "}
                    <span className="cf-tag">own card</span>
                    {canSplit && (
                      <>
                        {" "}
                        <button className="cf-link" onClick={() => onMerge(split.get(s)!)}>
                          merge back
                        </button>
                      </>
                    )}
                  </>
                )}
                {splitting === s && (
                  <div className="cf-split">
                    <span className="cf-muted">Didn&apos;t know this one? Give it its own card.</span>
                    <button className="cf-btn" onClick={() => onSplit(s)}>
                      Split it off
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {canSplit && <p className="cf-muted cf-defs-hint">Tap a meaning you didn&apos;t know to give it its own card.</p>}
    </div>
  );
}
