"use client";

// What stands between the owner and more sentences.
//
// Every word here is the only thing blocking some number of sentences. One
// that is in a Pleco list is something to learn: add it to your words in Pleco
// and import again. The rest are mostly names and rarities; marking one as a
// name stops it blocking, without it ever becoming a card.
//
// The first few lead One away on Cards › Sentences; all of them are on the
// Unlock next page it opens. A word opens a sheet with the sentences it holds back.

import { useEffect, useState } from "react";
import type { Blocker, SentenceRow } from "@chongfuxi/lib/api";
import { get, send } from "@chongfuxi/lib/client";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import { Highlighted, Sheet, fmt, message, plecoHref, type Shell } from "./shared";

const PAGE = 25;

export interface Blockers {
  learnNext: Blocker[];
  others: Blocker[];
  names: string[];
}

/** One blocking word: the sentences it alone holds back, Pleco, and "It's a name". */
export function BlockerSheet({
  blocker: b,
  shell,
  onClose,
  onChanged,
}: {
  blocker: Blocker;
  shell: Shell;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [examples, setExamples] = useState<SentenceRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    get<{ sentences: SentenceRow[] }>("sentences", { show: "one", blocker: b.word, limit: 5 })
      .then((r) => setExamples(r.sentences))
      .catch((e) => setError(message(e)));
  }, [b.word]);

  const name = async () => {
    setBusy(true);
    try {
      await send("names", { word: b.word });
      onChanged();
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };

  return (
    <Sheet label={b.word} onClose={onClose}>
      <header className="cf-sheet-head">
        <h2>{b.word}</h2>
        {b.pinyin && <p className="cf-sheet-py">{displayPinyin(b.pinyin)}</p>}
      </header>
      <p className="cf-bsheet-gloss">{b.gloss ?? (b.listed ? "" : "Not in the dictionary: most likely a name.")}</p>
      <p className="cf-muted">
        The last word keeping <b className="cf-bsheet-n">{fmt(b.unlocks)}</b> {b.unlocks === 1 ? "sentence" : "sentences"} locked.
      </p>
      {error && <p className="cf-error">{error}</p>}
      {examples === null && !error && <p className="cf-muted">Finding them…</p>}
      {examples && examples.length > 0 && (
        <ul className="cf-slist cf-bsheet-list">
          {examples.map((s) => (
            <li key={s.id} className="cf-srow is-static">
              <span className="cf-srow-zh">
                <Highlighted text={s.zh} word={b.word} />
              </span>
              {s.en && <span className="cf-srow-en">{s.en}</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="cf-buttons">
        {shell.canWrite && !b.listed && (
          <button className="cf-btn cf-btn-ghost" disabled={busy} onClick={name}>
            {busy ? "Working…" : "It's a name"}
          </button>
        )}
        <a className="cf-btn" href={plecoHref(b.word)}>
          {shell.canWrite ? "Add in Pleco" : "Open in Pleco"}
        </a>
      </div>
    </Sheet>
  );
}

function Rows({ items, empty, onOpen }: { items: Blocker[]; empty: string; onOpen: (b: Blocker) => void }) {
  const [shown, setShown] = useState(PAGE);
  if (!items.length) return <p className="cf-muted cf-pad">{empty}</p>;
  return (
    <>
      <ul className="cf-slist">
        {items.slice(0, shown).map((b) => (
          <li key={b.word}>
            <button className="cf-wrow" onClick={() => onOpen(b)}>
              <b className="cf-zh">{b.word}</b>
              <span className="cf-wrow-gloss">
                {b.pinyin && <i>{displayPinyin(b.pinyin)}</i>}
                {b.gloss ?? ""}
              </span>
              <em title="Sentences this word alone is blocking">+{fmt(b.unlocks)}</em>
            </button>
          </li>
        ))}
      </ul>
      {shown < items.length && (
        <button className="cf-more" onClick={() => setShown(shown + PAGE)}>
          Show more ({fmt(items.length - shown)} left)
        </button>
      )}
    </>
  );
}

/** Every word standing alone in the way, and the names, on a page of its own with "‹ Sentences" above. */
export function UnlockPage({
  shell,
  data,
  onBack,
  onOpen,
  onChanged,
}: {
  shell: Shell;
  data: Blockers | null;
  onBack: () => void;
  onOpen: (b: Blocker) => void;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const unname = async (word: string) => {
    try {
      await send("names", { word, on: false });
      onChanged();
    } catch (e) {
      setError(message(e));
    }
  };

  return (
    <div className="cf-subpage">
      <nav className="cf-crumbs" aria-label="Sentences">
        <button onClick={onBack}>‹ Sentences</button>
      </nav>
      <h2 className="cf-subpage-title">Unlock next</h2>
      <p className="cf-lede">
        Each word is the only thing keeping these sentences locked.
        {shell.canWrite ? " Add one to your words in Pleco, or mark a name." : ""}
      </p>
      {error && <p className="cf-error">{error}</p>}
      {!data && <p className="cf-muted cf-pad">Working out what to learn next…</p>}
      {data && (
        <>
          <h3 className="cf-h3">From {shell.canWrite ? "your" : "Benji's"} Pleco lists</h3>
          <Rows items={data.learnNext} onOpen={onOpen} empty="No listed word is blocking a sentence on its own." />
          <h3 className="cf-h3">Also blocking · mostly names</h3>
          <Rows items={data.others} onOpen={onOpen} empty="Nothing else is blocking a sentence on its own." />
          {data.names.length > 0 && (
            <>
              <h3 className="cf-h3">Marked as names</h3>
              <ul className="cf-slist">
                {data.names.map((word) => (
                  <li key={word} className="cf-wrow is-static">
                    <b className="cf-zh">{word}</b>
                    <span className="cf-wrow-gloss">Never blocks, never reviewed</span>
                    {shell.canWrite && (
                      <button className="cf-link" onClick={() => void unname(word)}>
                        Not a name
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
