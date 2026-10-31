"use client";

// Settings › Algorithm: the scheduling and queue algorithm as a compact table
// of its parameters, by stage (FSRS, seeding, Learn, queue, sentences): name,
// value, name in the code. The owner wanted "how the cookie is made", then
// only the algorithm, then compact: no prose. The values are the code's
// constants, imported from lib/, so the page can't drift from what runs.
// Then the queue now (route `algorithm`): due word cards by recall odds, what
// burying holds back, and the first cards dealt with why. Read-only.

import { useEffect, useState } from "react";
import type { QueueNow, QueueWhy, SessionCard } from "@chongfuxi/lib/api";
import { get, today } from "@chongfuxi/lib/client";
import { ROLLOVER_HOUR } from "@chongfuxi/lib/day";
import { AFTER_MISS, GAP, IN_PLAY, LADDER, LEARN_EVERY } from "@chongfuxi/lib/learn";
import { CLEAN_READS_TO_RETIRE, CYCLE, DUE_PER_NEW, MISS_EVERY, RESCUE_CLEAR, UNANSWERED_EVERY, REVIVED_CLEAN_READS } from "@chongfuxi/lib/review";
import { REVIVE } from "@chongfuxi/lib/revive";
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
const ago = (days: number) => (days < 1 ? "due today" : `${Math.floor(days)}d overdue`);

/** Why the queue dealt this card, in a sentence. */
function reason(why: QueueWhy | undefined): string {
  if (!why) return "";
  switch (why.line) {
    case "word":
      return why.odds === null
        ? "never answered"
        : `R ${pct(why.odds)}, ${ago(why.overdueDays)}`;
    case "sentence":
      return `${ago(why.overdueDays)}, ${why.cleanReads}/${CLEAN_READS_TO_RETIRE} clean`;
    case "new":
      if (why.unlockedBy) return `unlocked by ${why.unlockedBy}`;
      if (why.forWord && why.need === "due") return `${why.forWord}: due`;
      if (why.forWord && why.need === "weak") return `${why.forWord}: weakest`;
      if (why.forWord && why.need === "learn") return `${why.forWord}: awaiting Learn`;
      return "shuffle";
  }
}

function kindOf(c: SessionCard): { label: string; cls: string } {
  if (c.kind === "read") return { label: "Read", cls: "is-read" };
  if (c.kind === "produce") return { label: "Recall", cls: "is-recall" };
  return c.why?.line === "new" ? { label: "New", cls: "is-new" } : { label: "Sentence", cls: "is-sentence" };
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
                <span className="cf-how-why">if words wait</span>
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

/** One parameter: name, value, its name in the code; `more` folds out under it. */
type Param = [name: string, value: string, code: string, more?: React.ReactNode];

const WEIGHTS = (
  <details className="cf-alg-weights">
    <summary>w0–w{FSRS_WEIGHTS.length - 1}</summary>
    <ol start={0}>
      {FSRS_WEIGHTS.map((w, i) => (
        <li key={i}>{w}</li>
      ))}
    </ol>
  </details>
);

const GROUPS: Array<{ title: string; params: Param[] }> = [
  {
    title: "FSRS",
    params: [
      ["Retention", pct(RETENTION), "RETENTION"],
      ["Max interval", `${fmt(MAX_INTERVAL_DAYS)} d`, "MAX_INTERVAL_DAYS"],
      ["Short-term steps", SAME_DAY_STEPS ? "On" : "Off", "SAME_DAY_STEPS"],
      ["Fuzz", FUZZ ? "On" : "Off", "FUZZ"],
      ["Weights", `${FSRS_WEIGHTS.length}, default`, "FSRS_WEIGHTS", WEIGHTS],
      ["Grades", "Again · Good", "answer()"],
      ["Day cutoff", `${String(ROLLOVER_HOUR).padStart(2, "0")}:00`, "ROLLOVER_HOUR"],
    ],
  },
  {
    title: "Seeding",
    params: [
      ["Initial stability", `${SEED_MIN_DAYS}–${SEED_CAP_DAYS} d`, "SEED_MIN_DAYS · SEED_CAP_DAYS"],
      ["Initial difficulty", `${SEED_DIFFICULTY.base} + ${SEED_DIFFICULTY.perMissRate}·miss rate`, "SEED_DIFFICULTY"],
      ["Recall stability", `× ${RECALL_SEED_FACTOR}`, "RECALL_SEED_FACTOR"],
      ["Recall opens", "1st Good on Read", "submitReview()"],
    ],
  },
  {
    title: "Learn",
    params: [
      ["Ladder", LADDER.join(" → "), "LADDER"],
      ["In play", String(IN_PLAY), "IN_PLAY"],
      [
        "Return gap",
        LADDER.filter((l) => GAP[l] > 0)
          .map((l) => GAP[l])
          .join(" · "),
        "GAP",
      ],
      ["Miss", `−1 step, ${AFTER_MISS} turns`, "AFTER_MISS"],
      ["Interleave", `1 / ${LEARN_EVERY} cards`, "LEARN_EVERY"],
    ],
  },
  {
    title: "Queue",
    params: [
      ["Cycle", CYCLE.join(" · "), "CYCLE"],
      ["New sentences", `⌈due ÷ ${DUE_PER_NEW}⌉`, "DUE_PER_NEW"],
      ["Word order", "Retrievability ↑", "LEAST_LIKELY_FIRST"],
      ["Read / Recall", "take turns", "takeTurns"],
      ["Never answered", `≤ 1 / ${UNANSWERED_EVERY} word cards`, "UNANSWERED_EVERY"],
      ["First-time a day", "no limit", "dailyMax"],
      ["Last misses", `≤ 1 / ${MISS_EVERY} word cards`, "MISS_EVERY"],
      ["Sentence order", "Due ↑", "nextCards()"],
      ["Burying", "1 card / word / day", "nextCards()"],
    ],
  },
  {
    title: "Sentences",
    params: [
      ["Retire", `${CLEAN_READS_TO_RETIRE} clean reads, distinct days`, "CLEAN_READS_TO_RETIRE"],
      ["Revive on word Again", "Shown + 1", "submitReview()"],
      ["Revived clean reads", String(REVIVED_CLEAN_READS), "REVIVED_CLEAN_READS"],
    ],
  },
  {
    title: "Revive",
    params: [
      ["Needs reviving", "Latest result wrong", "stuckWords()"],
      ["Counts as wrong", "Again · tapped lapse", "stuckWords()"],
      ["Mixed up", `${REVIVE.mixedMisses} of last 6 wrong + a partner`, "REVIVE.mixedMisses"],
      ["Can't produce", `Recall ${REVIVE.produceMisses} of last 3 wrong, Read fine`, "REVIVE.produceMisses"],
      ["Breaks in context", `${REVIVE.trips}+ trips in ${REVIVE.tripDays} d, Read fine`, "REVIVE.trips · tripDays"],
      ["Slipping", `${REVIVE.slipMisses} of last 3 wrong after ${REVIVE.strongRun} right or ${REVIVE.strongDays} d`, "REVIVE.strongRun · strongDays"],
      ["Won't stick", `${REVIVE.streak} wrong in a row`, "REVIVE.streak"],
      ["Leech", `${REVIVE.leechMisses}+ wrong in all`, "REVIVE.leechMisses"],
      ["Hook shown until", `${RESCUE_CLEAR} Good in a row`, "RESCUE_CLEAR"],
      ["Schedule effect", "None", "rescue.ts"],
    ],
  },
];

export function Algorithm() {
  const [live, setLive] = useState<QueueNow | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    get<QueueNow>("algorithm", { ...today() })
      .then(setLive)
      .catch((e) => setError(message(e)));
  }, []);

  return (
    <div className="cf-alg">
      <h1>Algorithm</h1>
      {GROUPS.map((g) => (
        <section key={g.title}>
          <h2 className="cf-alg-h">{g.title}</h2>
          <dl className="cf-alg-params">
            {g.params.map(([name, value, code, more]) => (
              <div key={name}>
                <dt>
                  {name}
                  <code>{code}</code>
                </dt>
                <dd>{value}</dd>
                {more}
              </div>
            ))}
          </dl>
        </section>
      ))}

      <section>
        <h2 className="cf-alg-h">Queue now</h2>
        {error && <p className="cf-error">{error}</p>}
        {!live && !error && <Loading label="Asking the queue…" />}
        {live && (
          <>
            <OddsBars odds={live.odds} />
            <p className="cf-alg-note">Buried till tomorrow: {fmt(live.heldBack)}</p>
            {live.next.length ? <NextUp cards={live.next} /> : <p className="cf-muted">Nothing due.</p>}
          </>
        )}
      </section>
    </div>
  );
}
