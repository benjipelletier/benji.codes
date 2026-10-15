"use client";

// Look up (查): "what do I say here", answered from the owner's own sentences
// (app/api/chongfuxi/lookup.ts). Type what you want to say; the answer shows
// how it was read (which part is the question), the phrase with the gap
// filled by whichever option is tapped, what fits and why, the near misses
// with a wrong and a right sentence, and the owner's sentences that show
// them. Everything is labelled with where it came from: your sentences, the
// dictionary, your deck, or the model's own knowledge.
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

/** The phrase with the gap filled by the option picked: struck through when that option doesn't fit. */
function Frame({ frame, zh, fits }: { frame: string; zh: string | null; fits: boolean }) {
  const at = frame.indexOf("___");
  if (at < 0) return <p className="cf-lk-frame">{frame}</p>;
  return (
    <p className="cf-lk-frame" lang="zh">
      {frame.slice(0, at)}
      <span className={`cf-lk-gap${zh ? (fits ? " is-fit" : " is-miss") : ""}`}>{zh ?? "＿＿"}</span>
      {frame.slice(at + 3)}
    </p>
  );
}

function Answer({ a, onAgain }: { a: LookupAnswer; onAgain: () => void }) {
  const fits = a.options.filter((o) => o.fits);
  const misses = a.options.filter((o) => !o.fits);
  const [picked, setPicked] = useState<string | null>(fits[0]?.zh ?? null);
  const shown = a.options.find((o) => o.zh === picked) ?? null;
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

  return (
    <div className="cf-lk-answer">
      <section className="cf-lk-reading" aria-label="Reading it as">
        <p className="cf-lk-label">{KIND[a.reading.kind]}</p>
        <p className="cf-lk-parts">
          {a.reading.parts.map((p, i) => (
            <span key={i} className={`cf-lk-part${p.asked ? " is-asked" : ""}`} title={p.asked ? "The question" : "Known"}>
              {p.text}
            </span>
          ))}
        </p>
        {a.reading.note && <p className="cf-muted">{a.reading.note}</p>}
      </section>

      {a.frame && <Frame frame={a.frame} zh={shown?.zh ?? null} fits={shown?.fits ?? true} />}
      {shown && a.frame && <p className={`cf-lk-why${shown.fits ? "" : " is-miss"}`}>{shown.verdict}</p>}
      {a.frame && (
        <div className="cf-lk-tries" role="group" aria-label="Try a word in the gap">
          {a.options.map((o) => (
            <button
              key={o.zh}
              className={`cf-lk-try${o.fits ? "" : " is-miss"}${picked === o.zh ? " is-on" : ""}`}
              aria-pressed={picked === o.zh}
              onClick={() => setPicked(o.zh)}
            >
              {o.zh}
            </button>
          ))}
        </div>
      )}

      {a.summary && <p className="cf-lk-summary">{a.summary}</p>}

      {a.senses.length > 0 && (
        <section className="cf-lk-sec">
          <h3 className="cf-h3">Meanings</h3>
          <ul className="cf-lk-senses">
            {a.senses.map((s) => (
              <li key={s.label}>
                <span>{s.label}</span>
                <b className="cf-zh">{s.words.join("  ")}</b>
              </li>
            ))}
          </ul>
        </section>
      )}

      {fits.length > 0 && (
        <section className="cf-lk-sec">
          <h3 className="cf-h3">Fits</h3>
          <ul className="cf-slist">
            {fits.map((o) => (
              <li key={o.zh} className="cf-lk-opt">
                <p className="cf-lk-opt-head">
                  <b className="cf-zh">{o.zh}</b>
                  {o.pinyin && <span className="cf-lk-py">{o.pinyin}</span>}
                  {!o.inDictionary && <span className="cf-tag">not in the dictionary</span>}
                </p>
                <p>{o.verdict}</p>
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
                {o.examples.length > 0 && (
                  <ul className="cf-lk-examples">
                    {o.examples.map((s) => (
                      <li key={s.id}>
                        <span className="cf-zh">{s.zh}</span>
                        {s.en && <span className="cf-en">{s.en}</span>}
                        <span className="cf-lk-from">{s.readable ? "your sentence · readable" : "your sentence · locked"}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {misses.length > 0 && (
        <section className="cf-lk-sec">
          <h3 className="cf-h3">Close, but no</h3>
          <ul className="cf-slist">
            {misses.map((o) => (
              <li key={o.zh} className="cf-lk-opt">
                <p className="cf-lk-opt-head">
                  <b className="cf-zh">{o.zh}</b>
                  {o.pinyin && <span className="cf-lk-py">{o.pinyin}</span>}
                </p>
                <p>{o.verdict}</p>
                {(o.wrong || o.right) && (
                  <p className="cf-lk-pair">
                    {o.wrong && <s className="cf-zh">{o.wrong}</s>}
                    {o.right && <span className="cf-zh">{o.right}</span>}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {a.written.length > 0 && (
        <section className="cf-lk-sec">
          <h3 className="cf-h3">Written by the model</h3>
          <ul className="cf-lk-examples is-written">
            {a.written.map((s) => (
              <li key={s.zh}>
                <span className="cf-zh">{s.zh}</span>
                <span className="cf-en">{s.en}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="cf-lk-verdict">
        <p>Was this right?</p>
        <div className="cf-buttons">
          <button className={`cf-btn${verdict === "right" ? "" : " cf-btn-ghost"}`} onClick={() => void judge(verdict === "right" ? null : "right")}>
            Right
          </button>
          <button className={`cf-btn${verdict === "wrong" ? "" : " cf-btn-ghost"}`} onClick={() => void judge(verdict === "wrong" ? null : "wrong")}>
            Wrong
          </button>
        </div>
        {verdict === "wrong" && (
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
        {saved && <p className="cf-muted">Kept for the test set.</p>}
        {error && <p className="cf-error">{error}</p>}
      </section>

      <details className="cf-lk-checks">
        <summary>
          What the check changed ({a.checks.length}) · {a.model}
        </summary>
        <ul>
          {a.checks.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
        <button className="cf-link" onClick={onAgain}>
          Ask again
        </button>
      </details>
    </div>
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
      <p className="cf-muted cf-lk-hint">English, Chinese or both: develop depression · 得了 depression · the more… the more</p>

      {busy && <p className="cf-muted cf-pad">Looking through your sentences and the dictionary… this can take a minute.</p>}
      {error && <p className="cf-error">{error}</p>}
      {answer && <Answer key={answer.query + answer.at} a={answer} onAgain={() => void ask(answer.query, true)} />}

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
