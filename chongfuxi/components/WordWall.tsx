"use client";

// Every word in the deck as a tile, shaded by how strong its Read card is,
// with a dot on the ones due today. Grouped by when they're due, how strong
// they are, their HSK level, or the trouble they've given; found by word,
// pinyin or meaning. A tile opens the word's sheet: its cards and how they
// stand, Pleco's record, and the sentences it is in.

import { useEffect, useMemo, useState } from "react";
import type { Coverage, WordDetail, WordTile } from "@chongfuxi/lib/api";
import * as bugs from "@chongfuxi/lib/bugs";
import { get, send, today } from "@chongfuxi/lib/client";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import { mainSenses } from "@chongfuxi/lib/senses";
import { Highlighted, History, LongkuTag, fmt, message, plecoHref, span, useBackLayer } from "./shared";

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

type GroupBy = "due" | "strength" | "hsk" | "trouble";
const GROUPINGS: Array<{ key: GroupBy; label: string }> = [
  { key: "due", label: "When due" },
  { key: "strength", label: "Strength" },
  { key: "hsk", label: "HSK" },
  { key: "trouble", label: "Trouble" },
];

interface Group {
  key: string;
  label: string;
  words: WordTile[];
  /** An HSK level: its number ("7-9"), for the textbook colour and the badge. */
  level?: string;
  /** A heading above this group, where a new list of groups begins. */
  heading?: string;
  /** For an HSK level: how many words the level has in all, in the deck or not. */
  total?: number;
}

/** HSK list sizes by scheme and level ("v3:7-9"), from the coverage the Stats page shows. */
type Totals = Map<string, number>;

function groupWords(words: WordTile[], by: GroupBy, cutoff: number, totals: Totals): Group[] {
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
  if (by === "hsk") {
    // Old HSK first, then 3.0: a word sits in one level of each.
    const schemes = [
      { key: "old", heading: "HSK (old)", levels: ["1", "2", "3", "4", "5", "6"], of: (w: WordTile) => w.hsk.old },
      { key: "v3", heading: "HSK 3.0", levels: ["1", "2", "3", "4", "5", "6", "7-9"], of: (w: WordTile) => w.hsk.v3 },
    ];
    return schemes.flatMap((sc) => {
      const groups: Group[] = [
        ...sc.levels.map((l) => ({
          key: `${sc.key}-${l}`,
          label: `Level ${l.replace("-", "–")}`,
          level: l,
          total: totals.get(`${sc.key}:${l}`),
          words: words.filter((w) => sc.of(w) === l).sort(strongest),
        })),
        { key: `${sc.key}-none`, label: "Not on this list", words: words.filter((w) => sc.of(w) === null).sort(strongest) },
      ].filter((g) => g.words.length > 0);
      if (groups[0]) groups[0].heading = sc.heading;
      return groups;
    });
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
  const [open, setOpen] = useState<string | null>(null);
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
  // How big each HSK level is, so its bar can show what isn't in the deck yet.
  const [totals, setTotals] = useState<Totals>(new Map());
  useEffect(() => {
    if (by !== "hsk" || totals.size) return;
    get<Coverage>("levels")
      .then((c) => {
        const scheme = (label: string) => (label.includes("3.0") ? "v3" : "old");
        setTotals(
          new Map(
            c.groups.flatMap((g) =>
              g.levels.map((l): [string, number] => [`${scheme(g.label)}:${l.name.match(/\d+(-\d+)?/)?.[0]}`, l.total]),
            ),
          ),
        );
      })
      .catch(() => {
        // Without the sizes the bars show the deck's words alone.
      });
  }, [by, totals.size]);
  const groups = useMemo(() => groupWords(found, by, cutoff, totals), [found, by, cutoff, totals]);

  if (error) return <p className="cf-error">{error}</p>;
  if (!words) return <p className="cf-muted cf-pad">Laying out the words…</p>;

  const counts = Object.fromEntries(STAGES.map((s) => [s.key, words.filter((w) => stageOf(w) === s.key).length])) as Record<
    Stage,
    number
  >;
  const dueToday = words.filter((w) => w.due <= cutoff).length;

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
            {g.heading && <h3 className="cf-wall-scheme">{g.heading}</h3>}
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
              {g.level && (
                <span className={`cf-wall-pill cf-level is-l${g.level.split("-")[0]}`}>{g.level.replace("-", "–")}</span>
              )}
              <span className="cf-wall-label">{g.label}</span>
              {/* The group's own mix of strengths, small; in an HSK level, in its textbook colour. */}
              <span className={`cf-wall-mix${g.level ? ` cf-level is-l${g.level.split("-")[0]}` : ""}`} aria-hidden="true">
                {/* Out of the whole level where its size is known: what's left over is words not in the deck. */}
                {mix.map((m) =>
                  m.n ? (
                    <i
                      key={m.key}
                      className={`is-${m.key}`}
                      style={g.total ? { flex: `0 0 ${(100 * m.n) / g.total}%` } : { flexGrow: m.n }}
                    />
                  ) : null,
                )}
              </span>
              <b>
                {fmt(g.words.length)}
                {g.total !== undefined && <small> of {fmt(g.total)}</small>}
              </b>
            </button>
            {isOpen && (
              <>
                <ul className="cf-tiles-grid">
                  {shown.map((w) => {
                    const stage = stageOf(w);
                    // Grouped by when due, the group says it; elsewhere a dot does.
                    const due = by !== "due" && w.due <= cutoff;
                    return (
                      <li key={w.word}>
                        <button
                          className={`cf-tile-word is-${stage}${due ? " is-due" : ""}`}
                          style={{ "--n": Math.min(Math.max([...w.word].length, 2), 5) } as React.CSSProperties}
                          onClick={() => setOpen(w.word)}
                          aria-label={`${w.word}: ${stage}${due ? ", due today" : ""}`}
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

      <BackToWall open={open !== null} word={open} onBack={() => setOpen(null)} />
      {open && (
        <WordSheet
          word={open}
          canWrite={canWrite}
          onClose={() => setOpen(null)}
          onRemoved={(w) => {
            setOpen(null);
            setWords((list) => list?.filter((x) => x.word !== w) ?? null);
          }}
          onFindSentences={(w) => {
            setOpen(null);
            onFindSentences(w);
          }}
        />
      )}
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

/** One word in full, over the page. Also opened from a sentence's page (SentencesPanel). */
export function WordSheet({
  word,
  canWrite,
  onClose,
  onRemoved,
  onFindSentences,
}: {
  word: string;
  canWrite: boolean;
  onClose: () => void;
  onRemoved: (word: string) => void;
  onFindSentences: (word: string) => void;
}) {
  const [d, setD] = useState<WordDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Removing it from the deck: asked once, then done.
  const [removing, setRemoving] = useState<"ask" | "busy" | null>(null);

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

  useEffect(() => {
    get<WordDetail>("word", { w: word })
      .then(setD)
      .catch((e) => setError(message(e)));
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [word, onClose]);

  const cutoff = today().cutoff;
  const senses = d ? mainSenses(d.defs, d.pinyin, { n: 4 }) : [];

  return (
    <div className="cf-sheet-back" onClick={onClose}>
      <div className="cf-sheet" role="dialog" aria-modal="true" aria-label={word} onClick={(e) => e.stopPropagation()}>
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
              <a className="cf-link" href={plecoHref(word)}>
                Open in Pleco
              </a>
            </p>
          )}
        </header>

        {error && <p className="cf-error">{error}</p>}
        {!d && !error && <p className="cf-muted">Looking it up…</p>}

        {d && (
          <>
            {senses.length > 0 ? (
              <ul className="cf-sheet-senses">
                {senses.slice(0, 4).map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            ) : (
              <p className="cf-muted">No definition on file.</p>
            )}

            {d.cards.map((c, i) => (
              <section key={i} className={`cf-sheet-card is-${c.kind}`}>
                <h3>
                  <i className="cf-dot" />
                  {c.meaning ? `Meaning: ${c.meaning}` : KIND[c.kind]}
                  {c.isNew && <span className="cf-tag">new</span>}
                </h3>
                <div
                  className="cf-meter"
                  style={{ "--from": "0%", "--to": `${onMeter(c.stability) * 100}%` } as React.CSSProperties}
                >
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
              <p className="cf-muted cf-sheet-aside">
                No Recall card yet: it opens the first time you get the Read card right here.
              </p>
            )}

            {d.pleco && (
              <section className="cf-sheet-pleco">
                <h3>In Pleco, before</h3>
                <p>
                  Score <b>{fmt(d.pleco.score)}</b>, right <b>{fmt(d.pleco.correct)}</b>, wrong <b>{fmt(d.pleco.incorrect)}</b>
                  {d.pleco.first && (
                    <>
                      , studied since {new Date(d.pleco.first).toLocaleDateString(undefined, { month: "short", year: "numeric" })}
                    </>
                  )}
                  .
                </p>
              </section>
            )}

            <section className="cf-sheet-sentences">
              <h3>Sentences</h3>
              <p className="cf-sheet-counts">
                <span>
                  <b>{fmt(d.sentences.readable)}</b> readable
                </span>
                <span>
                  <b>{fmt(d.sentences.oneAway)}</b> one word away
                </span>
                <span>
                  <b>{fmt(d.sentences.locked)}</b> locked
                </span>
                <span>
                  read in context <b>{fmt(d.exposures)}</b> {d.exposures === 1 ? "time" : "times"}
                </span>
              </p>
              <ul className="cf-sheet-best">
                {d.sentences.best.map((s) => (
                  <li key={s.id}>
                    <p className="cf-zh">
                      <Highlighted text={s.zh} word={word} />
                    </p>
                    {s.en && <p className="cf-en">{s.en}</p>}
                  </li>
                ))}
              </ul>
              {d.sentences.readable + d.sentences.oneAway + d.sentences.locked > 0 && (
                <button className="cf-btn cf-btn-ghost" onClick={() => onFindSentences(word)}>
                  All sentences with {word}
                </button>
              )}
            </section>
            {!canWrite && <p className="cf-muted cf-sheet-aside">This is Benji&apos;s deck, shown read-only.</p>}
            {canWrite && (
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

/** Back closes an open word's sheet; a bug filed meanwhile says which word. */
function BackToWall({ open, word, onBack }: { open: boolean; word: string | null; onBack: () => void }) {
  useBackLayer(open, onBack);
  useEffect(() => (word ? bugs.note("wordSheet", word) : undefined), [word]);
  return null;
}
