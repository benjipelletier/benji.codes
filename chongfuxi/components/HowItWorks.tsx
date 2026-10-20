"use client";

// Settings › How cards are chosen: the whole algorithm in one page, for the
// owner, who asked to see "how the cookie is made". Two halves: what the
// queue is doing right now (route `how`: the cards a session would deal first
// and why, what waits, what Learn takes next), then every rule in the order a
// card meets them, each with where it lives in the code. The numbers in the
// rules are the code's own constants, imported, so the page can't drift from
// what runs.

import { useEffect, useState } from "react";
import type { HowItWorksLive, LearnStep, QueueWhy, SessionCard } from "@chongfuxi/lib/api";
import { get, today } from "@chongfuxi/lib/client";
import { AFTER_MISS, GAP, IN_PLAY, LADDER, LEARN_EVERY } from "@chongfuxi/lib/learn";
import { CLEAN_READS_TO_RETIRE, CYCLE, DUE_PER_NEW, REVIVED_CLEAN_READS } from "@chongfuxi/lib/review";
import { MAX_INTERVAL_DAYS, RETENTION, SEED_CAP_DAYS } from "@chongfuxi/lib/schedule";
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
                <span className="cf-how-why">A step for a new word on the Learn ladder (see below).</span>
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

/** One rule: what it does, then where it is in the code. */
function Rule({ n, title, code, children }: { n: number; title: string; code: string; children: React.ReactNode }) {
  return (
    <section className="cf-how-rule">
      <h3>
        <span className="cf-how-rn">{n}</span>
        {title}
      </h3>
      {children}
      <p className="cf-how-code">
        In the code: <code>{code}</code>
      </p>
    </section>
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
  const cycle = CYCLE.map((c) => LINE[c]);

  return (
    <div className="cf-how">
      <header className="cf-how-head">
        <h1>How cards are chosen</h1>
        <p className="cf-muted">
          Every rule that decides what you see and when, in the order a card meets them. The numbers are the code&apos;s own, and the
          first part is today, live.
        </p>
      </header>

      <section className="cf-section">
        <h2 className="cf-h2">Right now</h2>
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

      <section className="cf-section">
        <h2 className="cf-h2">The rules</h2>

        <Rule n={1} title="Where cards come from" code="app/api/chongfuxi/additions.ts · lib/schedule.ts (seedSchedule)">
          <p>
            A word joins the deck from a Pleco backup, an AnkiDroid sync, a list&apos;s Add, Look up, its word page, the text analyser or
            龙库. Each deck word gets one <b>Read</b> card: see the word, know what it means.
          </p>
          <p>
            A word Pleco had tested starts from Pleco&apos;s score: its interval becomes the card&apos;s strength, capped at{" "}
            {SEED_CAP_DAYS} days, and it is due at once so you see everything here once. A word Pleco never tested starts new.
          </p>
        </Rule>

        <Rule n={2} title="New words go through Learn first" code="lib/learn.ts · app/api/chongfuxi/learn.ts · components/Learn.tsx">
          <p>
            A new Read card stays out of review until Learn has taught it. The ladder: {LADDER.map((l) => STEP[l]).join(", then ")}.{" "}
            {IN_PLAY} words are in play at once and take turns, coming back after{" "}
            {LADDER.filter((l) => GAP[l] > 0)
              .map((l) => `${GAP[l]} turns for ${STEP[l]}`)
              .join(", ")}
            . A miss sends a word back a step and brings it back after {AFTER_MISS} turns.
          </p>
          <p>
            In a session, a Learn step comes every {LEARN_EVERY}th card. Words part way up go first, then the newest added. Finishing the
            ladder makes the card due the next study day, still new. Learn never changes a schedule.
          </p>
        </Rule>

        <Rule n={3} title="When a card is due" code="lib/schedule.ts (FSRS, through ts-fsrs) · lib/day.ts">
          <p>
            Every card has a memory model (FSRS): a <b>strength</b>, roughly how many days until you&apos;d likely forget, and a{" "}
            <b>difficulty</b>. A card comes due when the odds you&apos;d remember it fall to {pct(RETENTION)}. Got it is FSRS&apos;s Good,
            Forgot its Again.
          </p>
          <p>
            Nothing comes back the same day: every answer sends a card at least a day away. Intervals are nudged a little at random so
            cards don&apos;t bunch up, and never go past {fmt(Math.round(MAX_INTERVAL_DAYS / 365))} years. The day turns over at 4am, so
            a late session counts for the day it started in.
          </p>
          <p>
            Your first Got it on a Read card opens its <b>Recall</b> card (from the meaning, give the word). It starts from Pleco&apos;s
            score at half strength if Pleco tested the word, and new otherwise.
          </p>
        </Rule>

        <Rule n={4} title="Which sentences you can see" code="lib/unlock.ts · app/api/chongfuxi/corpus.ts (recomputeUnlocks)">
          <p>
            A sentence is <b>readable</b> when you know every word in it: a deck word that isn&apos;t suspended, or a marked name. A word
            also counts if it splits entirely into words you know (这个 from 这 and 个, 孩子们 from 孩子 and 们).
          </p>
          <p>
            That split is also how a word like 式样 slips through when you know 式 and 样: the rule can&apos;t tell a word that means its
            parts from one that doesn&apos;t. If you tap it after Forgot, its parts are what lapse.
          </p>
          <p>
            A sentence that becomes readable gets a sentence card; one that stops being readable has its card set aside. This is worked
            out again whenever the words you know change. Locked sentences wait, counted as one word away or further.
          </p>
        </Rule>

        <Rule n={5} title="The queue: three lines" code="app/api/chongfuxi/review.ts (nextCards)">
          <p>A session draws from three lines, each in its own order:</p>
          <ul>
            <li>
              <b>Word cards</b> (Read and Recall together) due before the day ends: the lowest odds of remembering first, so the ones
              you&apos;re likeliest to have lost come first. Never-answered ones lead. Read and Recall aren&apos;t weighed against each
              other.
            </li>
            <li>
              <b>Due sentences</b>: oldest due date first.
            </li>
            <li>
              <b>New sentences</b> from every readable one not yet seen: those a word just unlocked first, newest first. Then one for each
              word before any word gets a second, each going by the word in it that needs it most (due today or just forgotten, then the
              weakest, then one still waiting for Learn). Then sentences with a word you&apos;ve never read in one, then a shuffle fixed
              for the day.
            </li>
          </ul>
        </Rule>

        <Rule n={6} title="The mix" code="lib/review.ts (interleave, CYCLE) · components/ReviewPanel.tsx">
          <p>
            Cards are dealt in a repeating cycle: {cycle.join(" → ")}. A line with nothing left gives its turn to the next. The cycle
            carries on across the batches a session loads.
          </p>
          <p>
            While cards are due, new sentences come one for every {DUE_PER_NEW} due, so they thin out as you near the end. With nothing
            due there are none, until you choose to keep going, and then it is new sentences only. A Learn step comes every{" "}
            {LEARN_EVERY}th card while words wait for it.
          </p>
        </Rule>

        <Rule n={7} title="One word, once a day" code="app/api/chongfuxi/review.ts (nextCards)">
          <p>
            Once you&apos;ve answered a word today, its other cards wait until tomorrow. When Read and Recall are both due, the weaker one
            shows and the other moves a day. This applies between word cards only: a sentence can still have a word you just saw.
          </p>
        </Rule>

        <Rule n={8} title="What an answer does" code="app/api/chongfuxi/review.ts (submitReview) · lib/review.ts">
          <ul>
            <li>
              <b>Word card</b>: Got it or Forgot moves its schedule. Forgot also brings back the retired sentence it was shown in, and one
              other retired sentence with the word.
            </li>
            <li>
              <b>Sentence card</b>: it retires after {CLEAN_READS_TO_RETIRE} clean reads on different days (two in one day count once).
              Forgot starts the count again; the words you tap lapse their Read cards as if forgotten, and a tapped word not in your deck
              passes that to the deck words it&apos;s made of. Each lapsed word brings back a retired sentence that has it.
            </li>
            <li>
              A sentence brought back is due tomorrow with {REVIVED_CLEAN_READS} clean read already, so one more retires it again.
            </li>
            <li>Reading a sentence counts as seeing each of its words, except the ones you tapped.</li>
          </ul>
        </Rule>

        <Rule n={9} title="Other ways in" code="app/api/chongfuxi/review.ts (fastCards) · components/ListsPanel.tsx">
          <ul>
            <li>
              <b>Fast review</b>: every Read card due today, the word alone, best known first, to sweep through quickly.
            </li>
            <li>
              <b>A list&apos;s Review</b>: its word cards only, no sentences.
            </li>
            <li>
              <b>Suspend</b> a word and its cards stop coming, history kept, and its sentences lock until you bring it back.
            </li>
          </ul>
        </Rule>
      </section>
    </div>
  );
}
