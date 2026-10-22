"use client";

// Words with the same English, and how they differ (app/api/chongfuxi/synonyms.ts).
// Cards › Synonyms lists the groups, those that trip the owner most first,
// found by English or by a word; a group's page, over everything like a word
// page, puts its words side by side (senses with the shared one marked, what
// each character brings, the words around it in the owner's sentences, an
// example, the owner's record), the dictionary's other words on a toggle, and
// the model's comparison (a table, each word's core, pitfalls, a "which one
// fits" quiz on the owner's sentences) when asked. A word's page lists its
// groups (`SameEnglish`). The owner asked for it, to tell 经历 from 经验.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SynonymCompare, SynonymGroup, SynonymGroupRow, SynonymWord } from "@chongfuxi/lib/api";
import { ApiError, get, send } from "@chongfuxi/lib/client";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import { routeParam, useRouteParam } from "@chongfuxi/lib/route";
import * as synpage from "@chongfuxi/lib/synpage";
import * as wordpage from "@chongfuxi/lib/wordpage";
import { HskTags, Loading, fmt, message, useBackLayer, type Shell } from "./shared";

/** Cards › Synonyms: the groups, and a search by English or by a word. */
export function SynonymsPanel() {
  const [q, setQ] = useState("");
  const [groups, setGroups] = useState<{ q: string; rows: SynonymGroupRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const query = q.trim();
    const t = window.setTimeout(() => {
      get<{ groups: SynonymGroupRow[] }>("synonyms", { q: query || undefined })
        .then((r) => setGroups({ q: query, rows: r.groups }))
        .catch((e) => setError(message(e)));
    }, query ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [q]);

  return (
    <div className="cf-syn">
      <p className="cf-muted cf-syn-about">Your words that share an English meaning. Those you mix up or forget most come first.</p>
      <input
        className="cf-syn-search"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="An English word (experience), or a Chinese one"
        aria-label="Find a group"
      />
      {error && <p className="cf-error">{error}</p>}
      {!groups && !error && <Loading label="Gathering the words that share a meaning…" />}
      {groups && !groups.rows.length && <p className="cf-muted">No group {groups.q ? `for “${groups.q}”` : "yet"}.</p>}
      {groups && groups.rows.length > 0 && (
        <ul className="cf-syn-list">
          {groups.rows.map((g) => (
            <li key={g.key}>
              <button onClick={() => synpage.openGroup(g.key)}>
                <span className="cf-syn-key">
                  {g.key}
                  {g.also.length > 0 && <small> · {g.also.join(" · ")}</small>}
                </span>
                <span className="cf-syn-words">
                  {g.words.map((w) => (
                    <span key={w.word} className={`cf-zh${w.inDeck ? "" : " is-listed"}`}>
                      {w.word}
                    </span>
                  ))}
                </span>
                {g.trouble > 0 && (
                  <span className="cf-syn-trouble" title={`${g.confused} sentences forgotten with two of them tapped`}>
                    {g.confused > 0 ? "mixed up" : "trips you"}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** On a word's page: the English it shares with other words of yours, each opening the group. */
export function SameEnglish({ word }: { word: string }) {
  const [keys, setKeys] = useState<Array<{ key: string; words: string[] }> | null>(null);
  useEffect(() => {
    get<{ keys: Array<{ key: string; words: string[] }> }>("synonyms", { w: word })
      .then((r) => setKeys(r.keys))
      .catch(() => setKeys([]));
  }, [word]);
  if (!keys?.length) return null;
  return (
    <section className="cf-wp-section">
      <h3>Same English</h3>
      <ul className="cf-syn-same">
        {keys.map((k) => (
          <li key={k.key}>
            {/* The word page closes first: the group's page lies beneath it. */}
            <button
              onClick={() => {
                wordpage.closeWordPage();
                synpage.openGroup(k.key);
              }}
            >
              <span className="cf-syn-key">{k.key}</span>
              <span className="cf-syn-words">
                {k.words.map((w) => (
                  <span key={w} className="cf-zh">
                    {w}
                  </span>
                ))}
              </span>
              <i aria-hidden="true">›</i>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The group's page, over everything; its key is in the address, so a reload comes back to it. */
export function SynonymPageHost({ shell }: { shell: Shell }) {
  const key = useSyncExternalStore(synpage.subscribe, synpage.openKey, () => null);
  useEffect(() => {
    const k = routeParam("syn");
    if (k) synpage.openGroup(k);
  }, []);
  useRouteParam("syn", key);
  useBackLayer(key !== null, synpage.closeGroup);
  return key ? <SynonymPage key={key} groupKey={key} canWrite={shell.canWrite} /> : null;
}

function SynonymPage({ groupKey, canWrite }: { groupKey: string; canWrite: boolean }) {
  const [dict, setDict] = useState(false);
  const [g, setG] = useState<SynonymGroup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [compare, setCompare] = useState<SynonymCompare | null>(null);
  useEffect(() => {
    get<SynonymGroup>("synonyms", { key: groupKey, dict: dict ? 1 : undefined })
      .then((r) => {
        setG(r);
        // The dictionary toggle loads the group again: a comparison just made stays.
        setCompare((c) => r.compare ?? c);
      })
      .catch((e) => setError(e instanceof ApiError && e.status === 404 ? `None of your words has “${groupKey}” any more.` : message(e)));
  }, [groupKey, dict]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && synpage.closeGroup();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);

  const runCompare = async () => {
    setComparing(true);
    setError(null);
    try {
      setCompare((await send<{ compare: SynonymCompare }>("synonyms", { key: groupKey })).compare);
    } catch (e) {
      setError(message(e));
    } finally {
      setComparing(false);
    }
  };

  const mine = g?.words.filter((w) => w.status !== "dictionary") ?? [];
  const others = g?.words.filter((w) => w.status === "dictionary") ?? [];
  return (
    <div className="cf-wordpage cf-synpage" role="dialog" aria-modal="true" aria-label={`Words for ${groupKey}`}>
      <div className="cf-wordpage-in">
        <button className="cf-close cf-sheet-close" onClick={synpage.closeGroup} aria-label="Close">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <header className="cf-syn-head">
          <p className="cf-muted">Words for</p>
          <h2>“{groupKey}”</h2>
        </header>

        {error && <p className="cf-error">{error}</p>}
        {!g && !error && <Loading label="Laying them side by side…" />}

        {g && (
          <>
            {g.confused.length > 0 && (
              <p className="cf-syn-confused">
                You&apos;ve mixed these up:{" "}
                {g.confused.map((c) => `${c.a} / ${c.b} (${c.n} ${c.n === 1 ? "sentence" : "sentences"})`).join(", ")}
              </p>
            )}

            <div className="cf-syn-cards">
              {mine.map((w) => (
                <SynonymCard key={w.word} w={w} />
              ))}
            </div>

            <section className="cf-wp-section">
              <h3>How they differ</h3>
              {comparing && <Loading label="Comparing them… this can take a minute." />}
              {!comparing && compare && <Comparison c={compare} />}
              {!comparing && !compare && !canWrite && <p className="cf-muted">No comparison has been made yet.</p>}
              {!comparing && canWrite && mine.length >= 2 && (!compare || compare.stale) && (
                <div className="cf-buttons cf-syn-go">
                  {compare?.stale && <p className="cf-muted">Your words for this have changed since.</p>}
                  <button className="cf-btn" onClick={() => void runCompare()}>
                    {compare ? "Compare them again with AI" : "Compare them with AI"}
                  </button>
                </div>
              )}
            </section>

            <section className="cf-wp-section">
              <label className="cf-syn-toggle">
                <input type="checkbox" checked={dict} onChange={(e) => setDict(e.target.checked)} /> Other words for “{groupKey}” in the dictionary
              </label>
              {dict && others.length === 0 && <p className="cf-muted">None besides yours.</p>}
              {dict && others.length > 0 && (
                <div className="cf-syn-cards">
                  {others.map((w) => (
                    <SynonymCard key={w.word} w={w} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

/** One word of the group, everything on it at a glance. */
function SynonymCard({ w }: { w: SynonymWord }) {
  const others = w.senses.filter((s) => s !== w.shared).slice(0, 4);
  return (
    <article className={`cf-syn-card is-${w.status}`}>
      <header>
        <button className="cf-syn-word cf-zh" onClick={() => wordpage.openWordPage(w.word)}>
          {w.word}
        </button>
        {w.pinyin && <span className="cf-syn-py">{displayPinyin(w.pinyin)}</span>}
        <span className="cf-syn-status">{w.status === "deck" ? (w.hsk ? <HskTags hsk={w.hsk} /> : null) : w.status === "listed" ? "on a list" : "dictionary"}</span>
      </header>
      <p className="cf-syn-shared">{w.shared}</p>
      {others.length > 0 && <p className="cf-syn-senses">{others.join("; ")}</p>}
      {w.chars.length > 1 && (
        <p className="cf-syn-chars">
          {w.chars.map((c) => (
            <span key={c.ch}>
              <b className="cf-zh">{c.ch}</b> {c.gloss ? c.gloss.split(";")[0] : "—"}
            </span>
          ))}
        </p>
      )}
      {(w.before.length > 0 || w.after.length > 0) && (
        <p className="cf-syn-around">
          {w.before.map((b) => (
            <span key={`b${b.word}`} className="cf-zh">
              {b.word}＿
            </span>
          ))}
          {w.after.map((a) => (
            <span key={`a${a.word}`} className="cf-zh">
              ＿{a.word}
            </span>
          ))}
        </p>
      )}
      {w.example && (
        <p className="cf-syn-example">
          <span className="cf-zh">{w.example.zh}</span>
          {w.example.en && <span className="cf-muted"> {w.example.en}</span>}
        </p>
      )}
      {w.record && (
        <p className="cf-syn-record">
          {w.record.strength !== null && `${fmt(Math.round(w.record.strength))} d strong · `}
          {w.record.forgot ? `forgotten ${fmt(w.record.forgot)}×` : "never forgotten"} · in {fmt(w.record.sentences)}{" "}
          {w.record.sentences === 1 ? "sentence" : "sentences"}
        </p>
      )}
    </article>
  );
}

/** The model's comparison: the gist, a table, each word's core, pitfalls, and a quiz. */
function Comparison({ c }: { c: SynonymCompare }) {
  const words = c.words.filter((w) => c.dimensions.some((d) => d.values[w]));
  return (
    <div className="cf-syn-compare">
      <p className="cf-syn-summary">
        <span className="cf-ai-pill">AI</span> {c.summary}
      </p>
      {c.dimensions.length > 0 && (
        <div className="cf-syn-table-wrap">
          <table className="cf-syn-table">
            <thead>
              <tr>
                <th />
                {words.map((w) => (
                  <th key={w} className="cf-zh">
                    {w}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {c.dimensions.map((d) => (
                <tr key={d.name}>
                  <th scope="row">{d.name}</th>
                  {words.map((w) => (
                    <td key={w}>{d.values[w] ?? "—"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ul className="cf-syn-each">
        {c.each.map((e) => (
          <li key={e.zh}>
            <p>
              <b className="cf-zh">{e.zh}</b> {e.core}
            </p>
            <p className="cf-muted">{e.useWhen}</p>
            <p className="cf-syn-ex">
              <span className="cf-zh">{e.example.zh}</span> <span className="cf-muted">{e.example.en}</span>
            </p>
          </li>
        ))}
      </ul>
      {c.pitfalls.length > 0 && (
        <>
          <h4>Watch out</h4>
          <ul className="cf-syn-pitfalls">
            {c.pitfalls.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </>
      )}
      {c.quiz.length > 0 && <Quiz quiz={c.quiz} />}
    </div>
  );
}

/** Which one fits, on the owner's own sentences: pick, see why, next. */
function Quiz({ quiz }: { quiz: SynonymCompare["quiz"] }) {
  const [at, setAt] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [right, setRight] = useState(0);
  const top = useRef<HTMLDivElement>(null);
  if (at >= quiz.length) {
    return (
      <div className="cf-syn-quiz" ref={top}>
        <h4>Which one fits?</h4>
        <p>
          {right} of {quiz.length} right.{" "}
          <button
            className="cf-link"
            onClick={() => {
              setAt(0);
              setRight(0);
              setPicked(null);
            }}
          >
            Again
          </button>
        </p>
      </div>
    );
  }
  const q = quiz[at];
  return (
    <div className="cf-syn-quiz" ref={top}>
      <h4>
        Which one fits? <small>{at + 1} of {quiz.length}</small>
      </h4>
      <p className="cf-syn-qprompt cf-zh">{q.prompt}</p>
      {picked && q.sentence?.en && <p className="cf-muted">{q.sentence.en}</p>}
      <div className="cf-syn-choices">
        {q.choices.map((c) => (
          <button
            key={c}
            className={`cf-rescue-choice cf-zh${!picked ? "" : c === q.answer ? " is-right" : c === picked ? " is-wrong" : " is-off"}`}
            disabled={picked !== null}
            onClick={() => {
              setPicked(c);
              if (c === q.answer) setRight((n) => n + 1);
            }}
          >
            {c}
          </button>
        ))}
      </div>
      {picked && (
        <>
          <p className={`cf-rescue-verdict${picked === q.answer ? " is-right" : " is-wrong"}`}>
            {picked === q.answer ? "Right." : `It's ${q.answer}.`} {q.explain}
          </p>
          <div className="cf-buttons">
            <button
              className="cf-btn"
              onClick={() => {
                setAt(at + 1);
                setPicked(null);
              }}
            >
              {at + 1 < quiz.length ? "Next" : "Finish"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
