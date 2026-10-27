"use client";

// Muse's daily page (app/api/chongfuxi/musepage.ts): laid out by the owner's
// agent from blocks, drawn here one small component each, and everything
// done on it (cards answered, answers, words tapped, steps) sent back for
// Muse to read. One page a day; "steps" shows one heading's section at a
// time. Owner only: a page may carry text pulled from the web.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MuseBlock, MuseEvent, MuseFilled, MusePage, MusePageListed, Retell, TextToken } from "@chongfuxi/lib/api";
import { get, send } from "@chongfuxi/lib/client";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import * as wordpage from "@chongfuxi/lib/wordpage";
import { DrillCardView, say } from "./Drill";
import { Question, type KeptAnswer } from "./Reading";
import { Loading, fmt, message, useBackLayer } from "./shared";

/** The pages, newest first; null for anyone but the owner, or none yet; undefined while loading. */
export function useMusePages(): MusePageListed[] | null | undefined {
  const [pages, setPages] = useState<MusePageListed[] | null | undefined>(undefined);
  useEffect(() => {
    get<{ pages: MusePageListed[] }>("muse", { list: 1 })
      .then((r) => setPages(r.pages.length ? r.pages : null))
      .catch(() => setPages(null));
  }, []);
  return pages;
}

const dated = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
const shortDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

type Post = (block: string, kind: MuseEvent["kind"], data?: Record<string, unknown>) => void;

/** The page, full screen. */
export function MusePageView({ day, canWrite, onEnd, onEpisode }: { day?: string; canWrite: boolean; onEnd: () => void; onEpisode: (id: number) => void }) {
  const [page, setPage] = useState<MusePage | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    get<{ page: MusePage | null }>("muse", day ? { day } : {})
      .then((r) => setPage(r.page))
      .catch((e) => setError(message(e)));
  }, [day]);

  const post = useCallback<Post>(
    (block, kind, data = {}) => {
      if (!canWrite || !page) return;
      send("muse", { day: page.day, block, kind, data }).catch(() => {});
    },
    [canWrite, page],
  );
  // Opening is an event too, once.
  const opened = useRef(false);
  useEffect(() => {
    if (page && !opened.current) {
      opened.current = true;
      post("page", "open");
    }
  }, [page, post]);

  const steps = useMemo(() => (page ? sectionsOf(page.blocks) : []), [page]);
  const shown = page?.style === "steps" ? (steps[step] ?? []) : (page?.blocks ?? []);
  const go = (n: number) => {
    if (page && n > step) post(steps[step]?.[0]?.id ?? `step${step}`, "done", { step });
    setStep(n);
    scroller.current?.scrollTo({ top: 0 });
  };

  return (
    <div className="cf-rescue cf-mp">
      <div className="cf-fast-top">
        <button className="cf-close" onClick={onEnd} aria-label="Back to the list">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <p className="cf-rescue-top">
          {page && !page.today ? shortDay(page.day) : "Today's page"}
          {page?.style === "steps" && steps.length > 1 ? ` · ${step + 1} of ${steps.length}` : ""}
        </p>
      </div>
      <div className="cf-rescue-in cf-mp-in" ref={scroller}>
        {error && <p className="cf-error">{error}</p>}
        {page === undefined && !error && <Loading label="Opening…" />}
        {page === null && <p className="cf-muted">No page yet. Muse lays one out each day from what you've been doing.</p>}
        {page && (
          <>
            {(step === 0 || page.style !== "steps") && (
              <header className="cf-mp-head">
                <p className="cf-muted cf-story-by">
                  {dated(page.day)} · by {page.model}
                </p>
                <h1 className="cf-mp-title">{page.title}</h1>
                {page.note && <p className="cf-mp-note">{page.note}</p>}
              </header>
            )}
            <Blocks blocks={shown} page={page} canWrite={canWrite} post={post} onEpisode={onEpisode} />
            {page.style === "steps" && steps.length > 1 && (
              <div className="cf-buttons cf-mp-steps">
                {step > 0 && (
                  <button className="cf-link" onClick={() => go(step - 1)}>
                    ‹ Back
                  </button>
                )}
                {step < steps.length - 1 ? (
                  <button className="cf-btn" onClick={() => go(step + 1)}>
                    Next · {stepName(steps[step + 1])}
                  </button>
                ) : (
                  <button
                    className="cf-btn"
                    onClick={() => {
                      post(steps[step]?.[0]?.id ?? `step${step}`, "done", { step });
                      onEnd();
                    }}
                  >
                    Done
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Steps: a new one at each heading. */
function sectionsOf(blocks: MuseBlock[]): MuseBlock[][] {
  const out: MuseBlock[][] = [];
  for (const b of blocks) {
    if (b.type === "heading" || !out.length) out.push([]);
    out[out.length - 1].push(b);
  }
  return out;
}
const stepName = (s: MuseBlock[] | undefined) => (s?.[0]?.type === "heading" ? s[0].text : "Next");

function Blocks(props: { blocks: MuseBlock[]; page: MusePage; canWrite: boolean; post: Post; onEpisode: (id: number) => void }) {
  return (
    <>
      {props.blocks.map((b) => (
        <Block key={b.id} {...props} block={b} />
      ))}
    </>
  );
}

function Block({ block: b, page, canWrite, post, onEpisode }: { block: MuseBlock; page: MusePage; canWrite: boolean; post: Post; onEpisode: (id: number) => void }) {
  const filled = page.filled[b.id];
  switch (b.type) {
    case "heading":
      return <h2 className="cf-mp-h">{b.text}</h2>;
    case "text":
      return <Prose text={b.text} words={b.words} className="cf-mp-text" />;
    case "callout":
      return (
        <aside className={`cf-mp-callout is-${b.tone}`}>
          {b.label && <p className="cf-mp-callout-label">{b.label}</p>}
          <Prose text={b.text} words={b.words} />
        </aside>
      );
    case "passage":
      return <Passage block={b} filled={filled} post={post} />;
    case "cards":
      return <CardsBlock block={b} events={page.events.filter((e) => e.block === b.id && e.kind === "card")} post={post} />;
    case "ask":
      return (
        <div className="cf-mp-ask">
          <Question
            question={{ zh: b.zh, en: b.en }}
            q={0}
            initial={page.events
              .filter((e) => e.block === b.id && e.kind === "answer")
              .map((e): Retell | KeptAnswer =>
                e.data.result ? (e.data.result as Retell) : { kept: true, answer: String(e.data.answer ?? ""), at: e.at },
              )}
            canWrite={canWrite}
            check={(answer) => send<{ retell: Retell | null }>("muse", { day: page.day, block: b.id, answer }).then((r) => r.retell)}
          />
          {b.hint && <p className="cf-muted cf-mp-hint">{b.hint}</p>}
        </div>
      );
    case "words":
      return <WordsBlock block={b} filled={filled} />;
    case "figures":
      return (
        <div className="cf-wk-tiles cf-mp-figures">
          {b.items.map((x, i) => (
            <div key={i} className="cf-wk-tile">
              <span className="cf-wk-tile-n">{x.value}</span>
              <span className="cf-wk-tile-l">{x.label}</span>
              {x.note && <span className="cf-wk-tile-d">{x.note}</span>}
            </div>
          ))}
        </div>
      );
    case "link":
      return (
        <a className="cf-mp-link" href={b.url} target="_blank" rel="noreferrer" onClick={() => post(b.id, "tap", { link: true })}>
          <b>{b.title} ↗</b>
          <small>{new URL(b.url).hostname.replace(/^www\./, "")}</small>
          {b.note && <span className="cf-muted">{b.note}</span>}
        </a>
      );
    case "episode": {
      const e = filled?.kind === "episode" ? filled : null;
      return (
        <button
          className="cf-stuck cf-mp-episode"
          onClick={() => {
            post(b.id, "tap", { episode: b.episode });
            onEpisode(b.episode);
          }}
        >
          <span className="cf-stuck-text">
            <b className="cf-zh">{e ? `${e.show} · ${e.episode}` : "An episode"}</b>
            <small>{[e?.known != null && `${Math.round(e.known * 100)}% known`, b.note].filter(Boolean).join(" · ")}</small>
          </span>
          <i aria-hidden="true">›</i>
        </button>
      );
    }
    case "fold":
      return (
        <details className="cf-mp-fold" onToggle={(ev) => (ev.currentTarget as HTMLDetailsElement).open && post(b.id, "open")}>
          <summary>{b.title}</summary>
          <Blocks blocks={b.blocks} page={page} canWrite={canWrite} post={post} onEpisode={onEpisode} />
        </details>
      );
  }
}

/** Muse's prose: paragraphs at blank lines, **bold**, and the given words linked to their pages. */
function Prose({ text, words, className }: { text: string; words: string[]; className?: string }) {
  const sorted = [...new Set(words)].sort((a, b) => b.length - a.length);
  const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(\\*\\*[^*]+\\*\\*${sorted.length ? `|${sorted.map(esc).join("|")}` : ""})`);
  return (
    <div className={className}>
      {text.split(/\n\s*\n/).map((para, i) => (
        <p key={i}>
          {para.split(pattern).map((part, j) =>
            part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
              <b key={j}>{part.slice(2, -2)}</b>
            ) : sorted.includes(part) ? (
              <button key={j} className="cf-wk-w cf-zh" onClick={() => wordpage.openWordPage(part)}>
                {part}
              </button>
            ) : (
              <span key={j}>{part}</span>
            ),
          )}
        </p>
      ))}
    </div>
  );
}

/** Chinese to read: every word marked against the deck and tappable, the English a paragraph at a time, read aloud on a tap. */
function Passage({ block: b, filled, post }: { block: Extract<MuseBlock, { type: "passage" }>; filled: MuseFilled | undefined; post: Post }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [english, setEnglish] = useState<Set<number>>(new Set());
  const tapped = useRef(new Set<string>());
  const sent = useRef(0);
  const flush = useCallback(() => {
    if (tapped.current.size === sent.current) return;
    sent.current = tapped.current.size;
    post(b.id, "tap", { words: [...tapped.current] });
  }, [b.id, post]);
  useEffect(() => () => flush(), [flush]);
  const a = filled?.kind === "passage" ? filled.text : null;
  const en = b.en ? b.en.split(/\n+/).map((l) => l.trim()).filter(Boolean) : [];
  const zhParas = b.zh.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const look = picked && a ? a.looks[picked] : null;
  const highlight = new Set(b.words);
  return (
    <section className="cf-mp-passage">
      {b.title && <h3 className="cf-mp-ptitle cf-zh">{b.title}</h3>}
      <div className="cf-mp-pmeta">
        {a && a.words.total > 0 && <span className="cf-muted">{Math.round((a.words.known / a.words.total) * 100)}% known</span>}
        {b.source && (
          <a className="cf-link" href={b.source.url} target="_blank" rel="noreferrer">
            {b.source.name || new URL(b.source.url).hostname.replace(/^www\./, "")} ↗
          </a>
        )}
        <button className="cf-link" onClick={() => say(b.zh)}>
          🔊 Listen
        </button>
      </div>
      <div className="cf-an-body cf-mp-pbody">
        {(a ? a.paragraphs : zhParas.map((p) => [[{ t: p } as TextToken]])).map((p, i) => (
          <div key={i}>
            <p className="cf-zh">
              {p.flat().map((t: TextToken, j) =>
                t.k ? (
                  <button
                    key={j}
                    className={`cf-an-w is-${t.k}${highlight.has(t.t) ? " is-focus" : ""}${picked === t.t ? " is-picked" : ""}`}
                    onClick={() => {
                      setPicked(picked === t.t ? null : t.t);
                      tapped.current.add(t.t);
                    }}
                  >
                    {t.t}
                  </button>
                ) : (
                  <span key={j}>{t.t}</span>
                ),
              )}
            </p>
            {en[i] &&
              (english.has(i) ? (
                <p className="cf-muted cf-story-en">{en[i]}</p>
              ) : (
                <button className="cf-link cf-story-show" onClick={() => setEnglish(new Set([...english, i]))}>
                  English
                </button>
              ))}
          </div>
        ))}
      </div>
      {picked && (
        <div className="cf-an-picked cf-mp-picked">
          <p>
            <span className="cf-zh">{picked}</span> {look?.p && <b>{displayPinyin(look.p)}</b>}
          </p>
          {look?.gloss && <p className="cf-muted">{look.gloss}</p>}
          <div className="cf-an-picked-foot">
            <button className="cf-link" onClick={() => wordpage.openWordPage(picked)}>
              Word page ›
            </button>
            <button
              className="cf-link"
              onClick={() => {
                setPicked(null);
                flush();
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** A deck: a row with how far it got, opening the cards full screen. */
function CardsBlock({ block: b, events, post }: { block: Extract<MuseBlock, { type: "cards" }>; events: MuseEvent[]; post: Post }) {
  // The latest result per card, from what was kept and what is answered now.
  const [results, setResults] = useState<Record<number, "got" | "missed">>(() => {
    const out: Record<number, "got" | "missed"> = {};
    for (const e of events) if (typeof e.data.idx === "number") out[e.data.idx] = e.data.grade === "got" ? "got" : "missed";
    return out;
  });
  const [deck, setDeck] = useState<number[] | null>(null);
  const [at, setAt] = useState(0);
  useBackLayer(deck !== null, () => setDeck(null));
  const done = Object.keys(results).length;
  const got = Object.values(results).filter((r) => r === "got").length;
  const missed = b.cards.map((_, i) => i).filter((i) => results[i] === "missed");
  const open = (cards: number[]) => {
    setDeck(cards);
    setAt(0);
  };
  const current = deck?.[at];
  return (
    <>
      <button
        className="cf-stuck cf-mp-cards"
        onClick={() => {
          const left = b.cards.map((_, i) => i).filter((i) => !results[i]);
          open(left.length ? left : b.cards.map((_, i) => i));
        }}
      >
        <span className="cf-stuck-text">
          <b>{b.title || "Cards"}</b>
          <small>
            {done ? `${fmt(got)} of ${fmt(done)} got · ` : ""}
            {done < b.cards.length ? `${fmt(b.cards.length - done)} of ${fmt(b.cards.length)} to go` : "all done"}
          </small>
        </span>
        {done < b.cards.length && <span className="cf-stuck-count">{fmt(b.cards.length - done)}</span>}
        <i aria-hidden="true">›</i>
      </button>
      {done === b.cards.length && missed.length > 0 && (
        <button className="cf-link cf-mp-again" onClick={() => open(missed)}>
          Go over the {fmt(missed.length)} missed
        </button>
      )}
      {deck && (
        <div className="cf-mp-deck cf-rescue cf-speed cf-drill">
          <div className="cf-fast-top">
            <button className="cf-close" onClick={() => setDeck(null)} aria-label="Back to the page">
              <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
            <p className="cf-rescue-top">
              {b.title || "Cards"}
              {current !== undefined ? ` · ${fmt(at + 1)} of ${fmt(deck.length)}` : ""}
            </p>
          </div>
          {current !== undefined ? (
            <div className="cf-speed-stage">
              <DrillCardView
                key={`${at}-${current}`}
                card={b.cards[current]}
                onGrade={(ok, given) => {
                  setResults((r) => ({ ...r, [current]: ok ? "got" : "missed" }));
                  post(b.id, "card", { idx: current, grade: ok ? "got" : "missed", given });
                  setAt((n) => n + 1);
                }}
              />
            </div>
          ) : (
            <div className="cf-rescue-in cf-speed-end">
              <p className="cf-rescue-score">
                {fmt(deck.filter((i) => results[i] === "got").length)} of {fmt(deck.length)} got
              </p>
              <p className="cf-muted">Muse sees how each went when it lays out the next page.</p>
              <div className="cf-buttons">
                <button className="cf-btn" onClick={() => setDeck(null)}>
                  Back to the page
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

const STANDING = { deck: "Known", learning: "Learning", listed: "On a list", new: "New" } as const;

function WordsBlock({ block: b, filled }: { block: Extract<MuseBlock, { type: "words" }>; filled: MuseFilled | undefined }) {
  const info = new Map((filled?.kind === "words" ? filled.words : []).map((w) => [w.word, w]));
  return (
    <section className="cf-mp-words">
      {b.title && <h3 className="cf-mp-wtitle">{b.title}</h3>}
      <ul className="cf-stuck-list">
        {b.words.map((w) => {
          const x = info.get(w.word);
          return (
            <li key={w.word}>
              <button onClick={() => wordpage.openWordPage(w.word)}>
                <span className="cf-stuck-zh cf-zh">{w.word}</span>
                <span className="cf-stuck-body">
                  {x?.pinyin && <span className="cf-stuck-py">{displayPinyin(x.pinyin)}</span>}
                  {x?.gloss && <span className="cf-stuck-gloss">{x.gloss}</span>}
                  {w.note && <span className="cf-stuck-why">{w.note}</span>}
                </span>
                {x && <span className={`cf-stuck-state is-${x.standing === "deck" ? "done" : "none"}`}>{STANDING[x.standing]}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Earlier pages, newest first; one opens over the list. */
export function MusePageList({ canWrite, onEnd, onEpisode }: { canWrite: boolean; onEnd: () => void; onEpisode: (id: number) => void }) {
  const [pages, setPages] = useState<MusePageListed[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useBackLayer(open !== null, () => setOpen(null));
  useEffect(() => {
    if (open) return;
    get<{ pages: MusePageListed[] }>("muse", { list: 1 })
      .then((r) => setPages(r.pages))
      .catch((e) => setError(message(e)));
  }, [open]);
  if (open) return <MusePageView day={open} canWrite={canWrite} onEnd={() => setOpen(null)} onEpisode={onEpisode} />;
  return (
    <div className="cf-rescue">
      <div className="cf-fast-top">
        <button className="cf-close" onClick={onEnd} aria-label="Back to the list">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <p className="cf-rescue-top">Muse&apos;s pages</p>
      </div>
      <div className="cf-rescue-in">
        {error && <p className="cf-error">{error}</p>}
        {!pages && !error && <Loading label="Finding them…" />}
        {pages && (
          <ul className="cf-muse-tools">
            {pages.map((p) => (
              <li key={p.day}>
                <button onClick={() => setOpen(p.day)}>
                  <b>{p.title}</b>
                  <small>
                    {p.today ? "Today" : shortDay(p.day)} · {fmt(p.touched)}/{fmt(p.blocks)} done
                  </small>
                  <i aria-hidden="true">›</i>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
