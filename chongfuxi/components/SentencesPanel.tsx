"use client";

// Every sentence, by how close it is to readable, shortest first: Readable,
// One away (with the words that would unlock the most along the top) and
// Locked. Typing a word finds every sentence with it in, whatever the choice.
// A source (a deck, a book's lessons) narrows all of it. Each row is the
// sentence, its translation and one quiet line; a tap opens the sentence's
// page: its words with pinyin, each tappable, and its card.

import { useEffect, useState, useSyncExternalStore } from "react";
import { routeParam, useRouteParam } from "@chongfuxi/lib/route";
import { SplitEditor } from "./SplitEditor";
import type { Blocker, SentenceDetail, SentenceRow, SourceAction, SourceCounts } from "@chongfuxi/lib/api";
import { get, send } from "@chongfuxi/lib/client";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import { BlockerSheet, UnlockPage, type Blockers } from "./UnlockPanel";
import * as wordpage from "@chongfuxi/lib/wordpage";
import { Loading, AiPill, BackStep, History, PlecoTile, Sheet, fmt, message, piecesOf, useBackLayer, type Piece, type Shell } from "./shared";

type Show = "readable" | "one" | "locked";
const PAGE = 40;
/** Words in the strip at the top of One away. */
const STRIP = 6;

/** 9,120 as 9.1k, for the chips. */
const short = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n));

/** Where a sentence stands, as a dot and a word or two. */
function standing(card: SentenceRow["card"], blockers: number): { key: string; label: string } {
  if (card === "reading") return { key: "review", label: "In review" };
  if (card === "new") return { key: "new", label: "Not started" };
  if (card === "retired") return { key: "retired", label: "Retired" };
  if (blockers === 0) return { key: "review", label: "Readable" };
  return { key: "locked", label: blockers === 1 ? "One word away" : `${blockers} words away` };
}

/** The sentence with its blocking words marked, and the word searched for. */
function Marked({ zh, blockers, hit }: { zh: string; blockers: string[]; hit: string }) {
  const spans: Array<{ from: number; to: number; cls: string }> = [];
  const add = (w: string, cls: string) => {
    for (let at = w ? zh.indexOf(w) : -1; at >= 0; at = zh.indexOf(w, at + w.length)) {
      if (!spans.some((s) => at < s.to && at + w.length > s.from)) spans.push({ from: at, to: at + w.length, cls });
    }
  };
  add(hit, "cf-mark");
  blockers.forEach((b) => add(b, "cf-block"));
  spans.sort((a, b) => a.from - b.from);
  const out: React.ReactNode[] = [];
  let at = 0;
  for (const s of spans) {
    if (s.from > at) out.push(zh.slice(at, s.from));
    out.push(
      <mark key={s.from} className={s.cls}>
        {zh.slice(s.from, s.to)}
      </mark>,
    );
    at = s.to;
  }
  if (at < zh.length) out.push(zh.slice(at));
  return <>{out}</>;
}

export function SentencesPanel({ shell, find }: { shell: Shell; find?: { word: string; at: number } | null }) {
  const [show, setShow] = useState<Show>("readable");
  const [rows, setRows] = useState<SentenceRow[]>([]);
  const [more, setMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A word to find, as typed; and the one being shown, once typing pauses.
  const [typed, setTyped] = useState(find?.word ?? "");
  const [word, setWord] = useState(find?.word ?? "");
  const [within, setWithin] = useState(false);
  // Every source, with its counts; the one picked, if any; and the sheet to pick one.
  const [sources, setSources] = useState<SourceCounts[] | null>(null);
  // The latest suspend-alls, to undo.
  const [actions, setActions] = useState<SourceAction[]>([]);
  const [source, setSource] = useState("");
  const [picking, setPicking] = useState(false);
  // What stands in the way: the strip on One away, and the Unlock next page.
  const [blockers, setBlockers] = useState<Blockers | null>(null);
  const [unlockPage, setUnlockPage] = useState(false);
  const [blocker, setBlocker] = useState<Blocker | null>(null);
  // The sentence open on its page, in the address (lib/route.ts).
  const [open, setOpen] = useState<number | null>(() => Number(routeParam("sentence")) || null);
  useRouteParam("sentence", open === null ? null : String(open));
  // Bumped when something changed what is shown (a name marked, a word removed).
  const [changed, setChanged] = useState(0);

  // Sent here from a word's sheet: search for that word.
  useEffect(() => {
    if (!find) return;
    setTyped(find.word);
    setWord(find.word);
    setUnlockPage(false);
  }, [find]);

  useEffect(() => {
    get<{ sources: SourceCounts[]; actions?: SourceAction[] }>("sources")
      .then((r) => {
        setSources(r.sources);
        setActions(r.actions ?? []);
      })
      .catch(() => setSources([]));
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setWord(typed.trim()), 300);
    return () => window.clearTimeout(t);
  }, [typed]);

  // The blocking words, once One away or the Unlock page is first shown, and after a change.
  const wantBlockers = show === "one" || unlockPage;
  useEffect(() => {
    if (!wantBlockers) return;
    get<Blockers>("blockers")
      .then(setBlockers)
      .catch(() => setBlockers({ learnNext: [], others: [], names: [] }));
  }, [wantBlockers, changed]);

  const load = (offset: number) => {
    setLoading(true);
    get<{ sentences: SentenceRow[] }>("sentences", {
      show,
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
  useEffect(() => load(0), [show, word, within, source, changed]); // eslint-disable-line react-hooks/exhaustive-deps

  // Back from the Unlock page comes to the sentences.
  useBackLayer(unlockPage, () => setUnlockPage(false));

  const afterChange = () => {
    shell.refresh();
    setChanged((n) => n + 1);
  };

  // The counts are the picked source's, or the whole corpus's.
  const picked = sources?.find((x) => x.source === source) ?? null;
  const counts = picked ?? shell.summary;
  const chips: Array<{ key: Show; label: string; n: number | null }> = [
    { key: "readable", label: "Readable", n: counts?.readable ?? null },
    { key: "one", label: "One away", n: counts?.oneAway ?? null },
    { key: "locked", label: "Locked", n: counts?.locked ?? null },
  ];
  const finding = word.length > 0;
  const strip = blockers ? (blockers.learnNext.length ? blockers.learnNext : blockers.others).slice(0, STRIP) : [];

  const sheets = (
    <>
      {open !== null && (
        <SentenceSheet
          id={open}
          shell={shell}
          onClose={() => setOpen(null)}
          onFind={(w) => {
            setOpen(null);
            setTyped(w);
            setWord(w);
            window.scrollTo({ top: 0 });
          }}
          onChanged={() => {
            setOpen(null);
            afterChange();
          }}
        />
      )}
      {blocker && (
        <BlockerSheet
          blocker={blocker}
          shell={shell}
          onClose={() => setBlocker(null)}
          onChanged={() => {
            setBlocker(null);
            afterChange();
          }}
        />
      )}
      {picking && sources && (
        <SourcesSheet
          sources={sources}
          actions={actions}
          source={source}
          total={shell.summary?.sentences ?? 0}
          canWrite={shell.canWrite}
          onPick={(x) => {
            setSource(x);
            setPicking(false);
          }}
          onChanged={() => {
            get<{ sources: SourceCounts[]; actions?: SourceAction[] }>("sources")
              .then((r) => {
                setSources(r.sources);
                setActions(r.actions ?? []);
              })
              .catch(() => undefined);
            afterChange();
          }}
          onRenamed={(from, to) => setSource((x) => (x === from ? to : x))}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );

  if (unlockPage) {
    return (
      <>
        <UnlockPage shell={shell} data={blockers} onBack={() => setUnlockPage(false)} onOpen={setBlocker} onChanged={afterChange} />
        {sheets}
      </>
    );
  }

  return (
    <div className="cf-sents">
      <div className="cf-sfind">
        <label className="cf-sfind-box">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            enterKeyHint="search"
            placeholder="Find a word: 人, 问题…"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            aria-label="Find sentences with a word"
          />
        </label>
        {sources && sources.length > 1 && (
          <button
            className={`cf-iconbtn${source ? " is-on" : ""}`}
            onClick={() => setPicking(true)}
            aria-label={source ? `Source: ${source}` : "Pick a source"}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="M4 6h16M7 12h10M10 18h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {!finding && (
        <div className="cf-chips" role="tablist">
          {chips.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={show === t.key}
              className={`cf-chip${show === t.key ? " is-on" : ""}`}
              onClick={() => setShow(t.key)}
            >
              {t.label}
              {t.n !== null && <small>{short(t.n)}</small>}
            </button>
          ))}
        </div>
      )}

      {(source || finding) && (
        <div className="cf-applied">
          {source && (
            <button className="cf-pill" onClick={() => setSource("")} aria-label={`Showing ${source} only; show every source`}>
              <span>{source}</span>
              <i aria-hidden="true">×</i>
            </button>
          )}
          {finding && (
            <button className={`cf-pill is-toggle${within ? " is-on" : ""}`} aria-pressed={within} onClick={() => setWithin(!within)}>
              Inside longer words too
            </button>
          )}
        </div>
      )}

      {!finding && show === "one" && strip.length > 0 && (
        <section className="cf-ustrip" aria-label="Unlock next">
          <div className="cf-ustrip-head">
            <p>Learn these to unlock the most</p>
            <button
              onClick={() => {
                setUnlockPage(true);
                window.scrollTo({ top: 0 });
              }}
            >
              See all ›
            </button>
          </div>
          <div className="cf-ustrip-row">
            {strip.map((b) => (
              <button key={b.word} className="cf-uword" onClick={() => setBlocker(b)}>
                <b>{b.word}</b>
                <span>{b.pinyin ? displayPinyin(b.pinyin) : " "}</span>
                <em>+{fmt(b.unlocks)}</em>
              </button>
            ))}
          </div>
        </section>
      )}

      <p className="cf-scount">{finding ? `Sentences with ${word}` : "Shortest first"}</p>

      {error && <p className="cf-error">{error}</p>}
      {!loading && rows.length === 0 && !error && (
        <p className="cf-muted cf-pad">
          {finding
            ? within
              ? `No sentence has ${word} in it.`
              : `No sentence has ${word} as a word of its own. Try inside longer words.`
            : "No sentences here."}
        </p>
      )}
      {rows.length > 0 && (
        <ul className="cf-slist">
          {rows.map((r) => {
            const st = standing(r.card, r.blockers.length);
            return (
              <li key={r.id}>
                <button className="cf-srow" onClick={() => setOpen(r.id)}>
                  <span className="cf-srow-zh">
                    <Marked zh={r.zh} blockers={r.blockers} hit={finding ? word : ""} />
                  </span>
                  {r.en && <span className="cf-srow-en">{r.en}</span>}
                  <span className="cf-smeta">
                    <i className={`cf-sdot is-${st.key}`} aria-hidden="true" />
                    <span>{st.label}</span>
                    {r.sources.length > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="cf-smeta-src">{r.sources.join(", ")}</span>
                      </>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {loading && <Loading label="Finding sentences…" />}
      {!loading && more && rows.length > 0 && (
        <button className="cf-more" onClick={() => load(rows.length)}>
          Show more
        </button>
      )}
      {sheets}
    </div>
  );
}

/** How a word of the sentence stands, in a few words. */
const STANDING = {
  known: "Known",
  learning: "In your deck · still being learnt",
  unknown: "Not known yet · keeping this sentence locked",
} as const;

/**
 * One sentence in full: its words with pinyin over them, each tappable for
 * its meaning and where it stands (a deck word opens its own sheet), the
 * translation, its card's history, and where it came from.
 */
function SentenceSheet({
  id,
  shell,
  onClose,
  onFind,
  onChanged,
}: {
  id: number;
  shell: Shell;
  onClose: () => void;
  onFind: (word: string) => void;
  onChanged: () => void;
}) {
  const [d, setD] = useState<SentenceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [resuming, setResuming] = useState(false);
  // A sentence card put out of review by hand, brought back from here.
  const bringBack = async () => {
    setResuming(true);
    try {
      await send("sentence", { id, action: "resume" });
      setD((x) => (x?.card ? { ...x, card: { ...x.card, suspended: false } } : x));
      onChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setResuming(false);
    }
  };
  // Escape closes a word page opened over this one before this one.
  const wordUp = useSyncExternalStore(wordpage.subscribe, wordpage.openWord, () => null) !== null;
  // A word removed or added from its page (opened over this one) changes what this sentence needs.
  useEffect(() => wordpage.onChange(({ change }) => change !== "resumed" && onChanged()), [onChanged]);

  // Loaded again after its words are split anew (SplitEditor), as their standings change.
  const [loads, setLoads] = useState(0);
  useEffect(() => {
    get<SentenceDetail>("sentence", { id })
      .then(setD)
      .catch((e) => setError(message(e)));
  }, [id, loads]);

  const pieces = d ? piecesOf(d.sentence) : [];
  const groups: Piece[][] = [];
  for (const b of pieces) {
    if (b.word === null && groups.length) groups[groups.length - 1].push(b);
    else groups.push([b]);
  }
  const st = d ? standing(d.card?.state ?? null, d.blockers.length) : null;
  const look = d && picked !== null ? d.sentence.looks?.[picked] : null;
  const pw = d && picked !== null ? d.words[picked] : null;
  const pickedWord = d && picked !== null ? d.sentence.words[picked] : null;

  return (
    <>
      <Sheet label="Sentence" onClose={onClose} escape={!wordUp}>
        {error && <p className="cf-error">{error}</p>}
        {!d && !error && <Loading small label="Opening it…" />}
        {d && st && (
          <>
            <p className="cf-sstate">
              <i className={`cf-sdot is-${st.key}`} aria-hidden="true" />
              {st.label}
            </p>
            <p className="cf-ruby" lang="zh">
              {/* Each word with what follows it up to the next (punctuation), so a full stop never wraps alone. */}
              {groups.map((g) => (
                <span key={g[0].at} className="cf-rgroup">
                  {g.map((b) => {
                    const i = b.word;
                    const w = i === null ? null : d.words[i];
                    if (i === null || !w) {
                      return (
                        <span key={b.at} className="cf-rseg is-plain">
                          <span />
                          <b>{b.zh}</b>
                        </span>
                      );
                    }
                    const p = d.sentence.looks?.[i]?.p;
                    return (
                      <button
                        key={b.at}
                        className={`cf-rseg is-${w.standing}${picked === i ? " is-on" : ""}`}
                        aria-pressed={picked === i}
                        onClick={() => setPicked(picked === i ? null : i)}
                      >
                        <span>{p ? displayPinyin(p) : " "}</span>
                        <b>{b.zh}</b>
                      </button>
                    );
                  })}
                </span>
              ))}
            </p>
            {d.sentence.en && <p className="cf-sheet-en">{d.sentence.en}</p>}
            {shell.canWrite && (
              <SplitEditor
                sentence={d.sentence}
                onSaved={() => {
                  setPicked(null);
                  setLoads((n) => n + 1);
                }}
              />
            )}

            {pickedWord && pw && (
              <div className="cf-wordcard">
                <p className="cf-wordcard-head">
                  <b className="cf-zh">{pickedWord}</b>
                  {look?.p && <span>{displayPinyin(look.p)}</span>}
                </p>
                {look?.gloss && (
                  <p>
                    {look.gloss} <AiPill word={pickedWord} />
                  </p>
                )}
                <p className="cf-muted">{pw.inDeck || pw.standing !== "known" ? STANDING[pw.standing] : "Known: made of words you know"}</p>
                <p className="cf-wordcard-acts">
                  <button onClick={() => wordpage.openWordPage(pickedWord)}>Word page</button>
                  <PlecoTile word={pickedWord} inline />
                </p>
              </div>
            )}

            <dl className="cf-sfacts">
              {d.card ? (
                <div>
                  <dt>Card</dt>
                  <dd>
                    <History h={d.card.history} />
                    {d.card.suspended && (
                      <p className="cf-suspend-note">
                        Suspended
                        {shell.canWrite && (
                          <button className="cf-link" onClick={() => void bringBack()} disabled={resuming}>
                            {resuming ? "Bringing back…" : "Bring back"}
                          </button>
                        )}
                      </p>
                    )}
                  </dd>
                </div>
              ) : (
                d.blockers.length > 0 && (
                  <div>
                    <dt>Needs</dt>
                    <dd className="cf-zh">{d.blockers.join("、")}</dd>
                  </div>
                )
              )}
              {d.sentence.sources.length > 0 && (
                <div>
                  <dt>From</dt>
                  <dd>
                    {d.sentence.sources.map((s) => (
                      <span key={s} className="cf-sfacts-line">
                        {s}
                      </span>
                    ))}
                  </dd>
                </div>
              )}
              <div>
                <dt>Length</dt>
                <dd>
                  {fmt(d.sentence.words.length)} words · {fmt([...d.sentence.zh.replace(/[\s\p{P}]/gu, "")].length)} characters
                </dd>
              </div>
            </dl>
          </>
        )}
      </Sheet>

    </>
  );
}

/** How long ago, in a few words. */
function ago(at: number): string {
  const min = Math.round((Date.now() - at) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * The sources (decks, texts, shows), found by name, each showing its
 * sentences when picked; and for the owner, ✎ to rename one (into another
 * merges them), and every sentence of a source
 * suspended or brought back at once, a second tap to be sure, or of every
 * source the search matches (the owner: "allow me to search through all
 * sentence categories and suspend them all if I want").
 */
function SourcesSheet({
  sources,
  actions,
  source,
  total,
  canWrite,
  onPick,
  onChanged,
  onRenamed,
  onClose,
}: {
  sources: SourceCounts[];
  actions: SourceAction[];
  source: string;
  total: number;
  canWrite: boolean;
  onPick: (source: string) => void;
  onChanged: () => void;
  /** A source renamed: the one picked follows it. */
  onRenamed: (from: string, to: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  // The source being renamed, and its new name as typed.
  const [naming, setNaming] = useState<{ from: string; to: string } | null>(null);
  // The source (or "*" for every one matching) asked about, and what is being done.
  const [asking, setAsking] = useState<{ key: string; suspend: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const size = (x: SourceCounts) => x.readable + x.oneAway + x.locked;
  const needle = q.trim().toLowerCase();
  const shown = needle ? sources.filter((x) => x.source.toLowerCase().includes(needle)) : sources;
  const act = async (names: string[], suspend: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await send("sources", { sources: names, suspend });
      setAsking(null);
      onChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  /** Undo a suspend-all: only the sentences it suspended come back. */
  const undo = async (id: number) => {
    setBusy(true);
    setError(null);
    try {
      await send("sources", { undo: id });
      onChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const rename = async () => {
    if (!naming) return;
    const to = naming.to.replace(/\s+/g, " ").trim();
    if (!to || to === naming.from) return setNaming(null);
    setBusy(true);
    setError(null);
    try {
      await send("sources", { rename: naming.from, to });
      onRenamed(naming.from, to);
      setNaming(null);
      onChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  /** Suspend, then "Suspend 1,234?" to be sure; Bring back when all are suspended. */
  const Action = ({ k, names, n, suspended }: { k: string; names: string[]; n: number; suspended: number }) => {
    const suspend = suspended < n;
    if (asking?.key === k)
      return (
        <button className={`cf-link cf-src-act is-sure${asking.suspend ? " is-off" : ""}`} disabled={busy} onClick={() => void act(names, asking.suspend)}>
          {busy ? "…" : `${asking.suspend ? "Suspend" : "Bring back"} ${fmt(asking.suspend ? n - suspended : suspended)}?`}
        </button>
      );
    return (
      <button className="cf-link cf-src-act" disabled={busy} onClick={() => setAsking({ key: k, suspend })}>
        {suspend ? "Suspend" : "Bring back"}
      </button>
    );
  };
  const matchN = shown.reduce((n, x) => n + size(x), 0);
  const matchSuspended = shown.reduce((n, x) => n + x.suspended, 0);
  return (
    <Sheet label="Sources" onClose={onClose}>
      <h2 className="cf-sheet-title">Sources</h2>
      <p className="cf-muted">
        Show the sentences from one of them{canWrite ? ", or suspend a whole source: its sentence cards stop coming up until brought back" : ""}.
      </p>
      <label className="cf-src-find">
        <input type="search" placeholder={`Search ${fmt(sources.length)} sources`} value={q} onChange={(e) => (setQ(e.target.value), setAsking(null))} aria-label="Search the sources" />
      </label>
      {error && <p className="cf-error">{error}</p>}
      {/* The latest suspend-alls: Undo brings back only what each suspended, not sentences suspended before it. */}
      {canWrite && actions.length > 0 && (
        <section className="cf-src-undo">
          <p className="cf-src-undo-h">Recent suspends</p>
          <ul>
            {actions.map((a) => (
              <li key={a.id}>
                <span>
                  <b>{fmt(a.sentences)}</b> from {a.sources.length === 1 ? a.sources[0] : `${fmt(a.sources.length)} sources`}
                  <small>{ago(a.at)}</small>
                </span>
                <button className="cf-link" disabled={busy} onClick={() => void undo(a.id)}>
                  Undo
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {canWrite && needle && shown.length > 1 && (
        <p className="cf-src-all">
          <span>
            {fmt(shown.length)} sources match · {fmt(matchN)} sentences
          </span>
          <Action k="*" names={shown.map((x) => x.source)} n={matchN} suspended={matchSuspended} />
        </p>
      )}
      <ul className="cf-opts">
        {[...(needle ? [] : [{ source: "", readable: total, oneAway: 0, locked: 0, suspended: 0 }]), ...shown].map((x) =>
          naming?.from === x.source ? (
            <li key={x.source} className="cf-src-row cf-src-naming">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void rename();
                }}
              >
                <input
                  autoFocus
                  value={naming.to}
                  maxLength={80}
                  onChange={(e) => setNaming({ ...naming, to: e.target.value })}
                  aria-label={`New name for ${x.source}`}
                />
                <button type="button" className="cf-link" onClick={() => setNaming(null)} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="cf-link cf-src-save" disabled={busy || !naming.to.trim()}>
                  {busy ? "…" : "Save"}
                </button>
              </form>
              {sources.some((o) => o.source === naming.to.trim() && o.source !== x.source) && (
                <small className="cf-muted cf-src-merge">There is a {naming.to.trim()} already: the two become one.</small>
              )}
            </li>
          ) : (
          <li key={x.source} className="cf-src-row">
            <button
              className={`cf-opt${source === x.source ? " is-on" : ""}`}
              aria-pressed={source === x.source}
              onClick={() => onPick(x.source)}
            >
              <i className="cf-opt-tick" aria-hidden="true" />
              <span className="cf-opt-name">
                {x.source || "Every source"}
                {x.suspended > 0 && <small className="cf-src-susp">{x.suspended >= size(x) ? "all suspended" : `${fmt(x.suspended)} suspended`}</small>}
              </span>
              <span className="cf-opt-n">{fmt(size(x))}</span>
            </button>
            {canWrite && x.source && (
              <button className="cf-src-edit" onClick={() => (setNaming({ from: x.source, to: x.source }), setAsking(null))} aria-label={`Rename ${x.source}`}>
                <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                  <path d="M4 14.5V16h1.5l8.6-8.6-1.5-1.5L4 14.5zM15.3 6.2a1 1 0 0 0 0-1.4l-.1-.1a1 1 0 0 0-1.4 0l-.9.9 1.5 1.5.9-.9z" fill="currentColor" />
                </svg>
              </button>
            )}
            {canWrite && x.source && <Action k={x.source} names={[x.source]} n={size(x)} suspended={x.suspended} />}
          </li>
          ),
        )}
      </ul>
      {needle && !shown.length && <p className="cf-muted">No source has “{q.trim()}” in its name.</p>}
    </Sheet>
  );
}
