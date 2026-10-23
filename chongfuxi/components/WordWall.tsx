"use client";

// Every word in the deck as a tile, shaded by how strong its Read card is,
// with a dot on the ones due today. Grouped by when they're due, how strong
// they are, or the trouble they've given (HSK levels are on Stats); found by word,
// pinyin or meaning. A tile opens the word's sheet: its cards and how they
// stand, Pleco's record, and the sentences it is in.

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { routeParam, useRouteParam } from "@chongfuxi/lib/route";
import * as wordpage from "@chongfuxi/lib/wordpage";
import type { WordPage, WordPageSentence, WordTile } from "@chongfuxi/lib/api";
import * as bugs from "@chongfuxi/lib/bugs";
import { ApiError, get, send, today } from "@chongfuxi/lib/client";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import { mainFirst } from "@chongfuxi/lib/senses";
import { Loading, AiPill, AiTag, DefineButton, Highlighted, History, LongkuTag, PlecoTile, aiDefined, fmt, message, span, useBackLayer } from "./shared";
import { SameEnglish } from "./Synonyms";
import { Rescue } from "./Rescue";

const DAY = 86_400_000;
/** Tiles drawn per group before "Show all". */
const SHOWN = 240;

/** Where a word's Read card stands, as on the HSK bars. */
const STAGES = [
  { key: "strong", label: "Strong", note: "6 months or more" },
  { key: "mature", label: "Mature", note: "3 weeks to 6 months" },
  { key: "young", label: "Young", note: "under 3 weeks" },
  { key: "waiting", label: "Waiting", note: "not answered here yet" },
] as const;
type Stage = (typeof STAGES)[number]["key"];

const stageOf = (w: { answered: number; stability: number }): Stage =>
  w.answered === 0 ? "waiting" : w.stability < 21 ? "young" : w.stability < 180 ? "mature" : "strong";

type GroupBy = "due" | "strength" | "trouble";
const GROUPINGS: Array<{ key: GroupBy; label: string }> = [
  { key: "due", label: "When due" },
  { key: "strength", label: "Strength" },
  { key: "trouble", label: "Trouble" },
];

interface Group {
  key: string;
  label: string;
  words: WordTile[];
}

function groupWords(words: WordTile[], by: GroupBy, cutoff: number): Group[] {
  const make = (pairs: Array<[string, string, (w: WordTile) => boolean]>, order: (a: WordTile, b: WordTile) => number) =>
    pairs.map(([key, label, test]) => ({ key, label, words: words.filter(test).sort(order) })).filter((g) => g.words.length > 0);
  const strongest = (a: WordTile, b: WordTile) => b.stability - a.stability || a.word.localeCompare(b.word);

  if (by === "due") {
    const within = (days: number) => (w: WordTile) => w.due <= cutoff + days * DAY;
    return make(
      [
        ["today", "Due today", within(0)],
        ["tomorrow", "Tomorrow", (w) => !within(0)(w) && within(1)(w)],
        ["week", "This week", (w) => !within(1)(w) && within(7)(w)],
        ["month", "This month", (w) => !within(7)(w) && within(30)(w)],
        ["later", "Later", (w) => !within(30)(w)],
      ],
      (a, b) => a.due - b.due,
    );
  }
  if (by === "strength") {
    return make(
      STAGES.map((s) => [s.key, `${s.label}, ${s.note}`, (w: WordTile) => stageOf(w) === s.key]),
      strongest,
    );
  }
  return make(
    [
      ["lapsed", "Forgotten here", (w) => w.forgotHere > 0],
      ["hard", "Hard for FSRS, difficulty 7 or more", (w) => w.forgotHere === 0 && w.difficulty >= 7],
    ],
    (a, b) => b.forgotHere - a.forgotHere || b.difficulty - a.difficulty || a.word.localeCompare(b.word),
  );
}

/** Pinyin without tones or breaks, for matching what is typed: "ren2" → "ren". */
const plain = (pinyin: string | null) => (pinyin ?? "").replace(/[@\s\d-]/g, "").toLowerCase();

export function WordWall({ canWrite, onFindSentences }: { canWrite: boolean; onFindSentences: (word: string) => void }) {
  const [words, setWords] = useState<WordTile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [by, setBy] = useState<GroupBy>("due");
  const [query, setQuery] = useState("");
  // A word removed, brought back or added from its page (opened over everything, lib/wordpage.ts).
  useEffect(
    () =>
      wordpage.onChange(({ word, change }) =>
        change === "added"
          ? void get<{ words: WordTile[] }>("words").then((r) => setWords(r.words), () => {})
          : setWords((list) =>
              change === "removed" ? (list?.filter((x) => x.word !== word) ?? null) : (list?.map((x) => (x.word === word ? { ...x, suspended: false } : x)) ?? null),
            ),
      ),
    [],
  );
  const [all, setAll] = useState<Set<string>>(new Set());
  // Groups opened, by grouping and group. They start closed, so the page opens
  // as an overview; a search opens every group it finds something in.
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const flip = (id: string) =>
    setOpened((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  useEffect(() => {
    get<{ words: WordTile[] }>("words")
      .then((r) => setWords(r.words))
      .catch((e) => setError(message(e)));
  }, []);

  const cutoff = today().cutoff;
  const found = useMemo(() => {
    if (!words) return [];
    const q = query.trim().toLowerCase();
    if (!q) return words;
    const qp = q.replace(/[\s\d]/g, "");
    return words.filter(
      (w) => w.word.includes(q) || (qp && plain(w.pinyin).startsWith(qp)) || w.gloss?.toLowerCase().includes(q),
    );
  }, [words, query]);
  // Suspended words leave every grouping for one of their own, first.
  const groups = useMemo(() => {
    const set = found.filter((w) => w.suspended);
    const rest = groupWords(
      found.filter((w) => !w.suspended),
      by,
      cutoff,
    );
    return set.length ? [{ key: "suspended", label: "Suspended", words: set }, ...rest] : rest;
  }, [found, by, cutoff]);

  if (error) return <p className="cf-error">{error}</p>;
  if (!words) return <Loading label="Laying out the words…" />;

  const inReview = words.filter((w) => !w.suspended);
  const counts = Object.fromEntries(STAGES.map((s) => [s.key, inReview.filter((w) => stageOf(w) === s.key).length])) as Record<
    Stage,
    number
  >;
  const dueToday = inReview.filter((w) => w.due <= cutoff).length;

  return (
    <section className="cf-wall">
      {/* The whole deck in one bar, strongest first. */}
      <div
        className="cf-wall-bar"
        role="img"
        aria-label={STAGES.map((s) => `${fmt(counts[s.key])} ${s.label.toLowerCase()}`).join(", ")}
      >
        {STAGES.map((s) =>
          counts[s.key] ? (
            <i
              key={s.key}
              className={`is-${s.key}`}
              style={{ flexGrow: counts[s.key] }}
              title={`${fmt(counts[s.key])} ${s.label.toLowerCase()}`}
            />
          ) : null,
        )}
      </div>
      <p className="cf-wall-key">
        {STAGES.map((s) => (
          <span key={s.key} title={s.note}>
            <i className={`cf-tile-swatch is-${s.key}`} />
            {s.label} <b>{fmt(counts[s.key])}</b>
          </span>
        ))}
        <span>
          <i className="cf-tile-swatch is-due" />
          Due today <b>{fmt(dueToday)}</b>
        </span>
      </p>

      <div className="cf-wall-tools">
        <input
          className="cf-input"
          type="search"
          placeholder="Find a word: 人, ren, person…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Find a word by characters, pinyin or meaning"
        />
        <div className="cf-seg" role="tablist" aria-label="Group the words">
          {GROUPINGS.map((g) => (
            <button
              key={g.key}
              role="tab"
              aria-selected={by === g.key}
              className={`cf-seg-btn${by === g.key ? " is-on" : ""}`}
              onClick={() => setBy(g.key)}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {groups.length === 0 && (
        <p className="cf-muted cf-pad">
          {query ? `No deck word matches “${query}”.` : by === "trouble" ? "Nothing has given you trouble yet." : "No words."}
        </p>
      )}
      {groups.map((g) => {
        const id = `${by}:${g.key}`;
        const isOpen = query.trim() !== "" || opened.has(id);
        const shown = all.has(id) ? g.words : g.words.slice(0, SHOWN);
        const mix = STAGES.map((st) => ({ key: st.key, n: g.words.filter((w) => stageOf(w) === st.key).length }));
        return (
          <div key={g.key} className={`cf-wall-group${isOpen ? " is-open" : ""}`}>
            <button className="cf-wall-head" aria-expanded={isOpen} onClick={() => flip(id)}>
              <svg className="cf-chevron" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
                <path
                  d="M4 2.5 7.5 6 4 9.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="cf-wall-label">{g.label}</span>
              {/* The group's own mix of strengths, small. */}
              <span className="cf-wall-mix" aria-hidden="true">
                {mix.map((m) => (m.n ? <i key={m.key} className={`is-${m.key}`} style={{ flexGrow: m.n }} /> : null))}
              </span>
              <b>{fmt(g.words.length)}</b>
            </button>
            {isOpen && (
              <>
                <ul className="cf-tiles-grid">
                  {shown.map((w) => {
                    const stage = stageOf(w);
                    // Grouped by when due, the group says it; elsewhere a dot does.
                    const due = by !== "due" && w.due <= cutoff && !w.suspended;
                    return (
                      <li key={w.word}>
                        <button
                          className={`cf-tile-word is-${stage}${due ? " is-due" : ""}${w.suspended ? " is-suspended" : ""}`}
                          style={{ "--n": Math.min(Math.max([...w.word].length, 2), 5) } as React.CSSProperties}
                          onClick={() => wordpage.openWordPage(w.word)}
                          aria-label={`${w.word}: ${w.suspended ? "suspended" : stage}${due ? ", due today" : ""}`}
                        >
                          {w.word}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {shown.length < g.words.length && (
                  <button className="cf-more" onClick={() => setAll((s) => new Set(s).add(id))}>
                    Show all {fmt(g.words.length)}
                  </button>
                )}
              </>
            )}
          </div>
        );
      })}

    </section>
  );
}

/** Where a strength of so many days sits on a meter: a log scale, full at two years. */
const onMeter = (days: number) => Math.min(1, Math.log1p(Math.max(0, days)) / Math.log1p(730));

const KIND = { read: "Read", produce: "Recall", sentence: "Sentence" } as const;

function dueText(due: number, cutoff: number): string {
  if (due <= cutoff) {
    const late = Math.floor((cutoff - due) / DAY);
    return late >= 1 ? `today, ${span(late)} late` : "today";
  }
  const days = Math.ceil((due - cutoff) / DAY);
  return days === 1 ? "tomorrow" : `in ${span(days)}`;
}

/**
 * A word's page, over everything (opened from the Words tab and from a
 * sentence's page): how the word lives in the owner's corpus. Its meanings,
 * its cards and a chart of how often each was got, Pleco's record, how it
 * came in and its Learn, every sentence it is in (locked ones too), the
 * sentence cards it tripped, what was written after forgetting it, what was
 * looked up about it, and the words around it (app/api/chongfuxi/wordpage.ts).
 */
export function WordSheet({
  word,
  canWrite,
  onClose,
  onRemoved,
  onBack,
  onAdded,
  onFindSentences,
  onOpenWord,
}: {
  word: string;
  canWrite: boolean;
  onClose: () => void;
  onRemoved: (word: string) => void;
  /** Brought back from being suspended. */
  onBack?: (word: string) => void;
  /** Put in the deck from here (or that undone, which is onRemoved without closing). */
  onAdded?: (word: string) => void;
  /** Its sentences under Sentences: only while Cards is on screen to show them. */
  onFindSentences?: (word: string) => void;
  /** Another word's page, from the words around this one. */
  onOpenWord?: (word: string) => void;
}) {
  const [d, setD] = useState<WordPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bringing, setBringing] = useState(false);
  const [more, setMore] = useState(false);
  // Its memory kit, over the page (any word, on demand: the owner's ask); back closes it.
  const [kit, setKit] = useState(false);
  useBackLayer(kit, () => setKit(false));
  // Its sentences a panel at a time (readable, one away, locked), each loaded when first opened.
  const [panel, setPanel] = useState<Standing>("readable");
  const [rows, setRows] = useState<Partial<Record<Standing, WordPageSentence[]>>>({});
  // How many of a panel's sentences show: a few at first (the owner found the page too long), more on a tap.
  const [showing, setShowing] = useState<Partial<Record<Standing, number>>>({});
  const [allTripped, setAllTripped] = useState(false);
  // Removing it from the deck: asked once, then done.
  const [removing, setRemoving] = useState<"ask" | "busy" | null>(null);
  // Not in the corpus at all: only a dictionary word, which can still be added.
  const [missing, setMissing] = useState(false);
  // Put in the deck from here: the addition, to undo. The page is loaded again (`loads`) either way.
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<{ id: number; unlocked: number } | null>(null);
  const [loads, setLoads] = useState(0);
  const add = async () => {
    setAdding(true);
    setError(null);
    try {
      const r = await send<{ id: number | null; unlocked: number }>("word", { word, action: "add" });
      if (r.id) setAdded({ id: r.id, unlocked: r.unlocked });
      onAdded?.(word);
      setLoads((n) => n + 1);
    } catch (e) {
      setError(message(e));
    } finally {
      setAdding(false);
    }
  };
  const undoAdd = async () => {
    if (!added) return;
    setAdding(true);
    setError(null);
    try {
      await send(`additions/${added.id}`, { action: "undo" });
      setAdded(null);
      wordpage.changed({ word, change: "removed" });
      setLoads((n) => n + 1);
    } catch (e) {
      setError(message(e));
    } finally {
      setAdding(false);
    }
  };

  const bringBack = async () => {
    setBringing(true);
    setError(null);
    try {
      await send("word", { word, action: "resume" });
      setD((x) => (x ? { ...x, suspended: false } : x));
      onBack?.(word);
    } catch (e) {
      setError(message(e));
    } finally {
      setBringing(false);
    }
  };
  const remove = async () => {
    setRemoving("busy");
    setError(null);
    try {
      await send("word", { word, action: "remove" });
      onRemoved(word);
    } catch (e) {
      setError(message(e));
      setRemoving(null);
    }
  };
  const loadSentences = async (status: Standing, offset: number) => {
    setMore(true);
    try {
      const r = await get<{ rows: WordPageSentence[] }>("word/page", { w: word, status, sentences: offset });
      setRows((x) => ({ ...x, [status]: [...(offset ? (x[status] ?? []) : []), ...r.rows] }));
    } catch (e) {
      setError(message(e));
    } finally {
      setMore(false);
    }
  };
  const openPanel = (status: Standing) => {
    setPanel(status);
    if (!rows[status]) void loadSentences(status, 0);
  };

  useEffect(() => {
    setD(null);
    setMissing(false);
    get<WordPage>("word/page", { w: word })
      .then((p) => {
        setD(p);
        setPanel(p.sentencesAll.status);
        setRows({ [p.sentencesAll.status]: p.sentencesAll.rows });
      })
      .catch((e) => (e instanceof ApiError && e.status === 404 ? setMissing(true) : setError(message(e))));
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [word, onClose, loads]);

  const cutoff = today().cutoff;
  const date = (at: number) => new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="cf-wordpage" role="dialog" aria-modal="true" aria-label={word}>
      <div className="cf-wordpage-in">
        <button className="cf-close cf-sheet-close" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>

        <header className="cf-sheet-head">
          <h2>{word}</h2>
          {d?.pinyin && <p className="cf-sheet-py">{displayPinyin(d.pinyin)}</p>}
          {d && (
            <p className="cf-sheet-tags">
              {d.hsk.old && <span className={`cf-tag cf-hsk cf-level is-l${d.hsk.old}`}>HSK {d.hsk.old}</span>}
              {d.hsk.v3 && (
                <span className={`cf-tag cf-hsk cf-level is-l${d.hsk.v3.split("-")[0]}`}>
                  HSK 3.0: {d.hsk.v3.replace("-", "–")}
                </span>
              )}
              {!d.hsk.old && !d.hsk.v3 && <span className="cf-tag cf-hsk is-none">not HSK</span>}
              {d.longku && <LongkuTag />}
              {aiDefined(d.defs) && <AiTag />}
              {d.suspended && <span className="cf-tag">suspended</span>}
              <PlecoTile word={word} inline />
            </p>
          )}
        </header>

        {error && <p className="cf-error">{error}</p>}
        {!d && !error && !missing && <Loading label="Gathering everything about it…" />}

        {d && (
          <button className="cf-stuck cf-wp-kit" onClick={() => setKit(true)}>
            <span className="cf-stuck-text">
              <b>Memory kit</b>
              <small>A hook, where its characters come from, sentences, what not to mix it up with</small>
            </span>
            <i aria-hidden="true">›</i>
          </button>
        )}
        {kit && (
          <div className="cf-kit-over">
            <Rescue canWrite={canWrite} word={word} onEnd={() => setKit(false)} />
          </div>
        )}

        {/* Not in the deck: added from here, at the top, where it is looked for (the owner's request). */}
        {(missing || (d && d.status !== "deck")) && (
          <section className="cf-wp-add">
            <p>
              {missing
                ? `${word} isn't in your corpus yet: it's in no deck, list or sentence of yours.`
                : d?.status === "name"
                  ? "A name in your sentences, not in your deck."
                  : "On a list, not in your deck."}
            </p>
            {canWrite && (
              <button className="cf-btn" disabled={adding} onClick={() => void add()}>
                {adding ? "Adding…" : "Add to deck"}
              </button>
            )}
          </section>
        )}
        {added && d?.status === "deck" && (
          <section className="cf-wp-add is-added">
            <p>
              Added to your deck: a new Read card
              {added.unlocked > 0 && `, and ${fmt(added.unlocked)} ${added.unlocked === 1 ? "sentence" : "sentences"} readable now`}.
            </p>
            <button className="cf-btn cf-btn-ghost" disabled={adding} onClick={() => void undoAdd()}>
              {adding ? "Undoing…" : "Undo"}
            </button>
          </section>
        )}

        {d && (
          <>
            {/* Every meaning, the main one first, each reading of its own. */}
            <section className="cf-wp-section">
              <h3>Meaning</h3>
              {d.defs.length > 0 ? (
                <div className="cf-wp-defs">
                  {mainFirst(d.defs, d.pinyin).map((def, i) => (
                    <div key={i} className="cf-wp-def">
                      {def.own ? (
                        <span className="cf-wp-def-from">Your Pleco card</span>
                      ) : (
                        def.p && def.p !== d.pinyin && <span className="cf-wp-def-from">{displayPinyin(def.p)}</span>
                      )}
                      <ol>
                        {def.senses.map((s) => (
                          <li key={s}>
                            {s}
                            {def.ai && (
                              <>
                                {" "}
                                <AiPill
                                  word={word}
                                  onUndone={() => setD({ ...d, pinyin: d.defs.some((x) => x.aiPinyin) ? null : d.pinyin, defs: [] })}
                                />
                              </>
                            )}
                          </li>
                        ))}
                      </ol>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <p className="cf-muted">No definition on file.</p>
                  {canWrite && <DefineButton word={word} onDefined={(r) => setD({ ...d, pinyin: d.pinyin ?? r.pinyin, defs: r.defs })} />}
                </>
              )}
            </section>

            {/* Its cards: how each stands, and how often it has been got. */}
            <section className="cf-wp-section">
              <h3>Your cards</h3>
              <GotItChart answers={d.answers} />
              {d.cards.map((c, i) => (
                <section key={i} className={`cf-sheet-card is-${c.kind}`}>
                  <h4>
                    <i className="cf-dot" />
                    {c.meaning ? `Meaning: ${c.meaning}` : KIND[c.kind]}
                    {c.isNew && <span className="cf-tag">new</span>}
                  </h4>
                  <div className="cf-meter" style={{ "--from": "0%", "--to": `${onMeter(c.stability) * 100}%` } as React.CSSProperties}>
                    <i className="cf-meter-fill" />
                  </div>
                  <dl className="cf-sheet-facts">
                    <div>
                      <dt>Due</dt>
                      <dd>{dueText(c.due, cutoff)}</dd>
                    </div>
                    <div>
                      <dt>Strength</dt>
                      <dd>{c.stability > 0 ? span(Math.max(1, Math.round(c.stability))) : "none yet"}</dd>
                    </div>
                    <div>
                      <dt>Recall odds now</dt>
                      <dd>{c.odds === null ? "–" : `${Math.round(c.odds * 100)}%`}</dd>
                    </div>
                    <div>
                      <dt>Difficulty</dt>
                      <dd>{c.difficulty > 0 ? `${c.difficulty.toFixed(1)} of 10` : "–"}</dd>
                    </div>
                    <div>
                      <dt>Answered here</dt>
                      <dd>
                        {fmt(c.answered)}
                        {c.forgotHere > 0 && <span className="cf-sheet-lapses">, forgot {fmt(c.forgotHere)}</span>}
                      </dd>
                    </div>
                  </dl>
                  <History h={c.history} />
                  {c.note && <p className="cf-note">{c.note}</p>}
                </section>
              ))}
              {d.cards.every((c) => c.kind !== "produce") && (
                <p className="cf-muted cf-sheet-aside">No Recall card yet: it opens the first time you get the Read card right here.</p>
              )}
              {d.pleco && (
                <p className="cf-wp-line">
                  <b>In Pleco, before:</b> score {fmt(d.pleco.score)}, right {fmt(d.pleco.correct)}, wrong {fmt(d.pleco.incorrect)}
                  {d.pleco.first ? `, studied from ${date(d.pleco.first)}` : ""}
                  {d.pleco.last ? ` to ${date(d.pleco.last)}` : ""}.
                </p>
              )}
            </section>

            {/* What was written after forgetting it, and the sentences it tripped. */}
            {(d.notes.length > 0 || d.tripped.length > 0) && (
              <section className="cf-wp-section">
                <h3>Where it tripped you</h3>
                {d.notes.map((n, i) => (
                  <p key={`n${i}`} className="cf-wp-note">
                    <span>
                      {KIND[n.kind]} · {date(n.at)}
                    </span>
                    “{n.comment}”
                  </p>
                ))}
                {d.tripped.length > 0 && (
                  <>
                    <p className="cf-muted">
                      Sentence cards forgotten with {word} marked as the trouble: {fmt(d.tripped.length)}
                    </p>
                    <ul className="cf-wp-sentences">
                      {(allTripped ? d.tripped : d.tripped.slice(0, TRIPPED_FIRST)).map((t, i) => (
                        <li key={`${t.id}-${i}`}>
                          <p className="cf-zh">
                            <Highlighted text={t.zh} word={word} />
                          </p>
                          {t.en && <p className="cf-en">{t.en}</p>}
                          <p className="cf-wp-meta">
                            {date(t.at)}
                            {t.comment ? ` · “${t.comment}”` : ""}
                          </p>
                        </li>
                      ))}
                    </ul>
                    {!allTripped && d.tripped.length > TRIPPED_FIRST && (
                      <button className="cf-more" onClick={() => setAllTripped(true)}>
                        Show all {fmt(d.tripped.length)}
                      </button>
                    )}
                  </>
                )}
              </section>
            )}

            {/* Lookups asked from its cards, or naming it. */}
            {d.lookups.length > 0 && (
              <section className="cf-wp-section">
                <h3>Looked up</h3>
                <ul className="cf-wp-lookups">
                  {d.lookups.map((l) => (
                    <li key={l.query}>
                      <span className="cf-wp-lookup-q">{l.query}</span>
                      <span className="cf-wp-meta">
                        {date(l.at)}
                        {l.via === "review" ? " · from a review card" : l.via === "learn" ? ` · while learning it${l.step ? ` (${l.step})` : ""}` : ""}
                        {l.verdict === "right" ? " · ✓" : l.verdict === "wrong" ? " · ✗" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Its sentences, every one. */}
            <section className="cf-wp-section">
              <h3>Sentences</h3>
              {/* A panel per standing, each with its count: tap Locked to see the locked ones. */}
              <div className="cf-chips cf-wp-panels" role="tablist">
                {STANDINGS.map((t) => (
                  <button
                    key={t.key}
                    role="tab"
                    aria-selected={panel === t.key}
                    className={`cf-chip${panel === t.key ? " is-on" : ""}`}
                    onClick={() => openPanel(t.key)}
                  >
                    {t.label}
                    <small>{fmt(d.sentences[t.count])}</small>
                  </button>
                ))}
              </div>
              <p className="cf-muted cf-wp-read">
                Read in context {fmt(d.exposures)} {d.exposures === 1 ? "time" : "times"}
              </p>
              {(() => {
                const loaded = rows[panel];
                const total = d.sentences[STANDINGS.find((t) => t.key === panel)!.count];
                if (!loaded) return <Loading small label="Finding them…" />;
                if (!loaded.length) return <p className="cf-muted">None.</p>;
                const limit = showing[panel] ?? SENTENCES_FIRST;
                const shown = loaded.slice(0, limit);
                // Shows more of what is loaded, and loads the next page when that runs out.
                const showMore = () => {
                  const next = limit + SENTENCES_MORE;
                  setShowing((x) => ({ ...x, [panel]: next }));
                  if (next > loaded.length && loaded.length < total) void loadSentences(panel, loaded.length);
                };
                return (
                  <>
                    <ul className="cf-wp-sentences">
                      {shown.map((s) => (
                        <li key={s.id} className={`is-${s.status}`}>
                          <p className="cf-zh">
                            <Highlighted text={s.zh} word={word} />
                          </p>
                          {s.en && <p className="cf-en">{s.en}</p>}
                          <p className="cf-wp-meta">
                            <i className="cf-wp-dot" />
                            {s.status === "readable" ? "Readable" : `Needs ${s.blockers.join(", ")}`}
                            {s.card &&
                              (s.card.retired ? " · retired" : s.card.answered ? ` · read ${fmt(s.card.answered)}×, ${s.card.cleanReads} of 2 clean` : " · card not started")}
                            {s.sources.length > 0 && ` · ${s.sources.join(", ")}`}
                          </p>
                        </li>
                      ))}
                    </ul>
                    {shown.length < total && (
                      <button className="cf-more" disabled={more} onClick={showMore}>
                        {more ? "Loading…" : `Show more (${fmt(total - shown.length)} left)`}
                      </button>
                    )}
                  </>
                );
              })()}
              {d.sentencesAll.total > 0 && onFindSentences && (
                <button className="cf-btn cf-btn-ghost" onClick={() => onFindSentences(word)}>
                  Open them under Sentences
                </button>
              )}
            </section>

            {/* How it lives in the corpus: how it came, Learn, what it opened, its neighbours. */}
            <section className="cf-wp-section">
              <h3>In your corpus</h3>
              <dl className="cf-wp-facts">
                <div>
                  <dt>Came in</dt>
                  <dd>
                    {d.origin.length
                      ? d.origin.map((o) => `${sourceName(o.source)}, ${date(o.at)}${o.undone ? " (undone)" : ""}`).join("; ")
                      : d.pleco
                        ? "From your Pleco backup"
                        : "From an import"}
                  </dd>
                </div>
                {d.lists.length > 0 && (
                  <div>
                    <dt>On lists</dt>
                    <dd>{d.lists.join(" · ")}</dd>
                  </div>
                )}
                <div>
                  <dt>Learn</dt>
                  <dd>
                    {d.learn.sessions.some((s) => s.known)
                      ? `Marked as known${d.learn.learnedAt ? ` on ${date(d.learn.learnedAt)}` : ""}`
                      : d.learn.learnedAt
                        ? `Learned ${date(d.learn.learnedAt)}`
                        : d.learn.sessions.length
                          ? "Part way up the ladder"
                          : "Not through Learn (it came in known)"}
                    {d.learn.sessions.length > 0 &&
                      ` · ${fmt(d.learn.sessions.reduce((n, s) => n + s.steps, 0))} steps, ${fmt(d.learn.sessions.reduce((n, s) => n + s.misses, 0))} missed`}
                  </dd>
                </div>
                <div>
                  <dt>Unlocked</dt>
                  <dd>
                    {d.unlocked.count
                      ? `${fmt(d.unlocked.count)} ${d.unlocked.count === 1 ? "sentence" : "sentences"} when it joined`
                      : "No sentences when it joined"}
                  </dd>
                </div>
                {d.holdsBack > 0 && (
                  <div>
                    <dt>Holds back</dt>
                    <dd>
                      {fmt(d.holdsBack)} {d.holdsBack === 1 ? "sentence" : "sentences"} waiting on it alone
                    </dd>
                  </div>
                )}
              </dl>
              {d.compounds.length > 0 && <WordChips label={`Deck words with ${word} in them`} words={d.compounds} onOpen={onOpenWord} />}
              {d.sameMeaning.length > 0 && <WordChips label="Deck words with the same meaning" words={d.sameMeaning} onOpen={onOpenWord} />}
            </section>

            {/* Its English shared with other words of yours, each opening the group side by side (Synonyms.tsx). */}
            <SameEnglish word={word} />

            {!canWrite && <p className="cf-muted cf-sheet-aside">This is Benji&apos;s deck, shown read-only.</p>}
            {canWrite && d.suspended && (
              <section className="cf-sheet-suspended">
                <p>Suspended: its cards and their history are kept, but nothing deals them, and the sentences that need it are locked.</p>
                <button className="cf-btn" disabled={bringing} onClick={() => void bringBack()}>
                  {bringing ? "Bringing it back…" : "Bring back into review"}
                </button>
              </section>
            )}
            {canWrite && d.status === "deck" && (
              <section className="cf-sheet-remove">
                {removing === "ask" && (
                  <p>
                    Its {d.cards.length === 1 ? "card goes" : `${d.cards.length} cards go`}
                    {(() => {
                      const answers = d.cards.reduce((n, c) => n + c.answered, 0);
                      return answers ? `, with ${fmt(answers)} ${answers === 1 ? "answer" : "answers"}` : "";
                    })()}
                    . Sentences that need it lock again (up to {fmt(d.sentences.readable)}). This can&apos;t be undone.
                  </p>
                )}
                <div className="cf-buttons">
                  {removing === "ask" && (
                    <button className="cf-btn cf-btn-ghost" onClick={() => setRemoving(null)}>
                      Keep it
                    </button>
                  )}
                  <button
                    className={`cf-btn ${removing ? "cf-btn-danger" : "cf-btn-quiet"}`}
                    disabled={removing === "busy"}
                    onClick={() => (removing === "ask" ? void remove() : setRemoving("ask"))}
                  >
                    {removing === "busy" ? "Removing…" : removing === "ask" ? `Remove ${word}` : "Remove from deck"}
                  </button>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

type Standing = WordPageSentence["status"];
/** Sentences a panel shows at first, and how many more each tap shows. */
const SENTENCES_FIRST = 5;
const SENTENCES_MORE = 10;
/** Tripped sentences shown at first. */
const TRIPPED_FIRST = 3;
const STANDINGS: Array<{ key: Standing; label: string; count: "readable" | "oneAway" | "locked" }> = [
  { key: "readable", label: "Readable", count: "readable" },
  { key: "oneAway", label: "One away", count: "oneAway" },
  { key: "locked", label: "Locked", count: "locked" },
];

/** Where an addition came from, as the owner would say it. */
function sourceName(source: string): string {
  if (source.startsWith("list:")) return `Added from the list ${source.slice(5)}`;
  if (source.startsWith("lookup:")) return `Added from Look up (“${source.slice(7)}”)`;
  if (source.startsWith("text:")) return `Added from the text ${source.slice(5)}`;
  if (source === "longku") return "Added in 龙库";
  if (source === "page") return "Added from its word page";
  if (source.startsWith("anki")) return "Added from Pleco, through AnkiDroid";
  return `Added (${source})`;
}

/** A few deck words, each opening its own page. */
function WordChips({ label, words, onOpen }: { label: string; words: string[]; onOpen?: (w: string) => void }) {
  return (
    <div className="cf-wp-chips">
      <p className="cf-muted">{label}</p>
      <div>
        {words.map((w) =>
          onOpen ? (
            <button key={w} className="cf-wp-chip cf-zh" onClick={() => onOpen(w)}>
              {w}
            </button>
          ) : (
            <span key={w} className="cf-wp-chip cf-zh">
              {w}
            </span>
          ),
        )}
      </div>
    </div>
  );
}

/** Answers taken into each point: the last ten. */
const WINDOW = 10;
const CHART_W = 320;
const CHART_H = 132;
const PAD = { l: 30, r: 54, t: 10, b: 22 };

/**
 * How often each word card has been got: for every answer, the share of Got
 * it among the last ten, one line per card (Read in Read's blue, Recall in
 * Recall's violet), a dot per answer (filled for got it, a ring for forgot,
 * as the bubbles draw them), over time. Pleco's record has no dates, so it
 * isn't on it. Split-off meanings are left out: their few answers would be
 * noise beside the word's own.
 */
function GotItChart({ answers }: { answers: WordPage["answers"] }) {
  const series = (["read", "produce"] as const)
    .map((kind) => {
      const own = answers.filter((a) => a.kind === kind && a.meaning === null);
      return {
        kind,
        points: own.map((a, i) => {
          const last = own.slice(Math.max(0, i - WINDOW + 1), i + 1);
          return { at: a.at, grade: a.grade, rate: last.filter((x) => x.grade === "good").length / last.length, n: last.length };
        }),
      };
    })
    .filter((s) => s.points.length > 0);
  const all = series.flatMap((s) => s.points);
  if (all.length < 2) {
    return <p className="cf-muted cf-wp-chart-empty">The chart starts once its cards have been answered here a couple of times.</p>;
  }
  const t0 = Math.min(...all.map((p) => p.at));
  const t1 = Math.max(...all.map((p) => p.at));
  const x = (at: number) => PAD.l + (t1 === t0 ? 0.5 : (at - t0) / (t1 - t0)) * (CHART_W - PAD.l - PAD.r);
  const y = (rate: number) => PAD.t + (1 - rate) * (CHART_H - PAD.t - PAD.b);
  const name = { read: "Read", produce: "Recall" } as const;
  const day = (at: number) => new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return (
    <figure className="cf-wp-chart">
      <figcaption>Got it, of the last {WINDOW} answers</figcaption>
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} role="img" aria-label="How often each card has been got, over time">
        {[0, 0.5, 1].map((r) => (
          <g key={r}>
            <line className="cf-wp-grid" x1={PAD.l} x2={CHART_W - PAD.r} y1={y(r)} y2={y(r)} />
            <text className="cf-wp-axis" x={PAD.l - 6} y={y(r) + 3.5} textAnchor="end">
              {Math.round(r * 100)}%
            </text>
          </g>
        ))}
        <text className="cf-wp-axis" x={PAD.l} y={CHART_H - 6}>
          {day(t0)}
        </text>
        <text className="cf-wp-axis" x={CHART_W - PAD.r} y={CHART_H - 6} textAnchor="end">
          {day(t1)}
        </text>
        {series.map((s) => (
          <g key={s.kind} className={`cf-wp-series is-${s.kind}`}>
            <polyline points={s.points.map((p) => `${x(p.at)},${y(p.rate)}`).join(" ")} />
            {s.points.map((p, i) => (
              <circle key={i} className={p.grade === "good" ? "is-good" : "is-forgot"} cx={x(p.at)} cy={y(p.rate)} r={3.6}>
                <title>
                  {`${name[s.kind]} · ${day(p.at)} · ${p.grade === "good" ? "Got it" : "Forgot"} · ${Math.round(p.rate * 100)}% of the last ${p.n}`}
                </title>
              </circle>
            ))}
            {/* Named at its end, so the line needn't be matched to a key by colour alone. */}
            <text
              className="cf-wp-label"
              x={x(s.points[s.points.length - 1].at) + 7}
              y={y(s.points[s.points.length - 1].rate) + (s.kind === "produce" ? 11 : -4)}
            >
              {name[s.kind]} {Math.round(s.points[s.points.length - 1].rate * 100)}%
            </text>
          </g>
        ))}
      </svg>
      {series.length > 1 && (
        <p className="cf-wp-legend">
          {series.map((s) => (
            <span key={s.kind} className={`is-${s.kind}`}>
              <i /> {name[s.kind]} · {fmt(s.points.length)} answers
            </span>
          ))}
        </p>
      )}
    </figure>
  );
}

/** Back closes an open word's page; a bug filed meanwhile says which word. */
function BackFromPage({ word, onBack }: { word: string | null; onBack: () => void }) {
  useBackLayer(word !== null, onBack);
  useEffect(() => (word ? bugs.note("wordSheet", word) : undefined), [word]);
  return null;
}

/**
 * The word page, over everything, wherever it was opened from (lib/wordpage.ts):
 * the shell draws this once. Its word is in the address, so a reload comes back to it.
 */
export function WordPageHost({ canWrite }: { canWrite: boolean }) {
  const word = useSyncExternalStore(wordpage.subscribe, wordpage.openWord, () => null);
  // Opened by the address on a reload; kept there while open.
  useEffect(() => {
    const w = routeParam("word");
    if (w) wordpage.openWordPage(w);
  }, []);
  useRouteParam("word", word);
  const find = wordpage.sentencesFinder();
  return (
    <>
      <BackFromPage word={word} onBack={wordpage.closeWordPage} />
      {word && (
        <WordSheet
          key={word}
          word={word}
          canWrite={canWrite}
          onClose={wordpage.closeWordPage}
          onRemoved={(w) => {
            wordpage.closeWordPage();
            wordpage.changed({ word: w, change: "removed" });
          }}
          onBack={(w) => wordpage.changed({ word: w, change: "resumed" })}
          onAdded={(w) => wordpage.changed({ word: w, change: "added" })}
          onFindSentences={
            find
              ? (w) => {
                  wordpage.closeWordPage();
                  find(w);
                }
              : undefined
          }
          onOpenWord={wordpage.openWordPage}
        />
      )}
    </>
  );
}
