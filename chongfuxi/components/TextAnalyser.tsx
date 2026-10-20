"use client";

// Analyse a text against the corpus (Import page): pasted, a web page by its
// link, or a YouTube video's Chinese captions. Shows how much of it can be read (word by word and sentence by
// sentence), the text with each word marked, and the words that would open up
// the most of it, to tick and add to the deck. Its sentences can be added to
// the corpus too. The owner's texts are kept and re-scored when reopened, so
// a text gets easier as words are learnt (app/api/chongfuxi/analyse.ts).

import { useCallback, useEffect, useState } from "react";
import type { Addition, TextAnalysis, TextListed, TextToken } from "@chongfuxi/lib/api";
import { get, send } from "@chongfuxi/lib/client";
import * as wordpage from "@chongfuxi/lib/wordpage";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import { Added } from "./ListsPanel";
import { AiPill, PlecoTile, fmt, message, useBackLayer, type Shell } from "./shared";

/** Paragraphs shown before "Show the whole text". */
const PARAGRAPHS_SHOWN = 12;
/** Words to learn shown before "Show more". */
const UNKNOWN_SHOWN = 30;

const pct = (n: number, of: number) => (of ? Math.round((100 * n) / of) : 0);

export function TextAnalyser({ shell }: { shell: Shell }) {
  const { canWrite } = shell;
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [texts, setTexts] = useState<TextListed[] | null>(null);
  const [open, setOpen] = useState<TextAnalysis | null>(null);

  const loadList = useCallback(() => {
    get<{ texts: TextListed[] }>("analyse")
      .then((r) => setTexts(r.texts))
      .catch(() => setTexts([]));
  }, []);
  useEffect(loadList, [loadList]);

  const analyse = async () => {
    setBusy(true);
    setError(null);
    try {
      const a = await send<TextAnalysis>("analyse", url.trim() ? { url: url.trim() } : { text });
      setOpen(a);
      setText("");
      setUrl("");
      loadList();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const reopen = async (id: number) => {
    setError(null);
    try {
      setOpen(await get<TextAnalysis>("analyse", { id }));
    } catch (e) {
      setError(message(e));
    }
  };

  const remove = async (id: number) => {
    try {
      await send(`analyse/${id}`, { action: "delete" });
      loadList();
    } catch (e) {
      setError(message(e));
    }
  };

  return (
    <section className="cf-section cf-an">
      <h2 className="cf-h2">Analyse a text</h2>
      <p className="cf-muted">How much of it you can read, and which words would open up the most of it.</p>
      <textarea
        className="cf-input cf-an-text"
        rows={4}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value) setUrl("");
        }}
        placeholder="Paste Chinese text"
      />
      {canWrite && (
        <input
          className="cf-input cf-an-url"
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (e.target.value) setText("");
          }}
          placeholder="…or a link to a page or a YouTube video"
        />
      )}
      {error && <p className="cf-error">{error}</p>}
      <button className="cf-btn cf-an-go" disabled={busy || (!text.trim() && !url.trim())} onClick={() => void analyse()}>
        {busy ? (url.trim() ? (/youtu\.?be/.test(url) ? "Reading the captions…" : "Reading the page…") : "Analysing…") : "Analyse"}
      </button>

      {texts && texts.length > 0 && (
        <ul className="cf-an-history">
          {texts.map((t) => (
            <li key={t.id}>
              <button className="cf-an-past" onClick={() => void reopen(t.id)}>
                <span className="cf-zh">{t.title || "Untitled"}</span>
                <small>
                  {t.kind === "web" ? "Page" : t.kind === "youtube" ? "Video" : "Pasted"} ·{" "}
                  {new Date(t.at).toLocaleDateString(undefined, { day: "numeric", month: "short" })} · {fmt(t.chars)} characters
                  {t.savedAs ? " · sentences added" : ""}
                </small>
              </button>
              {canWrite && (
                <button className="cf-an-drop" onClick={() => void remove(t.id)} aria-label={`Remove ${t.title ?? "this text"}`}>
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <Analysis
          a={open}
          shell={shell}
          onClose={() => setOpen(null)}
          onChanged={() => {
            loadList();
            if (open.id) void reopen(open.id);
          }}
        />
      )}
    </section>
  );
}

function Analysis({ a, shell, onClose, onChanged }: { a: TextAnalysis; shell: Shell; onClose: () => void; onChanged: () => void }) {
  const { canWrite, refresh } = shell;
  useBackLayer(true, onClose);
  const [picked, setPicked] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [allText, setAllText] = useState(false);
  const [allWords, setAllWords] = useState(false);
  const [busy, setBusy] = useState<"add" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Addition | null>(null);
  const [source, setSource] = useState(a.savedAs ?? a.title ?? "");
  const [saved, setSaved] = useState<string | null>(a.savedAs ? `Its sentences are in your corpus as “${a.savedAs}”.` : null);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const unknownByWord = new Map(a.unknown.map((u) => [u.word, u]));
  const tick = (w: string) =>
    setTicked((s) => {
      const next = new Set(s);
      if (next.has(w)) next.delete(w);
      else next.add(w);
      return next;
    });

  const addWords = async () => {
    if (!a.id || !ticked.size) return;
    setBusy("add");
    setError(null);
    try {
      const r = await send<{ id: number | null }>(`analyse/${a.id}`, { action: "add", words: [...ticked] });
      if (r.id !== null) {
        const { additions } = await get<{ additions: Addition[] }>("additions", { id: r.id });
        setAdded(additions[0] ?? null);
      }
      setTicked(new Set());
      refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };

  const saveSentences = async () => {
    if (!a.id || !source.trim()) return;
    setBusy("save");
    setError(null);
    try {
      const r = await send<{ added: number; readable: number; already: number; savedAs: string }>(`analyse/${a.id}`, {
        action: "save",
        source: source.trim(),
      });
      setSaved(
        `${fmt(r.added)} sentences added as “${r.savedAs}”, ${fmt(r.readable)} of them readable now` +
          (r.already ? `; ${fmt(r.already)} were in your corpus already.` : "."),
      );
      refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };

  const look = picked ? a.looks[picked] : null;
  const pickedUnknown = picked ? unknownByWord.get(picked) : undefined;
  const paragraphs = allText ? a.paragraphs : a.paragraphs.slice(0, PARAGRAPHS_SHOWN);
  const words = allWords ? a.unknown : a.unknown.slice(0, UNKNOWN_SHOWN);

  return (
    <div className="cf-sheet-back" onClick={onClose}>
      <div className="cf-sheet cf-an-sheet" role="dialog" aria-modal="true" aria-label={a.title ?? "Text"} onClick={(e) => e.stopPropagation()}>
        <button className="cf-close cf-sheet-close" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>

        <header className="cf-an-head">
          <h2 className="cf-zh">{a.title || "Untitled"}</h2>
          <p className="cf-muted">
            {a.url ? (
              <a className="cf-link" href={a.url} target="_blank" rel="noreferrer">
                {a.kind === "youtube" ? "YouTube, its captions" : new URL(a.url).hostname}
              </a>
            ) : (
              "Pasted"
            )}
          </p>
        </header>

        {/* How readable: the words, by occurrence; then distinct words and sentences. */}
        <div className="cf-an-score">
          <p className="cf-an-pct">
            <b>{pct(a.words.known, a.words.total)}%</b>
            <span>of its words you know</span>
          </p>
          <ul className="cf-an-facts">
            <li>
              <b>{fmt(a.words.uniqueKnown)}</b> of {fmt(a.words.unique)} distinct words
              {a.words.learning > 0 && <>, {fmt(a.words.learning)} still being learnt</>}
            </li>
            <li>
              <b>{fmt(a.sentences.readable)}</b> of {fmt(a.sentences.total)} sentences readable, <b>{fmt(a.sentences.oneAway)}</b> one word away
            </li>
          </ul>
        </div>

        {a.hsk.length > 0 && (
          <div className="cf-an-hsk" aria-label="Its words by HSK 3.0 level">
            {a.hsk.map((h) => (
              <div key={h.level} className="cf-an-level">
                <span className={`cf-an-level-name${h.level === "none" ? " is-none" : ` cf-level is-l${h.level.split("-")[0]}`}`}>
                  {h.level === "none" ? "Not HSK" : `HSK ${h.level.replace("-", "–")}`}
                </span>
                <span className="cf-an-level-bar" role="img" aria-label={`${h.known} of ${h.words} known`}>
                  <i style={{ width: `${pct(h.known, h.words)}%` }} />
                </span>
                <span className="cf-an-level-n">
                  {fmt(h.known)}/{fmt(h.words)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* The text, each word marked by how it stands. Tap one for its reading. */}
        <h3 className="cf-an-sub">The text</h3>
        <p className="cf-an-key">
          <span className="cf-an-w is-unknown">not known</span> <span className="cf-an-w is-learning">still learning</span> known
        </p>
        <div className="cf-an-body">
          {paragraphs.map((p, i) => (
            <p key={i} className="cf-zh">
              {p.flat().map((t: TextToken, j) =>
                t.k ? (
                  <button
                    key={j}
                    className={`cf-an-w is-${t.k}${picked === t.t ? " is-picked" : ""}${ticked.has(t.t) ? " is-ticked" : ""}`}
                    onClick={() => setPicked(picked === t.t ? null : t.t)}
                  >
                    {t.t}
                  </button>
                ) : (
                  <span key={j}>{t.t}</span>
                ),
              )}
            </p>
          ))}
          {!allText && a.paragraphs.length > PARAGRAPHS_SHOWN && (
            <button className="cf-more" onClick={() => setAllText(true)}>
              Show the whole text ({fmt(a.paragraphs.length - PARAGRAPHS_SHOWN)} more paragraphs)
            </button>
          )}
        </div>

        {picked && (
          <div className="cf-an-picked">
            <p>
              <span className="cf-zh">{picked}</span> {look?.p && <b>{displayPinyin(look.p)}</b>}
            </p>
            {look?.gloss && (
              <p className="cf-muted">
                {look.gloss} <AiPill word={picked} />
              </p>
            )}
            <div className="cf-an-picked-foot">
              {pickedUnknown?.addable && canWrite && a.id !== null && (
                <button className="cf-link" onClick={() => tick(picked)}>
                  {ticked.has(picked) ? "Don't add" : "Add to the deck"}
                </button>
              )}
              <button className="cf-link" onClick={() => wordpage.openWordPage(picked)}>
                Word page ›
              </button>
              <PlecoTile word={picked} inline />
            </div>
          </div>
        )}

        {a.unknown.length > 0 && (
          <>
            <h3 className="cf-an-sub">Words to learn</h3>
            <p className="cf-muted">The ones that stand in the way most often, and that alone hold sentences back, first.</p>
            <ul className="cf-kinds cf-an-words">
              {words.map((u) => (
                <li key={u.word}>
                  <label className={`cf-kind is-new${ticked.has(u.word) ? "" : " is-off"}`}>
                    {canWrite && a.id !== null && u.addable && (
                      <input type="checkbox" checked={ticked.has(u.word)} onChange={() => tick(u.word)} />
                    )}
                    {canWrite && a.id !== null && u.addable && <i className="cf-tick" />}
                    <span className="cf-list-word">
                      <span className="cf-zh">{u.word}</span>
                      <small>
                        {u.pinyin ? displayPinyin(u.pinyin) : ""}
                        {u.gloss ? `${u.pinyin ? " · " : ""}${u.gloss}` : ""}
                        {u.gloss && (
                          <>
                            {" "}
                            <AiPill word={u.word} still />
                          </>
                        )}
                      </small>
                    </span>
                    <b className="cf-an-count">
                      ×{fmt(u.count)}
                      {u.unlocks > 0 && <small>opens {fmt(u.unlocks)}</small>}
                    </b>
                  </label>
                </li>
              ))}
            </ul>
            {!allWords && a.unknown.length > UNKNOWN_SHOWN && (
              <button className="cf-more" onClick={() => setAllWords(true)}>
                Show more ({fmt(a.unknown.length - UNKNOWN_SHOWN)})
              </button>
            )}
          </>
        )}

        {error && <p className="cf-error">{error}</p>}

        {canWrite && a.id !== null && (
          <div className="cf-an-actions">
            {a.unknown.length > 0 && (
              <button className="cf-btn" disabled={busy !== null || ticked.size === 0} onClick={() => void addWords()}>
                {busy === "add"
                  ? "Adding…"
                  : ticked.size
                    ? `Add ${fmt(ticked.size)} ${ticked.size === 1 ? "word" : "words"} to the deck`
                    : "Tick words to add them"}
              </button>
            )}
            <h3 className="cf-an-sub">Its sentences</h3>
            {saved ? (
              <p className="cf-muted">{saved}</p>
            ) : (
              <>
                <p className="cf-muted">Add them to your corpus, to come up in review once their words are known.</p>
                <div className="cf-an-save">
                  <input className="cf-input" value={source} onChange={(e) => setSource(e.target.value)} placeholder="Name shown on their cards" maxLength={80} />
                  <button className="cf-btn cf-btn-ghost" disabled={busy !== null || !source.trim()} onClick={() => void saveSentences()}>
                    {busy === "save" ? "Adding…" : "Add sentences"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        {!canWrite && <p className="cf-muted cf-sheet-aside">Read-only: only Benji can add words or keep texts.</p>}

        {added && (
          <Added
            addition={added}
            list={a.title ?? "this text"}
            onDone={() => {
              setAdded(null);
              onChanged();
            }}
            onUndone={() => {
              setAdded(null);
              onChanged();
              refresh();
            }}
          />
        )}
      </div>
    </div>
  );
}
