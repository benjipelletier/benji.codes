"use client";

// Settings › Algorithm: the scheduling and queue algorithm as its parameters,
// for the owner, who wanted to see "how the cookie is made" and then only the
// algorithm, not how the app works. By stage (FSRS, seeding from Pleco,
// Learn, the queue, sentences): each parameter's value, a one-line
// definition, what raising or lowering it does, and its name in the code.
// The values are the code's constants, imported from lib/, so the page can't
// drift from what runs. Then the queue's output now (route `algorithm`: the
// cards a session would deal first and why, due word cards by recall odds,
// what the one-word-a-day rule holds back). Read-only, the owner's choice.

import { useEffect, useState } from "react";
import type { QueueNow, QueueWhy, SessionCard } from "@chongfuxi/lib/api";
import { get, today } from "@chongfuxi/lib/client";
import { ROLLOVER_HOUR } from "@chongfuxi/lib/day";
import { AFTER_MISS, GAP, IN_PLAY, LADDER, LEARN_EVERY } from "@chongfuxi/lib/learn";
import { CLEAN_READS_TO_RETIRE, CYCLE, DUE_PER_NEW, REVIVED_CLEAN_READS } from "@chongfuxi/lib/review";
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
import { Loading, fmt, message } from "./shared";

const pct = (p: number) => `${Math.round(p * 100)}%`;
const ago = (days: number) => (days < 1 ? "due today" : days < 2 ? "due since yesterday" : `due ${Math.floor(days)} days ago`);

/** Why the queue dealt this card, in a sentence. */
function reason(why: QueueWhy | undefined): string {
  if (!why) return "";
  switch (why.line) {
    case "word":
      return why.odds === null
        ? "Never answered: ahead of all."
        : `Recall odds ${pct(why.odds)} (${ago(why.overdueDays)}).`;
    case "sentence":
      return `${ago(why.overdueDays)[0].toUpperCase()}${ago(why.overdueDays).slice(1)}; ${why.cleanReads} of ${CLEAN_READS_TO_RETIRE} clean reads.`;
    case "new":
      if (why.unlockedBy) return `Unlocked by ${why.unlockedBy}.`;
      if (why.forWord && why.need === "due") return `For ${why.forWord}: due or relearning.`;
      if (why.forWord && why.need === "weak") return `For ${why.forWord}: lowest stability.`;
      if (why.forWord && why.need === "learn") return `For ${why.forWord}: awaiting Learn.`;
      return "Day's shuffle.";
  }
}

function kindOf(c: SessionCard): { label: string; cls: string } {
  if (c.kind === "read") return { label: "Read", cls: "is-read" };
  if (c.kind === "produce") return { label: "Recall", cls: "is-recall" };
  return c.why?.line === "new" ? { label: "New sentence", cls: "is-new" } : { label: "Sentence", cls: "is-sentence" };
}

/** The cards a session would start with, with the place of a Learn step every LEARN_EVERY-th card (taken only while words wait). */
function NextUp({ cards }: { cards: SessionCard[] }) {
  const rows: Array<{ card: SessionCard } | { step: number }> = [];
  cards.forEach((card, i) => {
    rows.push({ card });
    if ((i + 1) % (LEARN_EVERY - 1) === 0) rows.push({ step: rows.length });
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
                <span className="cf-how-why">Learn step, every {LEARN_EVERY}th card while words wait.</span>
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
function OddsBars({ odds }: { odds: QueueNow["odds"] }) {
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

/** One parameter: its value, a one-line definition, what moving it does, and its name in the code. */
interface Param {
  name: string;
  value: string;
  code: string;
  does: string;
  up?: string;
  down?: string;
  more?: React.ReactNode;
}

const anchor = (title: string) => `alg-${title.replace(/\s+/g, "-").toLowerCase()}`;

const GROUPS: Array<{ title: string; file: string; params: Param[] }> = [
  {
    title: "FSRS",
    file: "lib/schedule.ts · lib/day.ts",
    params: [
      {
        name: "Request retention",
        value: pct(RETENTION),
        code: "RETENTION",
        does: "A card is due when its predicted recall falls to this.",
        up: "shorter intervals, more reviews",
        down: "longer intervals, more lapses",
      },
      { name: "Maximum interval", value: `${fmt(MAX_INTERVAL_DAYS)} days`, code: "MAX_INTERVAL_DAYS", does: "Interval cap." },
      { name: "Short-term steps", value: SAME_DAY_STEPS ? "On" : "Off", code: "SAME_DAY_STEPS", does: "No learning steps: the minimum interval is 1 day, Again included." },
      { name: "Fuzz", value: FUZZ ? "On" : "Off", code: "FUZZ", does: "Random spread on each interval, seeded by the answer." },
      {
        name: "Weights",
        value: `${FSRS_WEIGHTS.length}, default`,
        code: "FSRS_WEIGHTS",
        does: "ts-fsrs defaults, not optimised on the review log.",
        more: (
          <details className="cf-how-weights">
            <summary>w0–w{FSRS_WEIGHTS.length - 1}</summary>
            <ol start={0}>
              {FSRS_WEIGHTS.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ol>
          </details>
        ),
      },
      { name: "Grades", value: "Again · Good", code: "answer()", does: "Forgot is Again, Got it is Good. Hard and Easy are unused." },
      { name: "Day cutoff", value: `${String(ROLLOVER_HOUR).padStart(2, "0")}:00 local`, code: "ROLLOVER_HOUR", does: "Due today means due before the next cutoff." },
    ],
  },
  {
    title: "Seeding",
    file: "lib/schedule.ts (seedSchedule) · app/api/chongfuxi/review.ts (produceSeed)",
    params: [
      {
        name: "Initial stability",
        value: `${SEED_MIN_DAYS}–${SEED_CAP_DAYS} days`,
        code: "SEED_MIN_DAYS · SEED_CAP_DAYS",
        does: "Pleco's interval (score ÷ 100 days), clamped to this range.",
        up: "cap: well-known words return later",
        down: "cap: more of them are re-checked sooner",
      },
      {
        name: "Initial difficulty",
        value: `${SEED_DIFFICULTY.base} + ${SEED_DIFFICULTY.perMissRate}·m`,
        code: "SEED_DIFFICULTY",
        does: `m is Pleco's miss rate; clamped to 1–10; ${SEED_DIFFICULTY.unknown} with no answers.`,
      },
      { name: "Initial due", value: "At seeding", code: "seedSchedule()", does: "Last review set one stability back, so the card starts exactly due." },
      { name: "No Pleco record", value: "New", code: "newSchedule()", does: "State New, due now." },
      { name: "Recall card created", value: "First Good on Read", code: "submitReview()", does: "Until then a word has only its Read card." },
      {
        name: "Recall initial stability",
        value: `× ${RECALL_SEED_FACTOR}`,
        code: "RECALL_SEED_FACTOR",
        does: "Of the Read seed; New if Pleco has no record.",
      },
    ],
  },
  {
    title: "Learn",
    file: "lib/learn.ts · app/api/chongfuxi/learn.ts",
    params: [
      { name: "Ladder", value: LADDER.join(" → "), code: "LADDER", does: "Steps before a new Read card enters review; context is skipped with no sentence." },
      { name: "Words in play", value: String(IN_PLAY), code: "IN_PLAY", does: "Concurrent words; they take turns.", up: "each word recurs less often", down: "each word recurs sooner" },
      {
        name: "Return gap",
        value: LADDER.filter((l) => GAP[l] > 0)
          .map((l) => `${l} ${GAP[l]}`)
          .join(" · "),
        code: "GAP",
        does: "Turns before a word returns, by the step it returns for.",
      },
      { name: "Miss", value: `−1 step, ${AFTER_MISS} turns`, code: "AFTER_MISS", does: "Back a step, returning after this many turns." },
      { name: "Interleave", value: `1 per ${LEARN_EVERY} cards`, code: "LEARN_EVERY", does: "Learn steps in a review session while words wait.", down: "new words enter review faster" },
      { name: "Selection", value: "In progress, newest", code: "LEARN_ORDER", does: "Words part way up first, then by card id descending." },
      { name: "On completion", value: "Due next day, New", code: "recordSteps()", does: "Learn writes no review and changes no schedule." },
    ],
  },
  {
    title: "Queue",
    file: "app/api/chongfuxi/review.ts (nextCards) · lib/review.ts (interleave)",
    params: [
      { name: "Lines", value: "3", code: "nextCards()", does: "Due word cards, due sentence cards, new sentence cards." },
      { name: "Interleave", value: CYCLE.join(" · "), code: "CYCLE", does: "Repeats across batches; an empty line passes its turn on." },
      {
        name: "New sentence quota",
        value: `⌈due ÷ ${DUE_PER_NEW}⌉`,
        code: "DUE_PER_NEW",
        does: "Per batch while cards are due; 0 once nothing is due, until Keep going.",
        down: "more new sentences per review",
      },
      { name: "Word line order", value: "Retrievability ↑", code: "LEAST_LIKELY_FIRST", does: "Read and Recall together, by elapsed ÷ stability; never answered first; ties by md5(id, day)." },
      { name: "Sentence line order", value: "Due ↑", code: "nextCards()", does: "Oldest due first." },
      {
        name: "New line order",
        value: "Unlocked, then by need",
        code: "nextCards()",
        does: "Just unlocked (newest first); then one per word, round-robin, by the word's need: due or relearning, then lowest stability, then awaiting Learn; then unexposed words; then md5(key).",
      },
      { name: "Sibling burying", value: "1 word card per word per day", code: "nextCards()", does: "A word answered today holds its other word cards to the next day. Sentences aren't buried." },
    ],
  },
  {
    title: "Sentences",
    file: "lib/unlock.ts · lib/review.ts · app/api/chongfuxi/review.ts",
    params: [
      { name: "Unlock", value: "All words known", code: "makeUnlock()", does: "Each token a known word, or decomposable into known words (trailing 儿 allowed)." },
      { name: "Retire", value: `${CLEAN_READS_TO_RETIRE} clean reads`, code: "CLEAN_READS_TO_RETIRE", does: "On distinct days. Again resets the count.", up: "sentences stay in rotation longer" },
      { name: "Again on a sentence", value: "Tapped words lapse", code: "lapseTargets()", does: "Their Read cards are graded Again; a tapped word not in the deck passes it to its deck words." },
      { name: "Revive on word Again", value: "Shown + 1", code: "submitReview()", does: "The retired sentence it was shown in, and one other retired sentence with the word." },
      { name: "Revived state", value: `Due next day, ${REVIVED_CLEAN_READS} clean read`, code: "REVIVED_CLEAN_READS", does: "One clean read from retiring again." },
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

export function Algorithm() {
  const [live, setLive] = useState<QueueNow | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    get<QueueNow>("algorithm", { ...today() })
      .then(setLive)
      .catch((e) => setError(message(e)));
  }, []);

  return (
    <div className="cf-how">
      <header className="cf-how-head">
        <h1>Algorithm</h1>
        {/* Buttons, not links: a link's #hash would be a history entry, and back belongs to lib/back.ts. */}
        <nav className="cf-how-toc" aria-label="Stages">
          {[...GROUPS.map((g) => g.title), "Queue now"].map((t) => (
            <button key={t} onClick={() => document.getElementById(anchor(t))?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              {t}
            </button>
          ))}
        </nav>
      </header>

      {GROUPS.map((g) => (
        <section key={g.title} id={anchor(g.title)} className="cf-section cf-how-group">
          <h2 className="cf-h2">{g.title}</h2>
          <ul className="cf-how-params">
            {g.params.map((p) => (
              <ParamRow key={p.name} p={p} />
            ))}
          </ul>
          <p className="cf-how-file">
            <code>{g.file}</code>
          </p>
        </section>
      ))}

      <section id={anchor("Queue now")} className="cf-section cf-how-group">
        <h2 className="cf-h2">Queue now</h2>
        {error && <p className="cf-error">{error}</p>}
        {!live && !error && <Loading label="Asking the queue…" />}
        {live && (
          <>
            <h3 className="cf-how-sub">Due word cards by recall odds</h3>
            <OddsBars odds={live.odds} />
            <p className="cf-how-file">Buried till tomorrow: {fmt(live.heldBack)}</p>
            <h3 className="cf-how-sub">First cards dealt</h3>
            {live.next.length ? <NextUp cards={live.next} /> : <p className="cf-muted">Nothing due.</p>}
          </>
        )}
      </section>
    </div>
  );
}
