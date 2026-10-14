"use client";

// Every sentence, by how close it is to readable, shortest first. Readable
// ones say where their card stands; the rest show the words still in the way.
// The last choice turns it round: the words that would unlock the most.
// Typing a word finds every sentence with it in, whatever the tab. A source
// (a deck, a book's lessons) narrows all of it; tapping a sentence's source
// tag picks that source.

import { useEffect, useState } from "react";
import type { SentenceRow, SourceCounts } from "@chongfuxi/lib/api";
import { get } from "@chongfuxi/lib/client";
import { UnlockPanel } from "./UnlockPanel";
import { Highlighted, fmt, message, type Shell } from "./shared";

type Show = "readable" | "one" | "locked" | "unlock";
const PAGE = 40;

const CARD_LABEL = {
  new: "not yet introduced",
  reading: "in rotation",
  retired: "retired",
} as const;

export function SentencesPanel({ shell, find }: { shell: Shell; find?: { word: string; at: number } | null }) {
  const [show, setShow] = useState<Show>("readable");
  const [rows, setRows] = useState<SentenceRow[]>([]);
  const [more, setMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A word to find, as typed; and the one being shown, once typing pauses.
  const [typed, setTyped] = useState(find?.word ?? "");
  const [word, setWord] = useState(find?.word ?? "");

  // Sent here from a word's sheet: search for that word.
  useEffect(() => {
    if (!find) return;
    setTyped(find.word);
    setWord(find.word);
  }, [find]);
  const [within, setWithin] = useState(false);
  // Every source, with its counts; and the one picked, if any.
  const [sources, setSources] = useState<SourceCounts[] | null>(null);
  const [source, setSource] = useState("");
  useEffect(() => {
    get<{ sources: SourceCounts[] }>("sources")
      .then((r) => setSources(r.sources))
      .catch(() => setSources([]));
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setWord(typed.trim()), 300);
    return () => window.clearTimeout(t);
  }, [typed]);

  const load = (which: Show, offset: number) => {
    if (which === "unlock" && !word) return;
    setLoading(true);
    get<{ sentences: SentenceRow[] }>("sentences", {
      show: which === "unlock" ? undefined : which,
      word: word || undefined,
      within: word && within ? 1 : undefined,
      source: source || undefined,
      offset,
      limit: PAGE,
    })
      .then((r) => {
        setRows((prev) => (offset ? [...prev, ...r.sentences] : r.sentences));
        setMore(r.sentences.length === PAGE);
        setError(null);
      })
      .catch((e) => setError(message(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => load(show, 0), [show, word, within, source]); // eslint-disable-line react-hooks/exhaustive-deps

  // The counts are the picked source's, or the whole corpus's.
  const picked = sources?.find((x) => x.source === source) ?? null;
  const s = picked ?? shell.summary;
  const tabs: Array<{ key: Show; label: string; n: number | null }> = [
    { key: "readable", label: "Readable", n: s?.readable ?? null },
    { key: "one", label: "One away", n: s?.oneAway ?? null },
    { key: "locked", label: "Locked", n: s?.locked ?? null },
    { key: "unlock", label: "Unlock next", n: null },
  ];

  const finding = word.length > 0;

  return (
    <>
      <div className="cf-find">
        <input
          className="cf-input"
          type="search"
          enterKeyHint="search"
          placeholder="Find sentences with a word: 人, 剩…"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          aria-label="Find sentences with a word"
        />
        {finding && (
          <label className="cf-find-within">
            <input type="checkbox" checked={within} onChange={(e) => setWithin(e.target.checked)} />
            Inside longer words too
          </label>
        )}
      </div>

      {sources && sources.length > 1 && (
        <label className="cf-source-pick">
          <span>From</span>
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">every source</option>
            {sources.map((x) => (
              <option key={x.source} value={x.source}>
                {x.source} ({fmt(x.readable + x.oneAway + x.locked)})
              </option>
            ))}
          </select>
        </label>
      )}

      {!finding && (
        <div className="cf-filters">
          <div className="cf-seg" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={show === t.key}
                className={`cf-seg-btn${show === t.key ? " is-on" : ""}`}
                onClick={() => setShow(t.key)}
              >
                {t.label} {t.n !== null && <span className="cf-seg-n">{fmt(t.n)}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {!finding && show === "unlock" && <UnlockPanel shell={shell} />}
      {(finding || show !== "unlock") && (
        <>
          {error && <p className="cf-error">{error}</p>}
          {!loading && rows.length === 0 && (
            <p className="cf-muted cf-pad">
              {finding
                ? within
                  ? `No sentence has ${word} in it.`
                  : `No sentence has ${word} as a word of its own. Try inside longer words.`
                : "No sentences here."}
            </p>
          )}
          <ul className="cf-list">
            {rows.map((r) => (
              <li key={r.id} className="cf-sentence">
                <div className="cf-zh">{finding ? <Highlighted text={r.zh} word={word} /> : r.zh}</div>
                {r.en && <div className="cf-en">{r.en}</div>}
                <div className="cf-sentence-meta">
                  {r.blockers.map((w) => (
                    <span key={w} className="cf-blocker">
                      {w}
                    </span>
                  ))}
                  {r.card && <span className="cf-tag">{CARD_LABEL[r.card]}</span>}
                  {r.sources.map((src) => (
                    <button
                      key={src}
                      className={`cf-tag cf-tag-btn-src${src === source ? " is-on" : ""}`}
                      title={src === source ? "Showing only this source" : `Only sentences from ${src}`}
                      onClick={() => setSource(src === source ? "" : src)}
                    >
                      {src}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          {loading && <p className="cf-muted cf-pad">Loading…</p>}
          {!loading && more && rows.length > 0 && (
            <button className="cf-more" onClick={() => load(show, rows.length)}>
              Show more
            </button>
          )}
        </>
      )}
    </>
  );
}
