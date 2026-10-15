"use client";

// Look up (查): "what do I say here", answered from the owner's own sentences
// (app/api/chongfuxi/lookup.ts), laid out as a dictionary entry (layout A of
// the owner's pick). Nothing says what the answer is: for a gap, the phrase
// shows the best word in it and every candidate under it (fitting ones with
// their tag, near misses struck through), so it reads at a glance. Then each word that fits as a
// numbered sense (what it's for, the word and its pinyin, its dictionary
// meaning, why, how often the owner's sentences have it, an example), with
// the evidence behind "Why, and more examples"; the near misses struck
// through with a wrong and a right sentence. Every word says where it stands
// in the deck, with + Add (and Undo) for one that isn't.
//
// A proof of concept. Each answer asks for a verdict (Right / Wrong, and
// what was wrong): those lookups are the test set that decides what to build.

import { useEffect, useState } from "react";
import type { LookupAnswer, LookupListed, LookupSource } from "@chongfuxi/lib/api";
import { get, send } from "@chongfuxi/lib/client";
import { message, type Shell } from "./shared";

const KIND = {
  pairing: "Which word goes with it",
  meaning: "Which meaning",
  synonyms: "Near-synonyms",
  tone: "Tone",
  pattern: "A sentence pattern",
  expression: "A whole expression",
  reading: "What it means here",
} as const;

const SOURCE: Record<LookupSource, string> = {
  corpus: "your sentences",
  dictionary: "dictionary",
  deck: "your deck",
  model: "model",
};

/** The phrase with the gap filled by the word picked: green when it fits, struck through red when it doesn't. */
function Frame({ frame, zh, fits }: { frame: string; zh: string | null; fits: boolean }) {
  const at = frame.indexOf("___");
  if (at < 0) return <p className="cf-lk-frame">{frame}</p>;
  return (
    <p className="cf-lk-frame" lang="zh">
      {frame.slice(0, at)}
      {zh ? (
        <span className={`cf-lk-gap ${fits ? "is-fit" : "is-miss"}`}>{zh}</span>
      ) : (
        <span className="cf-lk-gap" aria-label="the gap" />
      )}
      {frame.slice(at + 3)}
    </p>
  );
}

type Option = LookupAnswer["options"][number];

const STAGE = { new: "new", young: "young", mature: "mature", strong: "strong" } as const;

/**
 * Where a word stands in the deck, at a glance, and a way to put it there:
 * "In deck · strong", or + Add (one addition, undone here or like any other).
 */
function DeckMark({ o, query, shell }: { o: Option; query: string; shell: Shell }) {
  const [added, setAdded] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inDeck = o.deck?.status === "deck";

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await send<{ id: number | null; added: string[] }>("lookup", { q: query, add: o.zh });
      if (r.id !== null) setAdded(r.id);
      shell.refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const undo = async () => {
    if (added === null) return;
    setBusy(true);
    setError(null);
    try {
      await send(`additions/${added}`, { action: "undo" });
      setAdded(null);
      shell.refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  if (added !== null) {
    return (
      <span className="cf-lk-deck is-in">
        ✓ Added
        <button className="cf-lk-undo" disabled={busy} onClick={() => void undo()}>
          Undo
        </button>
      </span>
    );
  }
  if (inDeck) {
    const stage = o.deck?.stage;
    return <span className="cf-lk-deck is-in">✓ In deck{stage ? ` · ${STAGE[stage]}` : ""}</span>;
  }
  if (o.deck?.status === "name" || !o.inDictionary || !o.pinyin) return null;
  return (
    <>
      <button className="cf-lk-add" disabled={busy} onClick={() => void add()} title={o.deck?.status === "listed" ? "On one of your Pleco lists" : undefined}>
        {busy ? "Adding…" : "+ Add"}
      </button>
      {error && <span className="cf-error cf-lk-adderr">{error}</span>}
    </>
  );
}

/** How often the owner's sentences show it, from the points the check let stand. */
const yours = (o: Option) => o.points.find((p) => p.source === "corpus" && p.checked && p.count !== null)?.count ?? null;

/** One word that fits, as a dictionary sense: what it's for, the word, its meaning, why, an example; the evidence behind More. */
function Sense({ o, n, on, onPick, query, shell }: { o: Option; n: number; on: boolean; onPick: () => void; query: string; shell: Shell }) {
  const [more, setMore] = useState(false);
  const count = yours(o);
  const [first, ...rest] = o.examples;
  return (
    <li className={`cf-lk-sense${on ? " is-on" : ""}`}>
      <span className="cf-lk-n">{n}</span>
      <div className="cf-lk-body">
        {o.label && <p className="cf-lk-lab">{o.label}</p>}
        <div className="cf-lk-wordline">
          <button className="cf-lk-word" onClick={onPick} aria-pressed={on}>
            {o.zh}
          </button>
          {o.pinyin && <span className="cf-lk-py">{o.pinyin}</span>}
          <DeckMark o={o} query={query} shell={shell} />
        </div>
        {o.gloss && <p className="cf-lk-gloss">{o.gloss}</p>}
        <p className="cf-lk-why">{o.verdict}</p>
        {count !== null && <p className="cf-lk-count">In {count} of your sentences</p>}
        {first && (
          <p className="cf-lk-ex">
            <span className="cf-zh">{first.zh}</span>
            {first.en && <span>{first.en}</span>}
          </p>
        )}
        {(o.points.length > 0 || rest.length > 0) && (
          <button className="cf-lk-more" aria-expanded={more} onClick={() => setMore(!more)}>
            {more ? "Less" : "Why, and more examples"}
          </button>
        )}
        {more && (
          <div className="cf-lk-detail">
            {o.points.length > 0 && (
              <ul className="cf-lk-points">
                {o.points.map((p, i) => (
                  <li key={i}>
                    <span className="cf-lk-point">{p.point}</span>
                    <span>{p.says}</span>
                    <span className={`cf-lk-src is-${p.source}`}>
                      {SOURCE[p.source]}
                      {p.count !== null ? ` · ${p.count}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {rest.map((s) => (
              <p key={s.id} className="cf-lk-ex">
                <span className="cf-zh">{s.zh}</span>
                {s.en && <span>{s.en}</span>}
              </p>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

function Answer({ a, onAgain, shell }: { a: LookupAnswer; onAgain: () => void; shell: Shell }) {
  const fits = a.options.filter((o) => o.fits);
  const misses = a.options.filter((o) => !o.fits);
  const [picked, setPicked] = useState<string | null>(fits[0]?.zh ?? null);
  const [verdict, setVerdict] = useState<"right" | "wrong" | null>(null);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const judge = async (v: "right" | "wrong" | null, n = "") => {
    setError(null);
    try {
      await send("lookup", { q: a.query, verdict: v, note: n || undefined });
      setVerdict(v);
      setSaved(v !== "wrong" || Boolean(n));
    } catch (e) {
      setError(message(e));
    }
  };

  // Words named in a sense map but given no entry of their own.
  const named = new Set(a.options.map((o) => o.zh));
  const senses = a.senses.filter((s) => s.words.some((w) => !named.has(w)));

  const shown = a.options.find((o) => o.zh === picked) ?? null;

  return (
    <article className="cf-lk-answer">
      {/* No sentence saying what the answer is: the phrase and the words under it show it. */}
      {a.frame && (
        <div className="cf-lk-head">
          <Frame frame={a.frame} zh={picked} fits={shown?.fits ?? true} />
          <div className="cf-lk-tries" role="group" aria-label="Words for the gap">
            {a.options.map((o) => (
              <button
                key={o.zh}
                className={`cf-lk-try ${o.fits ? "is-fit" : "is-miss"}${picked === o.zh ? " is-on" : ""}`}
                aria-pressed={picked === o.zh}
                aria-label={`${o.zh}${o.fits ? (o.label ? `, ${o.label}` : "") : ", doesn't fit"}`}
                onClick={() => setPicked(o.zh)}
              >
                <b>{o.zh}</b>
                {o.fits && o.label && <small>{o.label}</small>}
              </button>
            ))}
          </div>
          {/* Under the words, so tapping one never moves them. */}
          {shown && !shown.fits && <p className="cf-lk-miss-why">{shown.verdict}</p>}
        </div>
      )}

      {fits.length > 0 && (
        <ol className="cf-lk-entry">
          {fits.map((o, i) => (
            <Sense key={o.zh} o={o} n={i + 1} on={Boolean(a.frame) && picked === o.zh} onPick={() => setPicked(o.zh)} query={a.query} shell={shell} />
          ))}
        </ol>
      )}

      {senses.length > 0 && (
        <ul className="cf-lk-senses">
          {senses.map((s) => (
            <li key={s.label}>
              <span>{s.label}</span>
              <b className="cf-zh">{s.words.join("  ")}</b>
            </li>
          ))}
        </ul>
      )}

      {misses.length > 0 && (
        <ul className="cf-lk-nots" aria-label="Close, but no">
          {misses.map((o) => (
            <li key={o.zh} className="cf-lk-not">
              <span className="cf-lk-x" aria-hidden="true">
                ✗
              </span>
              <div className="cf-lk-body">
                <div className="cf-lk-wordline">
                  <s className="cf-zh">{o.zh}</s>
                  {o.pinyin && <span className="cf-lk-py">{o.pinyin}</span>}
                  <DeckMark o={o} query={a.query} shell={shell} />
                </div>
                <p className="cf-lk-why">{o.verdict}</p>
                {(o.wrong || o.right) && (
                  <p className="cf-lk-pair">
                    {o.wrong && <s className="cf-zh">{o.wrong}</s>}
                    {o.right && <span className="cf-zh">{o.right}</span>}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {a.written.length > 0 && (
        <section className="cf-lk-written">
          <p className="cf-lk-label">Written by the model</p>
          {a.written.map((s) => (
            <p key={s.zh} className="cf-lk-ex is-written">
              <span className="cf-zh">{s.zh}</span>
              <span>{s.en}</span>
            </p>
          ))}
        </section>
      )}

      <section className="cf-lk-verdict">
        <span>Right?</span>
        <button
          className={`cf-lk-v${verdict === "right" ? " is-on" : ""}`}
          aria-pressed={verdict === "right"}
          aria-label="Right"
          onClick={() => void judge(verdict === "right" ? null : "right")}
        >
          ✓
        </button>
        <button
          className={`cf-lk-v${verdict === "wrong" ? " is-on" : ""}`}
          aria-pressed={verdict === "wrong"}
          aria-label="Wrong"
          onClick={() => void judge(verdict === "wrong" ? null : "wrong")}
        >
          ✗
        </button>
        {saved && <span className="cf-muted">Kept for the test set.</span>}
      </section>
      {verdict === "wrong" && !saved && (
        <form
          className="cf-lk-note"
          onSubmit={(e) => {
            e.preventDefault();
            void judge("wrong", note);
          }}
        >
          <textarea
            className="cf-input"
            rows={2}
            placeholder="What was wrong, or what you used in the end"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button className="cf-btn" disabled={!note.trim()}>
            Save
          </button>
        </form>
      )}
      {error && <p className="cf-error">{error}</p>}

      <details className="cf-lk-checks">
        <summary>How it was read, and what the check changed</summary>
        {a.summary && <p>{a.summary}</p>}
        <p className="cf-lk-parts">
          {a.reading.parts.map((p, i) => (
            <span key={i} className={`cf-lk-part${p.asked ? " is-asked" : ""}`} title={p.asked ? "The question" : "Known"}>
              {p.text}
            </span>
          ))}
        </p>
        {a.reading.note && <p>{a.reading.note}</p>}
        <ul>
          {a.checks.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
        <p>
          {a.model} ·{" "}
          <button className="cf-link" onClick={onAgain}>
            Ask again
          </button>
        </p>
      </details>
    </article>
  );
}

export function LookupPanel({ shell }: { shell: Shell }) {
  const [typed, setTyped] = useState("");
  const [answer, setAnswer] = useState<LookupAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [past, setPast] = useState<LookupListed[] | null>(null);

  useEffect(() => {
    if (!shell.canWrite || answer) return;
    get<{ lookups: LookupListed[] }>("lookup")
      .then((r) => setPast(r.lookups))
      .catch(() => setPast([]));
  }, [shell.canWrite, answer]);

  const ask = async (q: string, fresh = false) => {
    if (!q.trim() || busy) return;
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      setAnswer(await send<LookupAnswer>("lookup", { q, fresh: fresh || undefined }));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  if (!shell.canWrite) {
    return <p className="cf-muted cf-pad">Look up is Benji&apos;s own: each lookup asks a model, which costs money.</p>;
  }

  return (
    <div className="cf-panel cf-lk">
      {/* One field, with a small round arrow inside it to ask. */}
      <form
        className="cf-lk-ask"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(typed);
        }}
      >
        <input
          type="search"
          enterKeyHint="go"
          placeholder="What do you want to say?"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          aria-label="What do you want to say?"
        />
        <button className={`cf-lk-go${busy ? " is-busy" : ""}`} disabled={busy || !typed.trim()} aria-label={busy ? "Looking it up" : "Look up"}>
          {busy ? (
            <i className="cf-lk-spin" aria-hidden="true" />
          ) : (
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <path d="M4 10h11M11 5.5 15.5 10 11 14.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </form>
      {!answer && !busy && (
        <p className="cf-muted cf-lk-hint">English, Chinese or both: develop depression · 得了 depression · the more… the more</p>
      )}

      {busy && <p className="cf-muted cf-pad">Looking through your sentences and the dictionary… this can take a minute.</p>}
      {error && <p className="cf-error">{error}</p>}
      {answer && <Answer key={answer.query + answer.at} a={answer} shell={shell} onAgain={() => void ask(answer.query, true)} />}

      {!answer && !busy && past && past.length > 0 && (
        <section className="cf-lk-sec">
          <h3 className="cf-h3">Asked before</h3>
          <ul className="cf-slist">
            {past.map((l) => (
              <li key={l.query}>
                <button
                  className="cf-wrow"
                  onClick={() => {
                    setTyped(l.query);
                    void ask(l.query);
                  }}
                >
                  <b className="cf-lk-past">{l.query}</b>
                  <span className="cf-wrow-gloss">{l.kind ? KIND[l.kind] : ""}</span>
                  <em className={`cf-lk-mark is-${l.verdict ?? "none"}`}>{l.verdict === "right" ? "✓" : l.verdict === "wrong" ? "✗" : ""}</em>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
