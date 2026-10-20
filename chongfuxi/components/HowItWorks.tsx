"use client";

// Settings › How cards are chosen: the whole algorithm as its parameters,
// for the owner, who asked to see "how the cookie is made" and then for the
// page to be about the parameters. Each stage (the memory model, the start
// from Pleco, Learn, the session's queue, sentences) lists its settings: the
// value, what it controls, what raising or lowering it would do, and its name
// in the code. The values are the code's own constants, imported, so the page
// can't drift from what runs. Under them, what they produce today (route
// `how`: the cards a session would deal first and why, what waits, what Learn
// takes next). Read-only: the owner chose to see them, not tune them here.

import { useEffect, useState } from "react";
import type { HowItWorksLive, LearnStep, QueueWhy, SessionCard } from "@chongfuxi/lib/api";
import { get, today } from "@chongfuxi/lib/client";
import { ROLLOVER_HOUR } from "@chongfuxi/lib/day";
import {
  AFTER_MISS,
  GAP,
  IN_PLAY,
  LADDER,
  LEARN_EVERY,
  LEARN_MAX,
  LEARN_SENTENCE_MAX_HAN,
  LEARN_SESSION_MAX,
  SENTENCES_PER_WORD,
} from "@chongfuxi/lib/learn";
import {
  CLEAN_READS_TO_RETIRE,
  CONTEXT_CANDIDATES,
  CONTEXT_IDEAL_HAN,
  CONTEXT_MIN_HAN,
  CONTEXT_POOL,
  CYCLE,
  DUE_PER_NEW,
  REFILL_AT,
  REVIVED_CLEAN_READS,
  SESSION_BATCH,
  WORD_POOL_FACTOR,
} from "@chongfuxi/lib/review";
import {
  FSRS_WEIGHTS,
  FUZZ,
  MAX_INTERVAL_DAYS,
  RECALL_SEED_FACTOR,
  RETENTION,
  SAME_DAY_STEPS,
  SEED_CAP_DAYS,
  SEED_DIFFICULTY,
  SEED_MIN_DAYS,
} from "@chongfuxi/lib/schedule";
import * as wordpage from "@chongfuxi/lib/wordpage";
import { Loading, fmt, message, type Shell } from "./shared";

const STEP: Record<LearnStep, string> = { meet: "meet it", context: "read it in a sentence", cloze: "fill it into a gap", word: "the word alone" };
const LINE: Record<(typeof CYCLE)[number], string> = { word: "word card", sentence: "due sentence", new: "new sentence" };
const pct = (p: number) => `${Math.round(p * 100)}%`;
const ago = (days: number) => (days < 1 ? "due today" : days < 2 ? "due since yesterday" : `due ${Math.floor(days)} days ago`);

/** Why the queue dealt this card, in a sentence. */
function reason(why: QueueWhy | undefined): string {
  if (!why) return "";
  switch (why.line) {
    case "word":
      return why.odds === null
        ? "Never answered here or in Pleco, so it goes first."
        : `${pct(why.odds)} chance you'd remember it now (${ago(why.overdueDays)}). Lowest odds go first.`;
    case "sentence":
      return `${ago(why.overdueDays)[0].toUpperCase()}${ago(why.overdueDays).slice(1)}; ${why.cleanReads} of ${CLEAN_READS_TO_RETIRE} clean reads. Oldest due goes first.`;
    case "new":
      if (why.unlockedBy) return `Just unlocked by learning ${why.unlockedBy}.`;
      if (why.forWord && why.need === "due") return `For ${why.forWord}, due today or just forgotten.`;
      if (why.forWord && why.need === "weak") return `For ${why.forWord}, one of your weakest words.`;
      if (why.forWord && why.need === "learn") return `For ${why.forWord}, still waiting for Learn.`;
      return "Next in the day's shuffle.";
  }
}

function kindOf(c: SessionCard): { label: string; cls: string } {
  if (c.kind === "read") return { label: "Read", cls: "is-read" };
  if (c.kind === "produce") return { label: "Recall", cls: "is-recall" };
  return c.why?.line === "new" ? { label: "New sentence", cls: "is-new" } : { label: "Sentence", cls: "is-sentence" };
}

/** The cards a session would start with, a Learn step every LEARN_EVERY-th place while words wait. */
function NextUp({ cards, learn }: { cards: SessionCard[]; learn: boolean }) {
  const rows: Array<{ card: SessionCard } | { step: number }> = [];
  cards.forEach((card, i) => {
    rows.push({ card });
    if (learn && (i + 1) % (LEARN_EVERY - 1) === 0) rows.push({ step: rows.length });
  });
  let n = 0;
  return (
    <ol className="cf-how-next">
      {rows.map((r) => {
        n++;
        if ("step" in r) {
          return (
            <li key={`step${r.step}`} className="cf-how-row is-learn">
              <span className="cf-how-n">{n}</span>
              <span className="cf-how-body">
                <span className="cf-how-kind is-learn">Learn</span>
                <span className="cf-how-why">A step for a new word on the Learn ladder.</span>
              </span>
            </li>
          );
        }
        const c = r.card;
        const k = kindOf(c);
        const text = c.kind === "sentence" ? c.sentence?.zh : c.meaning ? `${c.word?.word} (${c.meaning.gloss})` : c.word?.word;
        return (
          <li key={c.id} className="cf-how-row">
            <span className="cf-how-n">{n}</span>
            <span className="cf-how-body">
              <span className={`cf-how-kind ${k.cls}`}>{k.label}</span>
              {c.kind !== "sentence" && c.word ? (
                <button className="cf-how-text cf-zh" onClick={() => wordpage.openWordPage(c.word!.word)}>
                  {text}
                </button>
              ) : (
                <span className="cf-how-text cf-zh">{text}</span>
              )}
              <span className="cf-how-why">{reason(c.why)}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Due word cards by their odds, as one bar each: where the word line stands. */
function OddsBars({ odds }: { odds: HowItWorksLive["odds"] }) {
  const most = Math.max(1, ...odds.map((o) => o.count));
  const total = odds.reduce((n, o) => n + o.count, 0);
  if (!total) return <p className="cf-muted">No word cards waiting today.</p>;
  return (
    <div className="cf-how-bars" role="table" aria-label="Due word cards by the odds you'd remember them">
      {odds.map((o) => (
        <div key={o.label} className="cf-how-bar" role="row">
          <span role="rowheader">{o.label}</span>
          <span className="cf-how-track" role="cell">
            <i style={{ width: `${(100 * o.count) / most}%` }} title={`${o.label}: ${fmt(o.count)}`} />
          </span>
          <b role="cell">{fmt(o.count)}</b>
        </div>
      ))}
    </div>
  );
}

/** One setting: its value, what it controls, what moving it would do, and its name in the code. */
interface Param {
  name: string;
  value: string;
  code: string;
  does: string;
  up?: string;
  down?: string;
  more?: React.ReactNode;
}

const STEPS = LADDER.map((l) => STEP[l]);
const anchor = (title: string) => `how-${title.replace(/\s+/g, "-").toLowerCase()}`;
const onOff = (b: boolean) => (b ? "On" : "Off");

/** Every parameter, by the stage of a card's life it belongs to. */
const GROUPS: Array<{ title: string; about: string; file: string; params: Param[] }> = [
  {
    title: "Memory model",
    about: "Every card has a strength (about how many days until you'd likely forget it) and a difficulty, kept by FSRS. These decide when it comes due.",
    file: "lib/schedule.ts · lib/day.ts",
    params: [
      {
        name: "Target recall",
        value: pct(RETENTION),
        code: "RETENTION",
        does: "A card comes due when the odds you'd remember it fall to this.",
        up: "shorter gaps, more reviews a day, fewer misses",
        down: "longer gaps, fewer reviews, more forgetting",
      },
      {
        name: "Same-day repeats",
        value: onOff(SAME_DAY_STEPS),
        code: "SAME_DAY_STEPS",
        does: "Off: every answer, Forgot included, sends a card at least a day away. It also keeps one word to once a day.",
      },
      {
        name: "Interval fuzz",
        value: onOff(FUZZ),
        code: "FUZZ",
        does: "Each interval is nudged a little at random, so cards added together don't keep coming back together.",
      },
      {
        name: "Longest gap",
        value: `${fmt(Math.round(MAX_INTERVAL_DAYS / 365))} years`,
        code: "MAX_INTERVAL_DAYS",
        does: "The most a card can go between showings.",
        down: "even your strongest words come back now and then",
      },
      {
        name: "Answer buttons",
        value: "Got it · Forgot",
        code: "answer() in lib/schedule.ts",
        does: "Got it is FSRS's Good and Forgot its Again. Hard and Easy aren't used.",
      },
      {
        name: "Model weights",
        value: `${FSRS_WEIGHTS.length}, defaults`,
        code: "FSRS_WEIGHTS",
        does: "How strength and difficulty move after each answer. These are ts-fsrs's defaults, not yet fitted to your own answers.",
        more: (
          <details className="cf-how-weights">
            <summary>Show the weights</summary>
            <ol start={0}>
              {FSRS_WEIGHTS.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ol>
          </details>
        ),
      },
      {
        name: "Day turns over",
        value: `${ROLLOVER_HOUR}:00`,
        code: "ROLLOVER_HOUR",
        does: "Today ends at this hour, so a late session counts for the day it started in. Due today means due before then.",
      },
    ],
  },
  {
    title: "Starting from Pleco",
    about: "A word Pleco had tested doesn't start from nothing: its Pleco score sets where its cards begin. One Pleco never tested starts new.",
    file: "lib/schedule.ts (seedSchedule) · app/api/chongfuxi/review.ts (produceSeed)",
    params: [
      {
        name: "Starting strength, at most",
        value: `${SEED_CAP_DAYS} days`,
        code: "SEED_CAP_DAYS",
        does: "Pleco's interval becomes the card's strength, up to this. Pleco's top score stands for 512 days.",
        up: "words Pleco knew well come back later",
        down: "more of them get re-checked sooner",
      },
      {
        name: "Starting strength, at least",
        value: `${SEED_MIN_DAYS} days`,
        code: "SEED_MIN_DAYS",
        does: "The floor for a word Pleco barely knew.",
      },
      {
        name: "Starting difficulty",
        value: `${SEED_DIFFICULTY.base} + ${SEED_DIFFICULTY.perMissRate} × miss rate`,
        code: "SEED_DIFFICULTY",
        does: `From the share of Pleco's answers that were wrong, kept between 1 and 10; ${SEED_DIFFICULTY.unknown} if Pleco has no answers.`,
      },
      {
        name: "Seeded cards due",
        value: "At once",
        code: "seedSchedule()",
        does: "Everything is shown here once, and the schedule is earned from there. Pleco's real gap since it last showed a word isn't counted as memory.",
      },
      {
        name: "Recall opens",
        value: "First Got it on Read",
        code: "submitReview()",
        does: "Recognising a word once opens its Recall card: from the meaning, give the word.",
      },
      {
        name: "Recall's starting share",
        value: `× ${RECALL_SEED_FACTOR}`,
        code: "RECALL_SEED_FACTOR",
        does: "Recalling is harder than recognising: a word Pleco tested starts its Recall card at this share of the Read card's strength. Without Pleco, Recall starts new.",
      },
    ],
  },
  {
    title: "Learn",
    about: "A new word's Read card stays out of review until Learn has taken it up a short ladder, with the corpus's sentences.",
    file: "lib/learn.ts · app/api/chongfuxi/learn.ts",
    params: [
      { name: "The ladder", value: `${LADDER.length} steps`, code: "LADDER", does: `${STEPS.join(" → ")}. A word with no sentence skips reading one.` },
      {
        name: "Words in play",
        value: String(IN_PLAY),
        code: "IN_PLAY",
        does: "Words on the ladder at once. They take turns; the rest wait to be met.",
        up: "more variety, each word comes back less often",
        down: "each word repeats sooner",
      },
      {
        name: "Turns before it's back",
        value: LADDER.filter((l) => GAP[l] > 0)
          .map((l) => GAP[l])
          .join(" · "),
        code: "GAP",
        does: `Other words shown before a word returns, for ${LADDER.filter((l) => GAP[l] > 0)
          .map((l) => STEP[l])
          .join(", ")}. The gap grows as it climbs.`,
      },
      {
        name: "After a miss",
        value: `${AFTER_MISS} turns`,
        code: "AFTER_MISS",
        does: "A missed word goes back a step and returns this soon, with a sentence it hasn't been shown.",
      },
      {
        name: "Learn in a session",
        value: `Every ${LEARN_EVERY}th card`,
        code: "LEARN_EVERY",
        does: "How often a review session stops for a Learn step while words wait.",
        down: "new words get learnt faster, reviews take longer",
      },
      { name: "Learn order", value: "Started, then newest", code: "LEARN_ORDER", does: "Words part way up the ladder first, then the ones added most recently." },
      { name: "Words loaded", value: `${LEARN_SESSION_MAX} · ${LEARN_MAX}`, code: "LEARN_SESSION_MAX · LEARN_MAX", does: "Words a review session loads to learn, and a list's Learn drill." },
      { name: "Sentences per word", value: String(SENTENCES_PER_WORD), code: "SENTENCES_PER_WORD", does: "Enough for a new sentence at every step, and again after a miss: readable ones first, then ones one word away." },
      { name: "Longest teaching sentence", value: `${LEARN_SENTENCE_MAX_HAN} characters`, code: "LEARN_SENTENCE_MAX_HAN", does: "Longer is too much to read while learning a word." },
      { name: "Learn and schedules", value: "Untouched", code: "recordSteps()", does: "Learn never counts as an answer. Finishing the ladder makes the card due the next day, still new." },
    ],
  },
  {
    title: "The session queue",
    about: "A session deals from three lines (due word cards, due sentences, new sentences), each in its own order, in a fixed mix.",
    file: "app/api/chongfuxi/review.ts (nextCards) · lib/review.ts (interleave)",
    params: [
      {
        name: "Deal cycle",
        value: `${CYCLE.length} cards`,
        code: "CYCLE",
        does: `${CYCLE.map((c) => LINE[c]).join(" → ")}, again and again. A line with nothing left passes its turn on.`,
      },
      {
        name: "New sentences while cards are due",
        value: `1 per ${DUE_PER_NEW} due`,
        code: "DUE_PER_NEW",
        does: "So they thin out near the end. With nothing due there are none, until you choose to keep going.",
        down: "more new sentences mixed into reviews",
      },
      {
        name: "Word cards order",
        value: "Lowest odds first",
        code: "LEAST_LIKELY_FIRST",
        does: "Read and Recall in one line: the ones you're likeliest to have lost first, never-answered ones ahead of all. Ties are shuffled once a day.",
      },
      { name: "Due sentences order", value: "Oldest due first", code: "nextCards()", does: "By due date, not by how well their words are known." },
      {
        name: "New sentences order",
        value: "Unlocked, then neediest",
        code: "nextCards()",
        does: "Ones a word just unlocked first. Then one per word before any word gets a second, going by the word that needs it most (due today or just forgotten, then weakest, then waiting for Learn), then words never read in a sentence, then a shuffle.",
      },
      {
        name: "One word a day",
        value: "On",
        code: "nextCards()",
        does: "Once a word is answered today, its other cards wait till tomorrow. Word cards only: a sentence can still hold it.",
      },
      { name: "Batch", value: `${SESSION_BATCH}, refill at ${REFILL_AT}`, code: "SESSION_BATCH · REFILL_AT", does: "Cards a session fetches at a time, and how few left before it fetches more. The cycle carries on across batches." },
      { name: "Word cards read per batch", value: `× ${WORD_POOL_FACTOR}`, code: "WORD_POOL_FACTOR", does: "Read before one card per word is kept, so a word with two cards due doesn't leave the batch short." },
    ],
  },
  {
    title: "Sentences",
    about: "A sentence is shown only once you can read it, and leaves once you've read it cleanly enough.",
    file: "lib/unlock.ts · lib/review.ts · app/api/chongfuxi/review.ts",
    params: [
      {
        name: "Readable when",
        value: "Every word known",
        code: "makeUnlock()",
        does: "A deck word not suspended, a marked name, or a word that splits into known words (这个 from 这 and 个). That split also passes words like 式样 when you know 式 and 样.",
      },
      {
        name: "Clean reads to retire",
        value: `${CLEAN_READS_TO_RETIRE}, on different days`,
        code: "CLEAN_READS_TO_RETIRE",
        does: "Two clean reads in one day count once. Forgot starts the count again.",
        up: "sentences stay in rotation longer",
      },
      {
        name: "Forgetting a word brings back",
        value: "2 sentences",
        code: "submitReview()",
        does: "The retired sentence it was shown in, and one other retired sentence with the word. Words you tap after Forgot on a sentence lapse and bring one back each.",
      },
      { name: "Brought back with", value: `${REVIVED_CLEAN_READS} clean read`, code: "REVIVED_CLEAN_READS", does: "Due tomorrow, one clean read from retiring again." },
      { name: "A Read card's sentences", value: `Rotates ${CONTEXT_POOL}`, code: "CONTEXT_POOL", does: `Each review shows the next of its ${CONTEXT_POOL} best readable sentences, from ${CONTEXT_CANDIDATES} ranked (CONTEXT_CANDIDATES).` },
      { name: "Shortest context", value: `${CONTEXT_MIN_HAN} characters`, code: "CONTEXT_MIN_HAN", does: "Shorter is used only when a word has nothing longer." },
      { name: "Best context length", value: `${CONTEXT_IDEAL_HAN} characters`, code: "CONTEXT_IDEAL_HAN", does: "Sentences nearest this length go first: long enough to say something, short enough to read at a glance." },
    ],
  },
];

function ParamRow({ p }: { p: Param }) {
  return (
    <li className="cf-how-param">
      <div className="cf-how-ph">
        <span className="cf-how-pname">{p.name}</span>
        <span className="cf-how-pval">{p.value}</span>
      </div>
      <p className="cf-how-pdoes">{p.does}</p>
      {(p.up || p.down) && (
        <p className="cf-how-pmove">
          {p.up && (
            <span>
              <b aria-label="Higher">↑</b> {p.up}
            </span>
          )}
          {p.down && (
            <span>
              <b aria-label="Lower">↓</b> {p.down}
            </span>
          )}
        </p>
      )}
      {p.more}
      <code className="cf-how-pcode">{p.code}</code>
    </li>
  );
}

export function HowItWorks({ shell }: { shell: Shell }) {
  const s = shell.summary!;
  const [live, setLive] = useState<HowItWorksLive | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    get<HowItWorksLive>("how", { ...today() })
      .then(setLive)
      .catch((e) => setError(message(e)));
  }, []);

  return (
    <div className="cf-how">
      <header className="cf-how-head">
        <h1>How cards are chosen</h1>
        <p className="cf-muted">
          Every setting the algorithm runs on, by stage, with what changing it would do. The values are read from the code. Under them,
          what they produce today.
        </p>
        {/* Buttons, not links: a link's #hash would be a history entry, and back belongs to lib/back.ts. */}
        <nav className="cf-how-toc" aria-label="Stages">
          {[...GROUPS.map((g) => g.title), "Today"].map((t) => (
            <button key={t} onClick={() => document.getElementById(anchor(t))?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              {t}
            </button>
          ))}
        </nav>
      </header>

      {GROUPS.map((g) => (
        <section key={g.title} id={anchor(g.title)} className="cf-section cf-how-group">
          <h2 className="cf-h2">{g.title}</h2>
          <p className="cf-muted cf-how-about">{g.about}</p>
          <ul className="cf-how-params">
            {g.params.map((p) => (
              <ParamRow key={p.name} p={p} />
            ))}
          </ul>
          <p className="cf-how-file">
            In <code>{g.file}</code>
          </p>
        </section>
      ))}

      <section id={anchor("Today")} className="cf-section cf-how-group">
        <h2 className="cf-h2">Today</h2>
        <p className="cf-muted cf-how-about">What these settings produce on your deck right now.</p>
        <dl className="cf-how-stats">
          <div>
            <dt>Read due</dt>
            <dd>{fmt(s.dueRead)}</dd>
          </div>
          <div>
            <dt>Recall due</dt>
            <dd>{fmt(s.dueRecall)}</dd>
          </div>
          <div>
            <dt>Sentences due</dt>
            <dd>{fmt(s.dueSentences)}</dd>
          </div>
          <div>
            <dt>New sentences ready</dt>
            <dd>{fmt(s.newSentences)}</dd>
          </div>
          <div>
            <dt>Words waiting for Learn</dt>
            <dd>{fmt(s.toLearn)}</dd>
          </div>
          <div>
            <dt>Held back till tomorrow</dt>
            <dd>{live ? fmt(live.heldBack) : "…"}</dd>
          </div>
        </dl>
        {error && <p className="cf-error">{error}</p>}
        {!live && !error && <Loading label="Asking the queue…" />}
        {live && (
          <>
            <h3 className="cf-how-sub">Word cards waiting, by the odds you&apos;d remember them</h3>
            <OddsBars odds={live.odds} />
            <h3 className="cf-how-sub">If you started a session now</h3>
            {live.next.length ? (
              <NextUp cards={live.next} learn={s.toLearn > 0} />
            ) : (
              <p className="cf-muted">Nothing is due: a session would offer new sentences only.</p>
            )}
            {live.learnNext.length > 0 && (
              <>
                <h3 className="cf-how-sub">Learn takes these next</h3>
                <p className="cf-how-words">
                  {live.learnNext.map((w) => (
                    <button key={w} className="cf-lk-wchip" onClick={() => wordpage.openWordPage(w)}>
                      <span className="cf-zh">{w}</span> ›
                    </button>
                  ))}
                </p>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
