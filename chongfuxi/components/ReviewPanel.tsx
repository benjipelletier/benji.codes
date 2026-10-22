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
import { flushSync } from "react-dom";
import type { CardHistory, LookupFrom, ReviewInput, ReviewResult, SentenceInfo, SessionCard, SessionKinds, WordDetail } from "@chongfuxi/lib/api";
import { ApiError, get, send, today } from "@chongfuxi/lib/client";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import * as bugs from "@chongfuxi/lib/bugs";
import * as outbox from "@chongfuxi/lib/outbox";
import * as resume from "@chongfuxi/lib/resume";
import { routeParam, useRouteParam } from "@chongfuxi/lib/route";
import { REFILL_AT, SESSION_BATCH as BATCH, blankOut } from "@chongfuxi/lib/review";
import { LEARN_EVERY } from "@chongfuxi/lib/learn";
import { mainFirst, mainSenses } from "@chongfuxi/lib/senses";
import type { Definition } from "@chongfuxi/lib/dict";
import type { Grade } from "@chongfuxi/lib/schedule";
import { newId } from "@chongfuxi/lib/upload";
import { DayStrip } from "./DayStrip";
import { FastReview } from "./FastReview";
import { LearnAnswers, LearnCard, useLadder } from "./Learn";
import { LookupPanel } from "./LookupPanel";
import { ReviewedSheet, type Answered } from "./Reviewed";
import { RescueHook, StuckList, StuckWords } from "./Rescue";
import { SynonymContrast } from "./Synonyms";
import { Loading, AiPill, AiTag, DefineButton, History, HskTags, LongkuTag, PlecoTile, aiDefined, SentenceText, Sheet, Waiting, Word, fmt, message, span, useBackLayer, type Shell } from "./shared";

/** Answers still on their way that the server may not know about yet. */
const IN_FLIGHT = 20;
/** How long an answered card takes to slide away, in ms. Matches the stylesheet. */
const LEAVE_MS = 220;
/** Forgot held this long, or swiped up this far, opens "What tripped you up?" ready to type. */
const FORGOT_HOLD_MS = 450;
const FORGOT_SWIPE = 40;

const KIND_NAME = { read: "Read", produce: "Recall", sentence: "Sentence" } as const;

/** The senses a Produce card asks with: the first few of the word's main definition. */
function promptOf(card: SessionCard): string[] {
  if (card.meaning) return [card.meaning.gloss];
  // The meaning the card's sentence is about first: 米 "meter" under 跑完了1000米.
  return card.word ? mainSenses(card.word.defs, card.word.pinyin, { en: card.sentence?.en }) : [];
}

/** What an answer changed, as figures: where the card went, then a chip for each thing it moved. */
interface Chip {
  n: string;
  label: string;
  tone?: "up" | "down" | "recall" | "sentence" | "new";
}

interface Receipt {
  id: string;
  title: string;
  grade: Grade;
  /** Days the card waited before, and waits now. Null: new before, retired now. */
  was: number | null;
  days: number | null;
  chips: Chip[];
}

function receiptOf(card: SessionCard, grade: Grade, r: ReviewResult, id: string, streak: number): Receipt {
  const good = grade === "good";
  const chips: Chip[] = [];

  if (r.was !== null && r.days !== null) {
    const ratio = r.days / r.was;
    if (ratio >= 1.05) chips.push({ n: `×${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}`, label: "longer", tone: "up" });
    else if (ratio <= 0.95) chips.push({ n: `−${Math.round((1 - ratio) * 100)}%`, label: "shorter", tone: "down" });
  }
  if (r.odds !== null) chips.push({ n: `${Math.round(r.odds * 100)}%`, label: "recall odds" });
  if (r.difficulty.after > 0) {
    const d = r.difficulty;
    const moved = d.before === null ? "" : d.after < d.before - 0.005 ? " ↓" : d.after > d.before + 0.005 ? " ↑" : "";
    chips.push({ n: d.after.toFixed(1), label: `difficulty${moved}`, tone: moved === " ↓" ? "up" : moved === " ↑" ? "down" : undefined });
  }
  if (r.produceOpened) chips.push({ n: "+1", label: "recall card", tone: "recall" });
  if (r.cleanReads && good) {
    const { now, need } = r.cleanReads;
    chips.push({ n: "●".repeat(Math.min(now, need)) + "○".repeat(Math.max(0, need - now)), label: r.retired ? "retired" : "clean reads", tone: "sentence" });
  }
  for (const l of r.lapses.slice(0, 2)) chips.push({ n: l.word, label: `lapsed, ${span(l.days)}`, tone: "down" });
  if (r.lapses.length > 2) chips.push({ n: `+${r.lapses.length - 2}`, label: "lapsed", tone: "down" });
  if (!card.word && r.exposed.length) chips.push({ n: String(r.exposed.length), label: r.exposed.length === 1 ? "word read" : "words read" });
  if (r.firstSeen.length) chips.push({ n: card.word ? "1st" : String(r.firstSeen.length), label: card.word ? "time in a sentence" : "first in context", tone: "new" });
  if (r.revived) chips.push({ n: `+${r.revived}`, label: r.revived === 1 ? "sentence back" : "sentences back", tone: "sentence" });
  if (streak >= 3) chips.push({ n: String(streak), label: "in a row", tone: "up" });

  return { id, title: card.word ? card.word.word : "Sentence", grade, was: r.was, days: r.retired ? null : r.days, chips };
}

/** A word's HSK levels, old and 3.0, or that it is in neither. */
/** Which deck a sentence comes from. */
function SourceOf({ sentence }: { sentence: SentenceInfo | null }) {
  if (!sentence?.sources.length) return null;
  return <p className="cf-source">{sentence.sources.join(", ")}</p>;
}

/** Where a wait of so many days sits on the meter: a log scale, full at two years. */
const onMeter = (days: number | null) => (days === null ? 0 : Math.min(1, Math.log1p(days) / Math.log1p(730)));

function ReceiptStrip({ r, onUndo, undoing }: { r: Receipt; onUndo?: () => void; undoing: boolean }) {
  const from = onMeter(r.was);
  const to = r.days === null ? 1 : onMeter(r.days);
  return (
    // Keyed by the answer, so each one plays in afresh.
    <section key={r.id} className={`cf-receipt is-${r.grade}`} aria-live="polite">
      <div className="cf-receipt-top">
        <i className={`cf-bubble${r.grade === "forgot" ? " is-forgot" : ""}`} />
        <b>{r.title}</b>
        <div
          className="cf-meter"
          style={{ "--from": `${from * 100}%`, "--to": `${to * 100}%` } as React.CSSProperties}
          role="img"
          aria-label={r.days === null ? "Retired" : `Back in ${span(r.days)}${r.was === null ? "" : `, was ${span(r.was)}`}`}
        >
          <i className="cf-meter-fill" />
          {r.was !== null && <i className="cf-meter-was" />}
        </div>
        <span className="cf-receipt-span">
          {r.was === null ? "new" : span(r.was)} <em>→</em> <b>{r.days === null ? "retired" : span(r.days)}</b>
        </span>
        {onUndo && (
          <button className="cf-undo" disabled={undoing} onClick={onUndo} aria-label={`Undo: answer ${r.title} again`}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M6 3 2.5 6.5 6 10M3 6.5h6.5a4 4 0 0 1 0 8H7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Undo
          </button>
        )}
      </div>
      {r.chips.length > 0 && (
        <ul className="cf-facts">
          {r.chips.map((c, i) => (
            <li key={`${c.n} ${c.label}`} className={c.tone ? `is-${c.tone}` : undefined} style={{ animationDelay: `${120 + i * 60}ms` }}>
              <b>{c.n}</b> {c.label}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** What the last session included, kept on this device. */
const KINDS_KEY = "chongfuxi:session";
const EVERYTHING: SessionKinds = { read: true, recall: true, sentences: true, learn: true };

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
  // A session under way is in the address, so a reload deals again what is still due
  // (lib/route.ts), with the kinds chosen on this device. Only drawn on the client.
  const [kinds, setKinds] = useState<SessionKinds>(() => rememberedKinds());
  const [started, setStarted] = useState<"session" | "fast" | "rescue" | null>(() => (routeParam("review") === "session" ? "session" : null));
  const { setFocus, refresh } = shell;
  useRouteParam("review", started === "session" ? "session" : null);
  useEffect(() => {
    if (started === "session") setFocus(true);
    // Left mid-Fast review (the site closed, the phone locked): straight back
    // into it. A session keeps nothing: each answer is sent as it is given, so
    // starting again simply deals what is still due.
    if (resume.wasOpen()) {
      setFocus(true);
      setStarted("fast");
    }
  }, [setFocus]);

  const choose = (next: SessionKinds) => {
    setKinds(next);
    try {
      window.localStorage.setItem(KINDS_KEY, JSON.stringify(next));
    } catch {
      // A private window may refuse; the choice still holds for this visit.
    }
  };

  const begin = (how: "session" | "fast") => {
    setFocus(true);
    setStarted(how);
  };
  // The stuck words and their rescues (Rescue.tsx).
  const rescue = () => {
    setFocus(true);
    setStarted("rescue");
  };
  // Left by the close button or back: Fast review's marks are kept, to carry on from Today.
  const end = useCallback(() => {
    setStarted((was) => {
      if (was === "fast") resume.close();
      return null;
    });
    setFocus(false);
    refresh();
  }, [setFocus, refresh]);
  useBackLayer(started !== null, end);
  // Leaving the tab mid-session must give the header and tabs back.
  useEffect(() => () => setFocus(false), [setFocus]);

  if (started === "fast") return <FastReview shell={shell} onEnd={end} saved={resume.load()} />;
  if (started === "rescue") return <StuckList shell={shell} onEnd={end} />;
  if (started) return <Session shell={shell} kinds={kinds} onEnd={end} />;
  return (
    <Today
      shell={shell}
      kinds={kinds}
      onChoose={choose}
      onStart={() => begin("session")}
      onFast={() => begin("fast")}
      onRescue={rescue}
      onImport={onImport}
    />
  );
}

/** Before a session: what is due, what to include, and how many new sentences a day. */
function Today({
  shell,
  kinds,
  onChoose,
  onStart,
  onFast,
  onRescue,
  onImport,
}: {
  shell: Shell;
  kinds: SessionKinds;
  onChoose: (k: SessionKinds) => void;
  onStart: () => void;
  onFast: () => void;
  onRescue: () => void;
  onImport: () => void;
}) {
  const { summary: s, canWrite } = shell;
  if (!s) return null;
  // A Fast review left part way through today, to carry on.
  const keptFast = resume.load()?.marked ? resume.load() : null;

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
  // New sentences have no daily limit: they are mixed in as the session goes, so only the due ones are counted.
  const sentences = kinds.sentences ? s.dueSentences : 0;
  // New words waiting for Learn count once each, while they are included.
  const learning = kinds.learn ? s.toLearn : 0;
  const total = words + sentences + learning;
  const all = total + s.answeredToday;
  const share = (n: number) => `${all ? (100 * n) / all : 0}%`;

  return (
    <div className="cf-today">
      <p className="cf-today-date">{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</p>
      <h2 className="cf-today-title">Today</h2>

      <div className="cf-today-head">
        <p className="cf-today-n">{fmt(total)}</p>
        <p className="cf-today-sub">{total === 1 ? "card to review" : "cards to review"}</p>
      </div>
      {/* The day as one bar: what is done, then what is left, by kind. */}
      <div className="cf-daybar" role="img" aria-label={`${fmt(s.answeredToday)} done, ${fmt(total)} to go`}>
        <i className="is-done" style={{ width: share(s.answeredToday) }} />
        <i className="is-read" style={{ width: share(words) }} />
        <i className="is-sentence" style={{ width: share(kinds.sentences ? s.dueSentences : 0) }} />
        <i className="is-new" style={{ width: share(learning) }} />
      </div>
      {s.answeredToday > 0 && <p className="cf-today-done">{fmt(s.answeredToday)} done so far</p>}

      {/* The days either side of today: reviewed before, due after, by kind. */}
      <DayStrip summary={s} kinds={kinds} />

      {/* Words forgotten again and again: one button, opening their list and AI rescues (Rescue.tsx). */}
      <StuckWords onOpen={onRescue} />

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
                {fmt(s.dueSentences)} due again; new ones mixed in, from {fmt(s.newSentences)} readable
              </small>
            </span>
            <b>{fmt(s.dueSentences)}</b>
          </label>
        </li>
        {/* New words wait out of the review until they have been learned with sentences: in the session, a step every fifth card. */}
        {s.toLearn > 0 && (
          <li>
            <label className={`cf-kind is-new${kinds.learn ? "" : " is-off"}`}>
              <input type="checkbox" checked={kinds.learn} onChange={(e) => onChoose({ ...kinds, learn: e.target.checked })} />
              <i className="cf-tick" />
              <span>
                New words
                <small>Taught with sentences as you review</small>
              </span>
              <b>{fmt(s.toLearn)}</b>
            </label>
          </li>
        )}
      </ul>

      <div className="cf-answer">
        {/* Every Read card due, as a grid to sweep through: for a pile of easy ones. */}
        {((kinds.read && s.dueRead > 0) || keptFast) && (
          <button className="cf-answer-btn cf-fast-btn" onClick={onFast}>
            <span className="cf-fast-btn-label">
              <svg className="cf-bolt" viewBox="0 0 16 20" width="14" height="18" aria-hidden="true">
                <path d="M9.6 0.8 1.8 11.4h5.3L5.9 19.2l8.3-11.1H8.8z" fill="currentColor" />
              </svg>
              Fast review
            </span>
            <small>{keptFast ? `${fmt(keptFast.marked)} marked, carry on` : `${fmt(s.dueRead)} to read`}</small>
          </button>
        )}
        <button
          className="cf-answer-btn cf-answer-show"
          disabled={total === 0 && !(kinds.sentences && s.newSentences > 0) && !(kinds.learn && s.toLearn > 0)}
          onClick={onStart}
        >
          {!kinds.read && !kinds.recall && !kinds.sentences
            ? "Nothing chosen"
            : total === 0
              ? kinds.learn && s.toLearn > 0
                ? "Learn new words"
                : kinds.sentences && s.newSentences > 0
                  ? "Read new sentences"
                  : "Nothing due"
              : canWrite
                ? "Start reviewing"
                : "Look through the cards"}
        </button>
      </div>
    </div>
  );
}

/** A list's own review, from Cards › Lists: its words' Read and Recall cards, nothing else. */
export interface ListReview {
  list: string;
  /** Its words due when it began. */
  due: number;
}

/** A list's review takes both kinds of word card and no sentences. */
const LIST_KINDS: SessionKinds = { read: true, recall: true, sentences: false, learn: false };

export function Session({
  shell,
  kinds: chosen,
  onEnd,
  list = null,
}: {
  shell: Shell;
  /** What to include; a list's review sets its own. */
  kinds?: SessionKinds;
  onEnd: () => void;
  /** Only this list's words. */
  list?: ListReview | null;
}) {
  const { summary, canWrite, refresh } = shell;
  const kinds = list ? LIST_KINDS : (chosen ?? EVERYTHING);
  const [queue, setQueue] = useState<SessionCard[]>([]);
  // A word's definition written by the model, or undone (defs empty), on every queued card of it.
  const redefine = (word: string, pinyin: string | null, defs: Definition[]) =>
    setQueue((q) =>
      q.map((c) => {
        if (c.word?.word !== word) return c;
        const lost = !defs.length && c.word.defs.some((d) => d.aiPinyin);
        return { ...c, word: { ...c.word, pinyin: lost ? null : (c.word.pinyin ?? pinyin), defs } };
      }),
    );
  const [status, setStatus] = useState<"loading" | "ready" | "empty">("loading");
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  // Look up over the card, filled with its word (or sentence): back or × returns to the same card.
  // Look up over the card: the question it opens on, and the card, kept beside what is asked.
  const [looking, setLooking] = useState<{ q: string; from: LookupFrom } | null>(null);
  // Suspending the card's word: asked first ("ask", with how many sentences it would lock), then done ("busy").
  const [suspending, setSuspending] = useState<"ask" | "busy" | null>(null);
  const [wouldLock, setWouldLock] = useState<number | null>(null);
  const suspendBox = useRef<HTMLDivElement>(null);
  // A word just suspended, and the cards it took out of the queue, for Bring back.
  const [suspended, setSuspended] = useState<{ word: string; cards: SessionCard[]; relocked: number } | null>(null);
  const [resuming, setResuming] = useState(false);
  // After forgetting a sentence: choosing the words that were the trouble.
  const [tapped, setTapped] = useState<Set<string> | null>(null);
  /** Words of this card's sentence tapped for their meaning. */
  const looked = useRef(new Set<string>());
  // After Forgot, before it is sent: what went wrong, in the owner's words. Null when not forgetting.
  const [why, setWhy] = useState<string | null>(null);
  const whyBox = useRef<HTMLDivElement>(null);
  const whyInput = useRef<HTMLInputElement>(null);
  // The last answer given, to take back; and the streak as it stood before it.
  const latest = useRef<{ id: string; card: SessionCard; streak: number } | null>(null);
  const [undoing, setUndoing] = useState(false);
  // The note being written, while its box is open.
  const [noting, setNoting] = useState<string | null>(null);
  const [splitting, setSplitting] = useState<string | null>(null);
  const [last, setLast] = useState<Receipt | null>(null);
  // Every answer of this session, to look back over and change (Reviewed.tsx).
  const [log, setLog] = useState<Answered[]>([]);
  const [lookingBack, setLookingBack] = useState(false);
  // Got its in a row this session.
  const streak = useRef(0);
  // The card on its way out, and which way: answered cards slide off before the next arrives.
  const [leaving, setLeaving] = useState<Grade | "skip" | null>(null);
  const [answered, setAnswered] = useState(0);
  // New words' Learn steps, one every fifth card (components/Learn.tsx); none in a list's review.
  const ladder = useLadder({ list: null, enabled: !list && kinds.learn, canWrite });
  const { begin: beginStep, current: step } = ladder;
  /** Cards dealt since the last Learn step. */
  const sinceStep = useRef(0);

  // Kept going once nothing was due: new sentences only, from the whole pool.
  // Started with nothing due, it begins there.
  const [more, setMore] = useState(
    () =>
      !list && kinds.sentences && summary !== null && wordsDue(summary, kinds) + summary.dueSentences === 0,
  );

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
  useEffect(() => {
    looked.current = new Set();
  }, [card?.id]);

  const refill = useCallback(async () => {
    if (loading.current || exhausted.current) return;
    loading.current = true;
    try {
      // Answers kept on the device go first, so the server knows those cards were seen.
      if (outbox.getState().pending) await outbox.flush();
      const held = queueRef.current.map((c) => c.id);
      const { cards } = await get<{ cards: SessionCard[] }>("session", {
        ...today(),
        limit: BATCH,
        position: dealt.current + held.length,
        exclude: [...new Set([...held, ...recentIds.current, ...outbox.waitingCards()])].join(","),
        skip: recentWords.current.join(","),
        read: kinds.read ? undefined : 0,
        recall: kinds.recall ? undefined : 0,
        sentences: kinds.sentences ? undefined : 0,
        list: list?.list,
        more: more ? 1 : undefined,
      });
      if (!cards.length) exhausted.current = true;
      // The same card can't be in hand twice, whatever the timing.
      const have = new Set(queueRef.current.map((c) => c.id));
      const added = cards.filter((c) => !have.has(c.id));
      setQueue((q) => [...q, ...added]);
      setStatus(queueRef.current.length + added.length ? "ready" : "empty");
      setError(null);
    } catch (e) {
      setError(
        e instanceof TypeError
          ? "No connection. Answer the cards in hand; more come when it is back, and your answers are kept until then."
          : message(e),
      );
    } finally {
      loading.current = false;
    }
  }, [kinds, list?.list, more]);

  useEffect(() => {
    if (queue.length <= REFILL_AT) void refill();
  }, [queue.length, refill]);

  // Nothing left to review: the ladder's steps one after another, until every word on it is learned.
  useEffect(() => {
    if (status === "empty" && !queue.length && !step) beginStep();
  }, [status, queue.length, step, ladder.items, beginStep]);

  // For a bug filed now: the card on screen.
  useEffect(() => {
    if (!card) return;
    return bugs.note("card", {
      id: card.id,
      kind: card.kind,
      word: card.word?.word ?? null,
      meaning: card.meaning?.gloss ?? null,
      sentence: card.sentence ? { id: card.sentence.id, zh: card.sentence.zh } : null,
      revealed,
      answeredThisSession: answered,
    });
  }, [card, revealed, answered]);

  // Back online: deal again if the hand ran low while it was away.
  useEffect(() => {
    const back = () => {
      if (queueRef.current.length <= REFILL_AT) void refill();
    };
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  }, [refill]);

  // A new card: face down, and the clock starts. One brought back by Undo
  // comes back as it was left, answer showing, so it can be answered again.
  const undone = useRef<number | null>(null);
  useEffect(() => {
    const back = card !== null && undone.current === card.id;
    undone.current = null;
    setRevealed(back);
    setTapped(null);
    setWhy(null);
    setNoting(null);
    setSplitting(null);
    setSuspending(null);
    setLeaving(null);
    shownAt.current = performance.now();
    revealedAt.current = back ? shownAt.current : null;
  }, [card?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const post = useCallback(
    async (input: ReviewInput, shown: SessionCard, run: number) => {
      // Kept on the device first: if the connection is gone it goes later, from there.
      outbox.add(input);
      // While earlier answers wait, this one goes behind them, in the order given (and without a receipt).
      if (outbox.getState().stalled) return void outbox.flush();
      try {
        const result = await send<ReviewResult>("review", { ...input, sentAt: Date.now() });
        outbox.remove(input.id);
        if (!result.duplicate) setLast(receiptOf(shown, input.grade, result, input.id, run));
        setLog((l) => l.map((a) => (a.id === input.id ? { ...a, days: result.retired ? null : result.days } : a)));
        refresh();
      } catch (e) {
        // 409: the card had already left the queue (answered on another device). Nothing to resend.
        if (e instanceof ApiError && e.status === 409) return outbox.remove(input.id);
        outbox.stall(e);
      }
    },
    [refresh],
  );

  /** Take the top card off, after it has had time to slide away. */
  const next = (way: Grade | "skip") => {
    const drop = () => {
      dealt.current++;
      setQueue((q) => q.slice(1));
      // Every fifth card, a new word's Learn step, while there is one.
      if (++sinceStep.current >= LEARN_EVERY - 1 && beginStep()) sinceStep.current = 0;
      if (queueRef.current.length <= 1 && exhausted.current) setStatus("empty");
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return drop();
    setLeaving(way);
    window.setTimeout(drop, LEAVE_MS);
  };

  const answer = (grade: Grade, words: string[] = [], comment?: string) => {
    if (!card || leaving) return;
    setSuspended(null);
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
      comment: comment?.trim() || undefined,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      utcOffset: -new Date().getTimezoneOffset(),
      device: window.innerWidth < 700 ? "phone" : "desktop",
      position: dealt.current + 1,
    };
    recentIds.current = [...recentIds.current, card.id].slice(-IN_FLIGHT);
    if (card.word) recentWords.current = [...recentWords.current, card.word.word].slice(-IN_FLIGHT);
    latest.current = { id: input.id, card, streak: streak.current };
    setLog((l) => [...l, { id: input.id, card, grade, days: undefined }]);
    streak.current = grade === "good" ? streak.current + 1 : 0;
    void post(input, card, streak.current);
    setAnswered((n) => n + 1);
    next(grade);
  };

  /** Take the last answer back: the card returns to the top, face down, to be answered again. */
  const undo = async () => {
    const back = latest.current;
    if (!back || undoing) return;
    setUndoing(true);
    try {
      await send("review/undo", { id: back.id });
      latest.current = null;
      setLog((l) => l.filter((a) => a.id !== back.id));
      undone.current = back.card.id;
      recentIds.current = recentIds.current.filter((id) => id !== back.card.id);
      if (back.card.word) {
        const at = recentWords.current.lastIndexOf(back.card.word.word);
        if (at >= 0) recentWords.current = recentWords.current.filter((_, i) => i !== at);
      }
      streak.current = back.streak;
      dealt.current = Math.max(0, dealt.current - 1);
      setAnswered((n) => Math.max(0, n - 1));
      setQueue((q) => [back.card, ...q.filter((c) => c.id !== back.card.id)]);
      setStatus("ready");
      setLast(null);
      refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setUndoing(false);
    }
  };

  // The box for what went wrong comes into view when it opens.
  useEffect(() => {
    if (why !== null) whyBox.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [why !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const forget = () => {
    if (!card) return;
    // Words looked up on the back of a sentence come ticked: the likely culprits.
    if (card.kind === "sentence") setTapped(new Set(looked.current));
    setWhy("");
  };
  const sendForgot = () => answer("forgot", tapped ? [...tapped] : [], why ?? undefined);
  // Forgot held (FORGOT_HOLD_MS) or swiped up (FORGOT_SWIPE px) opens the box with the keyboard up,
  // so what tripped you can be typed straight away (the owner's ask). The box is mounted at once
  // and focused in the release itself: phones only raise the keyboard inside a gesture.
  const press = useRef<{ y: number; at: number } | null>(null);
  const [holding, setHolding] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipClick = useRef(false);
  const forgotGesture = {
    onPointerDown: (e: React.PointerEvent) => {
      // Kept on the button when the finger slides off it upwards, so the release still counts.
      e.currentTarget.setPointerCapture(e.pointerId);
      press.current = { y: e.clientY, at: Date.now() };
      holdTimer.current = setTimeout(() => setHolding(true), FORGOT_HOLD_MS);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (press.current && press.current.y - e.clientY >= FORGOT_SWIPE) setHolding(true);
    },
    onPointerUp: (e: React.PointerEvent) => {
      const p = press.current;
      press.current = null;
      if (holdTimer.current) clearTimeout(holdTimer.current);
      setHolding(false);
      if (!p || (Date.now() - p.at < FORGOT_HOLD_MS && p.y - e.clientY < FORGOT_SWIPE)) return;
      // The click that follows this release is the gesture's, not a tap.
      skipClick.current = true;
      setTimeout(() => (skipClick.current = false), 400);
      flushSync(forget);
      whyInput.current?.focus();
    },
    onPointerCancel: () => {
      press.current = null;
      if (holdTimer.current) clearTimeout(holdTimer.current);
      setHolding(false);
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };
  const backFromForgot = () => {
    setTapped(null);
    setWhy(null);
  };
  // Back steps out of what is open on the card before it leaves the session.
  useBackLayer(why !== null, backFromForgot);
  useBackLayer(noting !== null, () => setNoting(null));
  useBackLayer(suspending !== null, () => setSuspending(null));
  // The question comes into view when it opens.
  useEffect(() => {
    if (suspending === "ask") suspendBox.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [suspending, wouldLock]);
  useBackLayer(splitting !== null, () => setSplitting(null));

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

  // Suspend asks first, saying how many readable sentences need the word (they lock until it comes back).
  const askSuspend = () => {
    const w = card?.word?.word;
    if (!w) return;
    setSuspending("ask");
    setWouldLock(null);
    get<WordDetail>("word", { w })
      .then((d) => setWouldLock(d.sentences.readable))
      .catch(() => {
        // Asked without the number.
      });
  };
  // Too hard for now: the word's cards leave the session (and every session,
  // until brought back), history kept; so do queued sentences that need it.
  const suspendWord = async () => {
    const w = card?.word?.word;
    if (!w || suspending === "busy") return;
    setSuspending("busy");
    try {
      const r = await send<{ cards: number; relocked: number }>("word", { word: w, action: "suspend" });
      const its = (c: SessionCard) => (c.kind !== "sentence" ? c.word?.word === w : Boolean(c.sentence?.words.includes(w)));
      setSuspended({ word: w, cards: queue.filter(its), relocked: r.relocked });
      setQueue((q) => q.filter((c) => !its(c)));
      setSuspending(null);
      refresh();
    } catch (e) {
      setError(message(e));
      setSuspending("ask");
    }
  };
  const bringBack = async () => {
    if (!suspended || resuming) return;
    setResuming(true);
    try {
      await send("word", { word: suspended.word, action: "resume" });
      // Back on top, answer showing, as Undo brings a card back.
      if (suspended.cards[0]) undone.current = suspended.cards[0].id;
      setQueue((q) => [...suspended.cards, ...q.filter((c) => !suspended.cards.some((a) => a.id === c.id))]);
      setStatus("ready");
      setSuspended(null);
      refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setResuming(false);
    }
  };

  const reveal = () => {
    revealedAt.current = performance.now();
    setRevealed(true);
  };

  const words = summary ? wordsDue(summary, kinds) : 0;
  // New sentences aren't counted: they have no end, and come as long as the owner goes on.
  const left = list
    ? Math.max(0, list.due - answered)
    : summary
      ? words + (kinds.sentences ? summary.dueSentences : 0) + (kinds.learn ? summary.toLearn : 0)
      : 0;
  const progress = more ? 100 : answered + left ? (100 * answered) / (answered + left) : 0;

  return (
    <div className="cf-review">
      <div className="cf-session-top">
        <button className="cf-close" onClick={onEnd} aria-label="End session">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden>
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
          </svg>
        </button>
        {list && <span className="cf-session-list cf-zh">{list.list.slice(list.list.lastIndexOf("/") + 1)}</span>}
        <div className="cf-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
          <i style={{ width: `${progress}%` }} />
        </div>
        <span className="cf-left">{more ? "more" : fmt(left)}</span>
        {log.length > 0 && (
          <button className="cf-session-log" onClick={() => setLookingBack(true)} aria-label={`Look back over ${log.length} answers`}>
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <rect x="6" y="3" width="10" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
              <rect x="3.5" y="5" width="10" height="13" rx="2" fill="var(--cf-bg)" stroke="currentColor" strokeWidth="1.6" />
              <path d="M6.5 11.5l2 2 3.5-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {fmt(log.length)}
          </button>
        )}
      </div>
      {lookingBack && (
        <ReviewedSheet
          log={log}
          undoing={undoing}
          onUndo={
            canWrite && latest.current && latest.current.id === log[log.length - 1]?.id
              ? () => {
                  setLookingBack(false);
                  void undo();
                }
              : undefined
          }
          onClose={() => setLookingBack(false)}
        />
      )}

      {error && <p className="cf-error">{error}</p>}
      <Waiting />

      {status === "loading" && !card && !step && <Loading label="Getting your cards…" />}
      {ladder.saveError && <p className="cf-error">{ladder.saveError}</p>}
      {status === "empty" && !card && !step && (ladder.items !== null || !kinds.learn || list) && (
        <div className="cf-done">
          <p className="cf-done-zh">完</p>
          <p className="cf-muted">
            {answered > 0 ? `${fmt(answered)} answered. ` : ""}
            {more
              ? "That's every readable sentence."
              : left > 0
                ? "That's everything in hand."
                : list
                  ? "Nothing more due on this list today."
                  : "Nothing more due today."}
          </p>
          {/* Done with what was due: new sentences are there for as long as the owner wants them. */}
          {!list && !more && kinds.sentences && (summary?.newSentences ?? 0) > 0 && (
            <button
              className="cf-btn cf-keep-going"
              onClick={() => {
                exhausted.current = false;
                setMore(true);
                setStatus("loading");
              }}
            >
              Keep going with new sentences
            </button>
          )}
          {log.length > 0 && (
            <button className="cf-btn cf-btn-ghost" onClick={() => setLookingBack(true)}>
              Look back over {fmt(log.length)} {log.length === 1 ? "answer" : "answers"}
            </button>
          )}
          <button className={`cf-btn${!list && !more && kinds.sentences ? " cf-btn-ghost" : ""}`} onClick={onEnd}>
            Back to today
          </button>
        </div>
      )}

      {/* A new word's Learn step, when one is on show, comes before the next card. */}
      {step && <LearnCard ladder={ladder} shell={shell} />}
      {card && !step && (
        <article key={card.id} className={`cf-card is-${card.kind}${leaving ? ` is-leaving-${leaving}` : ""}`}>
          <div className="cf-card-kind">
            <span className="cf-kind-pill">
              <i className="cf-dot" />
              {KIND_NAME[card.kind]}
            </span>
            {card.isNew && <span className="cf-tag">new</span>}
            {card.kind === "sentence" && !card.isNew && <span className="cf-tag">{card.cleanReads} of 2 clean reads</span>}
            <span className="cf-card-tags">
              {card.word && <HskTags hsk={card.word.hsk} />}
              {card.word?.longku && <LongkuTag />}
              {card.word && aiDefined(card.word.defs) && <AiTag />}
              {card.kind === "sentence" && card.sentence?.sources.map((s) => (
                <span key={s} className="cf-tag">{s}</span>
              ))}
            </span>
          </div>
          <History h={card.history} />
          {card.note && noting === null && <p className="cf-note">{card.note}</p>}

          {card.kind === "read" && card.word && (
            <>
              <Word word={card.word.word} />
              {card.meaning && !revealed && <p className="cf-card-hint">One of its other meanings, one you split off.</p>}
              {card.sentence && (
                <>
                  <p className="cf-card-zh">
                    <SentenceText sentence={card.sentence} word={card.word.word} taps={revealed} />
                  </p>
                  {/* Its translation right under it, once the answer shows. */}
                  {revealed && card.sentence.en && <p className="cf-en cf-card-en-near">{card.sentence.en}</p>}
                  <SourceOf sentence={card.sentence} />
                </>
              )}
              {revealed && (
                <div className="cf-back">
                  {card.word.pinyin && <div className="cf-card-pinyin">{displayPinyin(card.word.pinyin)}</div>}
                  {card.meaning && <p className="cf-card-meaning">{card.meaning.gloss}</p>}
                  <Definitions
                    card={card}
                    canDefine={canWrite}
                    onDefined={(r) => redefine(card.word!.word, r.pinyin, r.defs)}
                    onUndone={() => redefine(card.word!.word, null, [])}
                    canSplit={canWrite && !card.meaning}
                    splitting={splitting}
                    onPick={setSplitting}
                    onSplit={split}
                    onMerge={merge}
                  />
                  {card.hook && <RescueHook hook={card.hook} />}
                  {card.contrast && <SynonymContrast contrast={card.contrast} />}
                </div>
              )}
            </>
          )}

          {card.kind === "produce" && card.word && (
            <>
              <ul className="cf-prompt">
                {promptOf(card).map((s) => (
                  <li key={s}>
                    {s}
                    {aiDefined(card.word!.defs) && (
                      <>
                        {" "}
                        <AiPill word={card.word!.word} onUndone={() => redefine(card.word!.word, null, [])} />
                      </>
                    )}
                  </li>
                ))}
              </ul>
              {card.sentence && blankOut(card.sentence.zh, card.word.word) && !revealed && (
                <p className="cf-card-zh">{blankOut(card.sentence.zh, card.word.word)}</p>
              )}
              {revealed && (
                <div className="cf-back">
                  <Word word={card.word.word} />
                  {card.word.pinyin && <div className="cf-card-pinyin">{displayPinyin(card.word.pinyin)}</div>}
                  {card.alternatives && card.alternatives.length > 0 && (
                    <p className="cf-muted cf-also">Also means this: {card.alternatives.join("、")}</p>
                  )}
                  {card.hook && <RescueHook hook={card.hook} />}
                  {card.contrast && <SynonymContrast contrast={card.contrast} />}
                  {card.sentence && (
                    <>
                      <p className="cf-card-zh">
                        <SentenceText sentence={card.sentence} word={card.word.word} taps />
                      </p>
                      {card.sentence.en && <p className="cf-en">{card.sentence.en}</p>}
                      <SourceOf sentence={card.sentence} />
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {card.kind === "sentence" && card.sentence && (
            <>
              <p className="cf-card-sentence">
                <SentenceText sentence={card.sentence} taps={revealed} onLook={(w) => looked.current.add(w)} />
              </p>
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

          {why !== null && (
            <div className="cf-why" ref={whyBox}>
              <label htmlFor="cf-why">What tripped you up?</label>
              <input
                id="cf-why"
                ref={whyInput}
                className="cf-input"
                maxLength={1000}
                enterKeyHint="done"
                placeholder="Optional: mixed it up with…, didn't know the tone…"
                value={why}
                onChange={(e) => setWhy(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendForgot()}
              />
            </div>
          )}

          {revealed && suspending === null && (
            // Character tiles, in the tab icons' face: 魚 Pleco (its fish), 记 a note, 停 suspend, 查 Look up.
            // While Suspend asks, its question stands where they were.
            <div className="cf-card-foot">
              {card.word && (
                <PlecoTile word={card.word.word} />
              )}
              {canWrite && noting === null && (
                <button className="cf-foot-btn is-note" onClick={() => setNoting(card.note ?? "")} aria-label={card.note ? "Edit note" : "Add a note"}>
                  <span className="cf-foot-zh" aria-hidden="true">
                    记
                  </span>
                  <small>{card.note ? "Edit note" : "Note"}</small>
                </button>
              )}
              {/* Too hard for now: 停, as in 暂停. Out of review, history kept, after asking; brought back from here or the Words tab. */}
              {canWrite && card.word && card.kind !== "sentence" && suspending === null && (
                <button className="cf-foot-btn is-suspend" onClick={askSuspend} aria-label="Suspend">
                  <span className="cf-foot-zh" aria-hidden="true">
                    停
                  </span>
                  <small>Suspend</small>
                </button>
              )}
              {/* The owner's only, like the tab: a lookup costs money. Filled in, not asked, so it can be edited first. */}
              {canWrite && (card.word?.word ?? card.sentence?.zh) && (
                <button className="cf-foot-btn is-look" onClick={() =>
                    setLooking({
                      q: card.word?.word ?? card.sentence?.zh ?? "",
                      from: {
                        card: card.id,
                        word: card.word?.word ?? null,
                        kind: card.kind,
                        via: "review",
                        sentence: card.sentence?.id ?? null,
                        session: session.current,
                        step: null,
                      },
                    })
                  } aria-label="Look up">
                  <span className="cf-foot-zh" aria-hidden="true">
                    查
                  </span>
                  <small>Look up</small>
                </button>
              )}
            </div>
          )}
          {suspending !== null && card.word && (
            <div className="cf-fix cf-suspend-ask" ref={suspendBox}>
              <p>
                Suspend <b className="cf-zh">{card.word.word}</b>? Its cards stop coming up, their history kept, and{" "}
                {wouldLock === null
                  ? "the sentences that need it lock"
                  : wouldLock === 0
                    ? "no readable sentence needs it"
                    : `${fmt(wouldLock)} readable ${wouldLock === 1 ? "sentence that needs it locks" : "sentences that need it lock"}`}{" "}
                until you bring it back.
              </p>
              <div className="cf-buttons">
                <button className="cf-btn cf-btn-ghost" onClick={() => setSuspending(null)} disabled={suspending === "busy"}>
                  Keep it
                </button>
                <button className="cf-btn" onClick={() => void suspendWord()} disabled={suspending === "busy"}>
                  {suspending === "busy" ? "Suspending…" : "Suspend"}
                </button>
              </div>
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

      {looking !== null && (
        <Sheet label="Look up" onClose={() => setLooking(null)}>
          <div className="cf-lk-sheet">
            <LookupPanel shell={shell} start={looking.q} from={looking.from} />
          </div>
        </Sheet>
      )}

      {/* A word just suspended, with the way back. */}
      {suspended && (
        <p className="cf-suspend-note">
          <span className="cf-zh">{suspended.word}</span> suspended
          {suspended.relocked > 0 && ` · ${fmt(suspended.relocked)} ${suspended.relocked === 1 ? "sentence" : "sentences"} locked`}
          <button className="cf-link" onClick={() => void bringBack()} disabled={resuming}>
            {resuming ? "Bringing back…" : "Bring back"}
          </button>
        </p>
      )}

      {/* What the last answer changed. */}
      {last && !suspended && (
        <ReceiptStrip r={last} undoing={undoing} onUndo={canWrite && latest.current?.id === last.id ? undo : undefined} />
      )}

      {/* The answer, at the foot of the screen, under the thumb. */}
      {step && <LearnAnswers ladder={ladder} />}
      {card && !step && (
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
          ) : why !== null ? (
            <>
              <button key="back" className="cf-answer-btn cf-answer-ghost" onClick={backFromForgot}>
                Back
              </button>
              {/* Its own key, and the release's click ignored: Forgot's hold opens this under the finger. */}
              <button key="done" className="cf-answer-btn cf-answer-forgot" onClick={() => !skipClick.current && sendForgot()}>
                Done
                <small>
                  {tapped
                    ? tapped.size
                      ? `${tapped.size} word${tapped.size === 1 ? "" : "s"} lapse`
                      : "none in particular"
                    : span(card.intervals.forgot)}
                </small>
              </button>
            </>
          ) : (
            <>
              <button
                key="forgot"
                className={`cf-answer-btn cf-answer-forgot cf-forgot-gesture${holding ? " is-holding" : ""}`}
                onClick={() => {
                  if (skipClick.current) skipClick.current = false;
                  else forget();
                }}
                {...forgotGesture}
              >
                Forgot
                <small>{holding ? "let go to type why" : span(card.intervals.forgot)}</small>
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
  canDefine,
  onDefined,
  onUndone,
  canSplit,
  splitting,
  onPick,
  onSplit,
  onMerge,
}: {
  card: SessionCard;
  canDefine: boolean;
  onDefined: (r: { pinyin: string | null; defs: Definition[] }) => void;
  onUndone: () => void;
  canSplit: boolean;
  splitting: string | null;
  onPick: (gloss: string | null) => void;
  onSplit: (gloss: string) => void;
  onMerge: (id: number) => void;
}) {
  const word = card.word!;
  const split = new Map(word.split.map((m) => [m.gloss, m.id]));
  if (!word.defs.length) {
    return (
      <>
        <p className="cf-muted">No definition on file. Look it up in Pleco.</p>
        {canDefine && <DefineButton word={word.word} onDefined={onDefined} />}
      </>
    );
  }
  return (
    <div className="cf-defs">
      {mainFirst(word.defs, word.pinyin).map((d, i) => (
        <div key={i} className="cf-def">
          {!d.own && d.p && d.p !== word.pinyin && <span className="cf-def-p">{displayPinyin(d.p)}</span>}
          <ul>
            {d.senses.map((s) => (
              <li
                key={s}
                className={[card.meaning?.gloss === s && "is-target", d.ai && "has-ai"].filter(Boolean).join(" ") || undefined}
              >
                {canSplit && !d.own && !split.has(s) ? (
                  <button className="cf-sense" onClick={() => onPick(splitting === s ? null : s)}>
                    {s}
                  </button>
                ) : (
                  <span className="cf-sense-text">{s}</span>
                )}
                {d.ai && (
                  <>
                    {" "}
                    <AiPill word={word.word} onUndone={onUndone} />
                  </>
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
