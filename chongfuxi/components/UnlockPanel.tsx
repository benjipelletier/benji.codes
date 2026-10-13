"use client";

// What to learn next, and what else stands between you and more sentences.
//
// Both lists come from the same place: texts blocked by exactly one word. A
// word from your own Pleco lists is something to learn (add it in Pleco and
// re-import); anything else is usually a name or a rarity, to mark rather than
// study. The count beside each is how many texts it alone is blocking; opening
// a row works out the exact effect, which can be larger, since knowing a word
// also completes compounds built from it.

import { useMemo, useState } from "react";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import { suggestions, type Suggestion } from "@chongfuxi/lib/machine";
import { WordActions, type AppApi } from "./shared";

const PAGE = 25;

function SuggestionList({ api, items, empty }: { api: AppApi; items: Suggestion[]; empty: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  if (!items.length) return <p className="cf-muted cf-pad">{empty}</p>;
  return (
    <>
      <ul className="cf-list">
        {items.slice(0, shown).map((s) => (
          <li key={s.word} className={`cf-row${open === s.word ? " cf-row-open" : ""}`}>
            <button className="cf-row-head" onClick={() => setOpen(open === s.word ? null : s.word)}>
              <span className="cf-word">{s.word}</span>
              {s.pron && <span className="cf-pinyin">{displayPinyin(s.pron)}</span>}
              <span className="cf-count" title="Texts this word alone is blocking">
                +{s.unlocks}
              </span>
            </button>
            {open === s.word && <WordActions api={api} word={s.word} />}
          </li>
        ))}
      </ul>
      {shown < items.length && (
        <button className="cf-more" onClick={() => setShown(shown + PAGE)}>
          Show more ({items.length - shown} left)
        </button>
      )}
    </>
  );
}

export function UnlockPanel({ api }: { api: AppApi }) {
  const { learnNext, blockers } = useMemo(() => suggestions(api.state), [api.state]);
  const marked = [...api.state.marks.entries()];
  const [openMark, setOpenMark] = useState<string | null>(null);

  return (
    <div className="cf-panel">
      <section className="cf-section">
        <h2 className="cf-h2">Learn next</h2>
        <p className="cf-lede">
          Words from your Pleco lists, by how many sentences each would make readable on its own. Add one in Pleco
          and re-import, or mark it if you already know it.
        </p>
        <SuggestionList api={api} items={learnNext} empty="Nothing in your lists is blocking a sentence on its own." />
      </section>

      <section className="cf-section">
        <h2 className="cf-h2">Also blocking</h2>
        <p className="cf-lede">
          Words outside your lists that are the last thing between you and a sentence — mostly names and rare words.
        </p>
        <SuggestionList api={api} items={blockers} empty="Nothing else is blocking a sentence on its own." />
      </section>

      {marked.length > 0 && (
        <section className="cf-section">
          <h2 className="cf-h2">Marked here</h2>
          <p className="cf-lede">Words you marked in this app. Unmarking shows what it would undo first.</p>
          <ul className="cf-list">
            {marked.map(([word, why]) => (
              <li key={word} className={`cf-row${openMark === word ? " cf-row-open" : ""}`}>
                <button className="cf-row-head" onClick={() => setOpenMark(openMark === word ? null : word)}>
                  <span className="cf-word">{word}</span>
                  <span className="cf-tag">{why === "name" ? "name" : "known"}</span>
                </button>
                {openMark === word && <WordActions api={api} word={word} />}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
