"use client";

// Everything there is a card for, or could be: the words, the sentences, and
// the Pleco word lists more words come from.

import { useCallback, useEffect, useState } from "react";
import { routeChoice, useRouteParam } from "@chongfuxi/lib/route";
import * as wordpage from "@chongfuxi/lib/wordpage";
import { Learn } from "./Learn";
import { ListsPanel } from "./ListsPanel";
import { Session, type ListReview } from "./ReviewPanel";
import { SentencesPanel } from "./SentencesPanel";
import { WordsPanel } from "./WordsPanel";
import { fmt, useBackLayer, type Shell } from "./shared";

const SIDES = ["words", "sentences", "lists"] as const;
type Side = (typeof SIDES)[number];

export function CardsPanel({ shell }: { shell: Shell }) {
  // In the address, so a reload comes back to it (lib/route.ts).
  const [side, setSide] = useState<Side>(() => routeChoice("cards", SIDES) ?? "words");
  useRouteParam("cards", side === "words" ? null : side);
  // A word to find among the sentences, when a word's sheet asks for them.
  const [find, setFind] = useState<{ word: string; at: number } | null>(null);
  // A word page, opened from anywhere, can send its word here to find its sentences.
  useEffect(() => {
    wordpage.setFindSentences((word) => {
      setFind({ word, at: Date.now() });
      setSide("sentences");
      window.scrollTo({ top: 0 });
    });
    return () => wordpage.setFindSentences(null);
  }, []);
  // Back from Sentences or Lists comes to Words.
  useBackLayer(side !== "words", () => setSide("words"));
  // A list's own review or Learn, over the whole screen; Lists stays as it was beneath.
  const [run, setRun] = useState<
    | { kind: "review"; review: ListReview }
    | { kind: "learn"; list: string }
    | null
  >(null);
  const [ran, setRan] = useState(0);
  const { setFocus, refresh } = shell;
  const endRun = useCallback(() => {
    setRun(null);
    setRan((n) => n + 1);
    setFocus(false);
    refresh();
  }, [setFocus, refresh]);
  useBackLayer(run !== null, endRun);
  const start = (r: NonNullable<typeof run>) => {
    setFocus(true);
    setRun(r);
    window.scrollTo({ top: 0 });
  };
  const s = shell.summary;
  const sides: Array<{ key: Side; label: string; n: number | null }> = [
    { key: "words", label: "Words", n: s?.words ?? null },
    { key: "sentences", label: "Sentences", n: s?.sentences ?? null },
    { key: "lists", label: "Lists", n: null },
  ];
  return (
    <>
      {run?.kind === "review" && (
        <Session shell={shell} list={run.review} onEnd={endRun} />
      )}
      {run?.kind === "learn" && (
        <Learn shell={shell} list={run.list} onEnd={endRun} />
      )}
      <div className="cf-panel" hidden={run !== null}>
        {/* One slim switch, held under the header as the page scrolls. */}
        <div className="cf-switch-bar">
          <div className="cf-switch" role="tablist" aria-label="Cards">
            {sides.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={side === t.key}
                title={t.n !== null ? `${fmt(t.n)} ${t.label.toLowerCase()}` : undefined}
                className={`cf-switch-btn${side === t.key ? " is-on" : ""}`}
                onClick={() => {
                  setSide(t.key);
                  window.scrollTo({ top: 0 });
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        {side === "words" ? (
          <WordsPanel
            shell={shell}
            onFindSentences={(word) => {
              setFind({ word, at: Date.now() });
              setSide("sentences");
              window.scrollTo({ top: 0 });
            }}
          />
        ) : side === "sentences" ? (
          <SentencesPanel shell={shell} find={find} />
        ) : (
          <ListsPanel
            shell={shell}
            reviewed={ran}
            onReview={(review) => start({ kind: "review", review })}
            onLearn={(list) => start({ kind: "learn", list })}
          />
        )}
      </div>
    </>
  );
}
