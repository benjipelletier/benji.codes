"use client";

// Everything there is a card for, or could be: the words, and the sentences.

import { useState } from "react";
import { SentencesPanel } from "./SentencesPanel";
import { WordsPanel } from "./WordsPanel";
import { fmt, type Shell } from "./shared";

type Side = "words" | "sentences";

export function CardsPanel({ shell }: { shell: Shell }) {
  const [side, setSide] = useState<Side>("words");
  // A word to find among the sentences, when a word's sheet asks for them.
  const [find, setFind] = useState<{ word: string; at: number } | null>(null);
  const s = shell.summary;
  const sides: Array<{ key: Side; label: string; n: number | null }> = [
    { key: "words", label: "Words", n: s?.words ?? null },
    { key: "sentences", label: "Sentences", n: s?.sentences ?? null },
  ];
  return (
    <div className="cf-panel">
      <div className="cf-sides" role="tablist">
        {sides.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={side === t.key}
            className={`cf-side${side === t.key ? " is-on" : ""}`}
            onClick={() => setSide(t.key)}
          >
            {t.label}
            {t.n !== null && <small>{fmt(t.n)}</small>}
          </button>
        ))}
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
      ) : (
        <SentencesPanel shell={shell} find={find} />
      )}
    </div>
  );
}
