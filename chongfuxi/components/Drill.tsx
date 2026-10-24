"use client";

// Muse's review (app/api/chongfuxi/drill.ts): cards the owner's agent wrote
// from their problem areas, in whatever shapes it judged most useful (the
// owner gave it free rein): flip, cloze, choice, order, produce, listen. One
// card at a time, full screen, from the first not yet answered; each card
// says what it aims at, and after the answer what to take from it. Got it /
// Missed is kept per card and goes back to Muse for the next review. Touches
// no schedule.

import { useEffect, useMemo, useState } from "react";
import type { Drill, DrillCard } from "@chongfuxi/lib/api";
import { get, send } from "@chongfuxi/lib/client";
import * as wordpage from "@chongfuxi/lib/wordpage";
import { Loading, fmt, message } from "./shared";

/** The phone's zh-CN voice, if it has one; silent otherwise. */
export function say(text: string) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith("zh"));
    if (voice) u.voice = voice;
    u.rate = 0.9;
    synth.speak(u);
  } catch {
    // No voice: it goes on silently.
  }
}

const SHAPE: Record<DrillCard["type"], string> = {
  flip: "Card",
  cloze: "Fill the gap",
  choice: "Pick one",
  order: "Put in order",
  produce: "Say it in Chinese",
  listen: "Listen",
};

/** Typed Chinese compared as written: spaces and punctuation don't count. */
const bare = (s: string) => s.replace(/[\s\p{P}]/gu, "");

/** Whether the latest review has cards still to answer: for the button on Today and the list. */
export function useDrill(): Drill | null | undefined {
  const [drill, setDrill] = useState<Drill | null | undefined>(undefined);
  useEffect(() => {
    get<{ drill: Drill | null }>("drill")
      .then((r) => setDrill(r.drill))
      .catch(() => setDrill(null));
  }, []);
  return drill;
}

export const drillLeft = (d: Drill | null | undefined) => (d ? d.cards.filter((_, i) => !d.results[i]).length : 0);

export function DrillView({ canWrite, onEnd }: { canWrite: boolean; onEnd: () => void }) {
  const [drill, setDrill] = useState<Drill | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  // The cards to go through, by index: the unanswered first time in, the missed on a second pass.
  const [queue, setQueue] = useState<number[]>([]);
  const [at, setAt] = useState(0);
  const [results, setResults] = useState<Drill["results"]>({});
  useEffect(() => {
    get<{ drill: Drill | null }>("drill")
      .then((r) => {
        setDrill(r.drill);
        if (!r.drill) return;
        setResults(r.drill.results);
        const left = r.drill.cards.map((_, i) => i).filter((i) => !r.drill!.results[i]);
        setQueue(left.length ? left : r.drill.cards.map((_, i) => i));
      })
      .catch((e) => setError(message(e)));
  }, []);

  const grade = (idx: number, got: boolean, given: string | null) => {
    if (!drill) return;
    setResults((r) => ({ ...r, [idx]: { grade: got ? "got" : "missed", given, at: Date.now() } }));
    if (canWrite) send("drill", { day: drill.day, idx, grade: got ? "got" : "missed", given }).catch((e) => setError(message(e)));
    setAt((n) => n + 1);
  };

  const current = queue[at];
  const card = drill && current !== undefined ? drill.cards[current] : null;
  const dated = drill ? new Date(`${drill.day}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) : "";
  return (
    <div className="cf-rescue cf-speed cf-drill">
      <div className="cf-fast-top">
        <button className="cf-close" onClick={onEnd} aria-label="Back to the list">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <p className="cf-rescue-top">
          {drill && !drill.today ? "Latest review" : "Today's review"}{drill && queue.length > 0 && card ? ` · ${fmt(at + 1)} of ${fmt(queue.length)}` : ""}
        </p>
      </div>
      {error && <p className="cf-error cf-rescue-in">{error}</p>}
      {drill === undefined && !error && <Loading label="Opening…" />}
      {drill === null && <p className="cf-muted cf-rescue-in">No review yet. Muse writes one from your problem areas.</p>}
      {drill && card && (
        <div className="cf-speed-stage">
          {at === 0 && (
            <div className="cf-drill-intro">
              {drill.title && <p className="cf-drill-title">{drill.title}</p>}
              {drill.note && <p className="cf-muted">{drill.note}</p>}
              <p className="cf-muted cf-story-by">
                {dated} · by {drill.model}
                {!drill.today && " · today's isn't written yet"}
              </p>
            </div>
          )}
          <DrillCardView key={`${at}-${current}`} card={card} onGrade={(got, given) => grade(current, got, given)} />
        </div>
      )}
      {drill && drill.cards.length > 0 && !card && <DrillEnd drill={drill} results={results} queue={queue} onAgain={(missed) => { setQueue(missed); setAt(0); }} onEnd={onEnd} />}
    </div>
  );
}

function DrillEnd({
  drill,
  results,
  queue,
  onAgain,
  onEnd,
}: {
  drill: Drill;
  results: Drill["results"];
  queue: number[];
  onAgain: (missed: number[]) => void;
  onEnd: () => void;
}) {
  const missed = queue.filter((i) => results[i]?.grade === "missed");
  const got = queue.length - missed.length;
  return (
    <div className="cf-rescue-in cf-speed-end">
      <p className="cf-rescue-score">
        {fmt(got)} of {fmt(queue.length)} got
      </p>
      {missed.length > 0 && (
        <ul className="cf-drill-missed">
          {missed.map((i) => (
            <li key={i}>
              <b>{SHAPE[drill.cards[i].type]}</b> {drill.cards[i].why}
              {drill.cards[i].explain && <p className="cf-muted">{drill.cards[i].explain}</p>}
            </li>
          ))}
        </ul>
      )}
      <p className="cf-muted">Muse sees how each went when it writes the next one.</p>
      <div className="cf-buttons">
        {missed.length > 0 && (
          <button className="cf-btn" onClick={() => onAgain(missed)}>
            Go over the {fmt(missed.length)} missed
          </button>
        )}
        <button className={missed.length ? "cf-link" : "cf-btn"} onClick={onEnd}>
          Back to the list
        </button>
      </div>
    </div>
  );
}

/** One card: answered in its own way, then shown with what to take from it, then Got it / Missed (filled in when the card can tell). */
function DrillCardView({ card, onGrade }: { card: DrillCard; onGrade: (got: boolean, given: string | null) => void }) {
  const [shown, setShown] = useState(false);
  // What the card could tell by itself: right, wrong, or nothing (self-graded).
  const [auto, setAuto] = useState<boolean | null>(null);
  const [given, setGiven] = useState<string | null>(null);
  const reveal = (right: boolean | null, typed: string | null = null) => {
    setAuto(right);
    setGiven(typed);
    setShown(true);
  };

  return (
    <>
      <div className={`cf-speed-card cf-drill-card${shown ? " is-shown" : ""}`}>
        <p className="cf-drill-label">
          {SHAPE[card.type]}
          {card.why && <span> · {card.why}</span>}
        </p>
        <Body card={card} shown={shown} onReveal={reveal} />
        {shown && card.explain && <p className="cf-drill-explain">{card.explain}</p>}
        {shown && card.focus.length > 0 && (
          <div className="cf-recap-chips cf-drill-focus">
            {card.focus.map((w) => (
              <button key={w} className="cf-lk-wchip" onClick={() => wordpage.openWordPage(w)}>
                <span className="cf-zh">{w}</span> ›
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="cf-speed-answers">
        {shown ? (
          <>
            <button className={`cf-answer-btn cf-answer-forgot${auto === false ? " is-suggested" : ""}`} onClick={() => onGrade(false, given)}>
              Missed
            </button>
            <button className={`cf-answer-btn cf-answer-show${auto === true ? " is-suggested" : ""}`} onClick={() => onGrade(true, given)}>
              Got it
            </button>
          </>
        ) : (
          <button className="cf-answer-btn cf-answer-ghost cf-drill-show" onClick={() => reveal(null)}>
            Show answer
          </button>
        )}
      </div>
    </>
  );
}

function Body({ card, shown, onReveal }: { card: DrillCard; shown: boolean; onReveal: (right: boolean | null, typed?: string | null) => void }) {
  switch (card.type) {
    case "flip":
      return <Flip card={card} shown={shown} />;
    case "cloze":
      return <Cloze card={card} shown={shown} onReveal={onReveal} />;
    case "choice":
      return <Choice card={card} shown={shown} onReveal={onReveal} />;
    case "order":
      return <Order card={card} shown={shown} onReveal={onReveal} />;
    case "produce":
      return <Produce card={card} shown={shown} onReveal={onReveal} />;
    case "listen":
      return <Listen card={card} shown={shown} />;
  }
}

function Flip({ card, shown }: { card: Extract<DrillCard, { type: "flip" }>; shown: boolean }) {
  const [hint, setHint] = useState(false);
  return (
    <>
      <p className="cf-drill-front">{card.front}</p>
      {!shown && card.hint && (hint ? <p className="cf-muted">{card.hint}</p> : <button className="cf-link" onClick={() => setHint(true)}>Hint</button>)}
      {shown && <p className="cf-drill-back">{card.back}</p>}
    </>
  );
}

function Cloze({ card, shown, onReveal }: { card: Extract<DrillCard, { type: "cloze" }>; shown: boolean; onReveal: (right: boolean | null) => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [before, after] = card.zh.split("___", 2);
  const options = useMemo(() => [...card.options].sort(() => Math.random() - 0.5), [card.options]);
  return (
    <>
      <p className="cf-drill-zh cf-zh">
        {before}
        <span className={`cf-drill-gap${shown ? " is-filled" : ""}`}>{shown ? card.answer : "＿＿"}</span>
        {after ?? ""}
      </p>
      {card.en && <p className="cf-muted">{card.en}</p>}
      {options.length > 0 && (
        <div className="cf-drill-options">
          {options.map((o) => (
            <button
              key={o}
              className={`cf-drill-option cf-zh${shown && o === card.answer ? " is-right" : ""}${shown && o === picked && o !== card.answer ? " is-wrong" : ""}`}
              disabled={shown}
              onClick={() => {
                setPicked(o);
                onReveal(o === card.answer);
              }}
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function Choice({ card, shown, onReveal }: { card: Extract<DrillCard, { type: "choice" }>; shown: boolean; onReveal: (right: boolean | null) => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  return (
    <>
      <p className="cf-drill-front">{card.prompt}</p>
      <div className="cf-drill-options is-list">
        {card.options.map((o, i) => (
          <button
            key={i}
            className={`cf-drill-option${shown && i === card.answer ? " is-right" : ""}${shown && i === picked && i !== card.answer ? " is-wrong" : ""}`}
            disabled={shown}
            onClick={() => {
              setPicked(i);
              onReveal(i === card.answer);
            }}
          >
            {o}
          </button>
        ))}
      </div>
    </>
  );
}

function Order({ card, shown, onReveal }: { card: Extract<DrillCard, { type: "order" }>; shown: boolean; onReveal: (right: boolean | null, typed?: string | null) => void }) {
  // Pieces by their place in the right order, shuffled so it isn't given away.
  const shuffled = useMemo(() => {
    const idx = card.pieces.map((_, i) => i);
    for (let n = 0; n < 5; n++) {
      idx.sort(() => Math.random() - 0.5);
      if (idx.some((v, i) => v !== i)) break;
    }
    return idx;
  }, [card.pieces]);
  const [line, setLine] = useState<number[]>([]);
  const built = line.map((i) => card.pieces[i]).join("");
  const done = line.length === card.pieces.length;
  return (
    <>
      {card.en && <p className="cf-drill-front">{card.en}</p>}
      <p className={`cf-drill-line cf-zh${shown ? (bare(built) === bare(card.pieces.join("")) ? " is-right" : " is-wrong") : ""}`}>
        {line.length ? (
          line.map((i, k) => (
            <button key={k} className="cf-drill-piece is-placed" disabled={shown} onClick={() => setLine(line.filter((_, j) => j !== k))}>
              {card.pieces[i]}
            </button>
          ))
        ) : (
          <span className="cf-muted">Tap the pieces in order</span>
        )}
      </p>
      {shown && <p className="cf-drill-zh cf-zh">{card.pieces.join("")}</p>}
      {!shown && (
        <div className="cf-drill-options">
          {shuffled.map((i) =>
            line.includes(i) ? null : (
              <button key={i} className="cf-drill-piece cf-zh" onClick={() => setLine([...line, i])}>
                {card.pieces[i]}
              </button>
            ),
          )}
        </div>
      )}
      {!shown && done && (
        <button className="cf-btn" onClick={() => onReveal(bare(built) === bare(card.pieces.join("")), built)}>
          Check
        </button>
      )}
    </>
  );
}

function Produce({ card, shown, onReveal }: { card: Extract<DrillCard, { type: "produce" }>; shown: boolean; onReveal: (right: boolean | null, typed?: string | null) => void }) {
  const [typed, setTyped] = useState("");
  const [hint, setHint] = useState(false);
  const ok = [card.answer, ...card.accept].map(bare);
  return (
    <>
      <p className="cf-drill-front">{card.en}</p>
      {!shown && card.hint && (hint ? <p className="cf-muted">{card.hint}</p> : <button className="cf-link" onClick={() => setHint(true)}>Hint</button>)}
      {!shown && (
        <form
          className="cf-rescue-type"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.trim()) onReveal(ok.includes(bare(typed)), typed.trim());
          }}
        >
          <input lang="zh" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type it, or say it and show" aria-label="Your answer" />
          <button className="cf-btn" type="submit" disabled={!typed.trim()}>
            Check
          </button>
        </form>
      )}
      {shown && typed.trim() && !ok.includes(bare(typed)) && <p className="cf-drill-typed cf-zh">{typed}</p>}
      {shown && (
        <>
          <p className="cf-drill-zh cf-zh">{card.answer}</p>
          {card.accept.length > 0 && <p className="cf-muted cf-zh">Also: {card.accept.join(" · ")}</p>}
        </>
      )}
    </>
  );
}

function Listen({ card, shown }: { card: Extract<DrillCard, { type: "listen" }>; shown: boolean }) {
  useEffect(() => {
    say(card.zh);
  }, [card.zh]);
  return (
    <>
      <button className="cf-link cf-drill-play" onClick={() => say(card.zh)}>
        ▶ Play again
      </button>
      {!shown && <p className="cf-muted">Say what it means, then show it.</p>}
      {shown && (
        <>
          <p className="cf-drill-zh cf-zh">{card.zh}</p>
          {card.en && <p className="cf-muted">{card.en}</p>}
        </>
      )}
    </>
  );
}
