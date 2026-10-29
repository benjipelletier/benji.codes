"use client";

// Muse's cards (shapes checked by app/api/chongfuxi/drill.ts): flip, cloze,
// choice, order, produce, listen, each answered in its own way, then shown
// with what to take from it, then Got it / Missed. Drawn by the cards blocks
// on Muse's page (MusePage.tsx); Today's review, which they came from, was
// folded into the page. Touches no schedule.

import { useEffect, useMemo, useState } from "react";
import type { DrillCard } from "@chongfuxi/lib/api";
import * as wordpage from "@chongfuxi/lib/wordpage";

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

/** One card: answered in its own way, then shown with what to take from it, then Got it / Missed (filled in when the card can tell). */
export function DrillCardView({ card, onGrade }: { card: DrillCard; onGrade: (got: boolean, given: string | null) => void }) {
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
      return <Produce card={card} shown={shown} />;
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

/** Said, not typed (the owner's call: a typed sentence has too many right versions to match), then graded by the owner. */
function Produce({ card, shown }: { card: Extract<DrillCard, { type: "produce" }>; shown: boolean }) {
  const [hint, setHint] = useState(false);
  return (
    <>
      <p className="cf-drill-front">{card.en}</p>
      {!shown && card.hint && (hint ? <p className="cf-muted">{card.hint}</p> : <button className="cf-link" onClick={() => setHint(true)}>Hint</button>)}
      {!shown && <p className="cf-muted">Say it out loud, then show.</p>}
      {shown && (
        <>
          <p className="cf-muted cf-drill-way">One way to say it</p>
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
