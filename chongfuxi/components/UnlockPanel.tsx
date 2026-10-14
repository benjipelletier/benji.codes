"use client";

// What stands between the owner and more sentences.
//
// Every word here is the only thing blocking some number of sentences. One
// that is in a Pleco list is something to learn: add it to your words in Pleco
// and import again. The rest are mostly names and rarities; marking one as a
// name stops it blocking, without it ever becoming a card.

import { useCallback, useEffect, useState } from "react";
import type { Blocker, SentenceRow } from "@chongfuxi/lib/api";
import { get, send } from "@chongfuxi/lib/client";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import { Highlighted, message, plecoHref, type Shell } from "./shared";

const PAGE = 25;

interface Blockers {
  learnNext: Blocker[];
  others: Blocker[];
  names: string[];
}

function Row({ b, shell, onChanged }: { b: Blocker; shell: Shell; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [examples, setExamples] = useState<SentenceRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || examples) return;
    get<{ sentences: SentenceRow[] }>("sentences", { show: "one", blocker: b.word, limit: 3 })
      .then((r) => setExamples(r.sentences))
      .catch((e) => setError(message(e)));
  }, [open, examples, b.word]);

  const name = async () => {
    setBusy(true);
    try {
      await send("names", { word: b.word });
      shell.refresh();
      onChanged();
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };

  return (
    <li className={`cf-row${open ? " cf-row-open" : ""}`}>
      <button className="cf-row-head" onClick={() => setOpen(!open)}>
        <span className="cf-word">{b.word}</span>
        <span className="cf-pinyin">
          {b.pinyin ? displayPinyin(b.pinyin) : ""}
          {b.gloss ? ` · ${b.gloss}` : ""}
        </span>
        <span className="cf-count" title="Sentences this word alone is blocking">
          +{b.unlocks}
        </span>
      </button>
      {open && (
        <div className="cf-actions">
          {error && <p className="cf-error">{error}</p>}
          {examples === null ? (
            <p className="cf-muted">Finding what it would unlock…</p>
          ) : (
            <ul className="cf-examples">
              {examples.map((s) => (
                <li key={s.id}>
                  <span className="cf-zh">
                    <Highlighted text={s.zh} word={b.word} />
                  </span>
                  {s.en && <span className="cf-en">{s.en}</span>}
                </li>
              ))}
            </ul>
          )}
          <div className="cf-buttons">
            <a className="cf-btn cf-btn-ghost" href={plecoHref(b.word)}>
              Open in Pleco
            </a>
            {shell.canWrite && !b.listed && (
              <button className="cf-btn" disabled={busy} onClick={name}>
                {busy ? "Working…" : "It's a name"}
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function List({ items, shell, empty, onChanged }: { items: Blocker[]; shell: Shell; empty: string; onChanged: () => void }) {
  const [shown, setShown] = useState(PAGE);
  if (!items.length) return <p className="cf-muted cf-pad">{empty}</p>;
  return (
    <>
      <ul className="cf-list">
        {items.slice(0, shown).map((b) => (
          <Row key={b.word} b={b} shell={shell} onChanged={onChanged} />
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

export function UnlockPanel({ shell }: { shell: Shell }) {
  const [data, setData] = useState<Blockers | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    get<Blockers>("blockers")
      .then(setData)
      .catch((e) => setError(message(e)));
  }, []);
  useEffect(load, [load]);

  const unname = async (word: string) => {
    try {
      await send("names", { word, on: false });
      shell.refresh();
      load();
    } catch (e) {
      setError(message(e));
    }
  };

  if (error) return <p className="cf-error">{error}</p>;
  if (!data) return <p className="cf-muted cf-pad">Working out what to learn next…</p>;

  return (
    <>
      <section className="cf-section">
        <h2 className="cf-h2">Learn next</h2>
        <p className="cf-lede">
          Words from {shell.canWrite ? "your" : "Benji's"} Pleco lists, by how many sentences each would make readable
          on its own.{shell.canWrite && " Add one to your words in Pleco, then import again."}
        </p>
        <List items={data.learnNext} shell={shell} onChanged={load} empty="No listed word is blocking a sentence on its own." />
      </section>

      <section className="cf-section">
        <h2 className="cf-h2">Also blocking</h2>
        <p className="cf-lede">
          Words outside the lists that are the last thing between {shell.canWrite ? "you" : "Benji"} and a sentence —
          mostly names and rare words.
        </p>
        <List items={data.others} shell={shell} onChanged={load} empty="Nothing else is blocking a sentence on its own." />
      </section>

      {data.names.length > 0 && (
        <section className="cf-section">
          <h2 className="cf-h2">Names</h2>
          <p className="cf-lede">Marked as names: they don&apos;t block sentences and are never reviewed.</p>
          <ul className="cf-list">
            {data.names.map((word) => (
              <li key={word} className="cf-row">
                <div className="cf-row-head">
                  <span className="cf-word">{word}</span>
                  <span className="cf-pinyin" />
                  {shell.canWrite && (
                    <button className="cf-link" onClick={() => unname(word)}>
                      not a name
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
