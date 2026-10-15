"use client";

// Everything there is a card for, or could be: the words, the sentences, and
// the Pleco word lists more words come from.

import { useCallback, useState } from "react";
import { Learn } from "./Learn";
import { ListsPanel } from "./ListsPanel";
import { Session, type ListReview } from "./ReviewPanel";
import { SentencesPanel } from "./SentencesPanel";
import { WordsPanel } from "./WordsPanel";
import { fmt, useBackLayer, type Shell } from "./shared";

type Side = "words" | "sentences" | "lists";

export function CardsPanel({ shell }: { shell: Shell }) {
  const [side, setSide] = useState<Side>("words");
  // A word to find among the sentences, when a word's sheet asks for them.
  const [find, setFind] = useState<{ word: string; at: number } | null>(null);
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
