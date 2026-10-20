"use client";

// Every sentence, by how close it is to readable, shortest first: Readable,
// One away (with the words that would unlock the most along the top) and
// Locked. Typing a word finds every sentence with it in, whatever the choice.
// A source (a deck, a book's lessons) narrows all of it. Each row is the
// sentence, its translation and one quiet line; a tap opens the sentence's
// page: its words with pinyin, each tappable, and its card.

import { useEffect, useState } from "react";
import { routeParam, useRouteParam } from "@chongfuxi/lib/route";
import type { Blocker, SentenceDetail, SentenceRow, SourceCounts } from "@chongfuxi/lib/api";
import { get } from "@chongfuxi/lib/client";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import { BlockerSheet, UnlockPage, type Blockers } from "./UnlockPanel";
import { WordSheet } from "./WordWall";
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
    get<{ sources: SourceCounts[] }>("sources")
      .then((r) => setSources(r.sources))
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
        <Sheet label="Sources" onClose={() => setPicking(false)}>
          <h2 className="cf-sheet-title">Sources</h2>
          <p className="cf-muted">Show the sentences from one of them.</p>
          <ul className="cf-opts">
            {[{ source: "", n: (shell.summary?.sentences ?? 0) }, ...sources.map((x) => ({ source: x.source, n: x.readable + x.oneAway + x.locked }))].map(
              (x) => (
                <li key={x.source}>
                  <button
                    className={`cf-opt${source === x.source ? " is-on" : ""}`}
                    aria-pressed={source === x.source}
                    onClick={() => {
                      setSource(x.source);
                      setPicking(false);
                    }}
                  >
                    <i className="cf-opt-tick" aria-hidden="true" />
                    <span className="cf-opt-name">{x.source || "Every source"}</span>
                    <span className="cf-opt-n">{fmt(x.n)}</span>
                  </button>
                </li>
              ),
            )}
          </ul>
        </Sheet>
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
  const [wordOpen, setWordOpen] = useState<string | null>(null);

  useEffect(() => {
    get<SentenceDetail>("sentence", { id })
      .then(setD)
      .catch((e) => setError(message(e)));
  }, [id]);

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
      <Sheet label="Sentence" onClose={onClose} escape={wordOpen === null}>
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
                  {pw.inDeck && <button onClick={() => setWordOpen(pickedWord)}>Open word</button>}
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
      {wordOpen && (
        <>
          <BackStep onBack={() => setWordOpen(null)} />
          <WordSheet
            word={wordOpen}
            canWrite={shell.canWrite}
            onClose={() => setWordOpen(null)}
            onRemoved={() => {
              setWordOpen(null);
              onChanged();
            }}
            onFindSentences={(w) => {
              setWordOpen(null);
              onFind(w);
            }}
            onOpenWord={setWordOpen}
          />
        </>
      )}
    </>
  );
}
