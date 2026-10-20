"use client";

// The Pleco word lists, browsed the way Pleco's flashcards showed them
// (HSK标准教程 › HSK标准教程5 › 第24课), and a lesson's words added to the deck
// in one go. Pleco's own flashcard screen is gone once Pleco hands its cards
// to AnkiDroid, and this is where taking a lesson at a time went.
//
// The lists came in with the Pleco backup: each word row knows the lists it
// is filed under. Adding is one addition, shown at once with Keep and Undo,
// as a sync's new words are. A list with words due can be reviewed on its own.
//
// Two sections: the study lists (龙库, the HSK lists, the textbooks), then
// lists made from the owner's own content, the first of which is Spotify:
// a song's link files the words of its lyrics as a list (spotify.ts).

import { useCallback, useEffect, useMemo, useState } from "react";
import { routeParam, useRouteParam } from "@chongfuxi/lib/route";
import type { Addition, ListNode, ListWord } from "@chongfuxi/lib/api";
import { get, send, today } from "@chongfuxi/lib/client";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import * as bugs from "@chongfuxi/lib/bugs";
import { AdditionDetails } from "./NewWords";
import type { ListReview } from "./ReviewPanel";
import { Loading, AiPill, BackStep, fmt, message, plecoHref, useBackLayer, type Shell } from "./shared";

const PAGE = 300;
/** Where songs go (spotify.ts, SPOTIFY_LIST). */
const SPOTIFY = "Spotify";
/** As the server allows (LIST_ADD_MAX). */
const ADD_MAX = 500;

const nameOf = (list: string) => list.slice(list.lastIndexOf("/") + 1);
const parentOf = (list: string) => (list.includes("/") ? list.slice(0, list.lastIndexOf("/")) : "");
/** 第9课 before 第10课, Level 2 before Level 10. */
const natural = (a: string, b: string) => a.localeCompare(b, "zh-Hans-CN", { numeric: true });

export function ListsPanel({
  shell,
  onReview,
  onLearn,
  reviewed = 0,
}: {
  shell: Shell;
  /** Review a list's due words on their own. */
  onReview?: (r: ListReview) => void;
  /** Learn a list's new words. */
  onLearn?: (list: string) => void;
  /** Counts up as each list review or Learn ends, so the counts are read again. */
  reviewed?: number;
}) {
  const { canWrite, refresh } = shell;
  const [nodes, setNodes] = useState<ListNode[] | null>(null);
  // The list open, in the address (lib/route.ts).
  const [at, setAt] = useState(() => routeParam("list") ?? "");
  useRouteParam("list", at || null);
  const [words, setWords] = useState<ListWord[] | null>(null);
  // Missing words unticked, so left out of the add; after Untick all, instead
  // the only ones ticked (the rest, loaded or not, left out).
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [only, setOnly] = useState<Set<string> | null>(null);
  const ticked = (w: string) => (only ? only.has(w) : !skip.has(w));
  const tick = (w: string, on: boolean) => {
    const flip = (s: Set<string>, add: boolean) => {
      const next = new Set(s);
      if (add) next.add(w);
      else next.delete(w);
      return next;
    };
    if (only) setOnly(flip(only, on));
    else setSkip(flip(skip, !on));
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Addition | null>(null);

  const loadTree = useCallback(() => {
    get<{ lists: ListNode[] }>("lists", today())
      .then((r) => setNodes(r.lists))
      .catch((e) => setError(message(e)));
  }, []);
  useEffect(loadTree, [loadTree, reviewed]);

  // Spotify is there to add the first song to, before it has any.
  const all = useMemo(
    () =>
      nodes && canWrite && !nodes.some((n) => n.list === SPOTIFY)
        ? [...nodes, { list: SPOTIFY, total: 0, inDeck: 0, due: 0, toLearn: 0, source: "spotify" as const }]
        : (nodes ?? []),
    [nodes, canWrite],
  );
  const byList = useMemo(() => new Map(all.map((n) => [n.list, n])), [all]);
  const children = useMemo(
    () =>
      all
        .filter((n) => parentOf(n.list) === at)
        // A linked list (龙库) first, then the rest by name.
        .sort((a, b) => Number(Boolean(b.linked)) - Number(Boolean(a.linked)) || natural(nameOf(a.list), nameOf(b.list))),
    [all, at],
  );
  // At the top: the study lists, then those made from the owner's content.
  const study = at ? children : children.filter((n) => !n.source);
  const content = at ? [] : children.filter((n) => n.source);
  const here = byList.get(at) ?? null;
  const leaf = here !== null && children.length === 0;

  // A list's own words, once it has no lists under it.
  const loadWords = useCallback(
    (offset: number) => {
      get<{ words: ListWord[] }>("lists", { list: at, offset, limit: PAGE })
        .then((r) => setWords((prev) => (offset ? [...(prev ?? []), ...r.words] : r.words)))
        .catch((e) => setError(message(e)));
    },
    [at],
  );
  useEffect(() => {
    setWords(null);
    setSkip(new Set());
    setOnly(null);
    setError(null);
    if (leaf) loadWords(0);
  }, [at, leaf, loadWords]);

  // For a bug filed now: which list is open.
  useEffect(() => bugs.note("list", at || "(all lists)"), [at]);

  const go = (list: string) => {
    setAt(list);
    window.scrollTo({ top: 0 });
  };

  const missing = here ? here.total - here.inDeck : 0;
  const toAdd = only ? only.size : missing - skip.size;

  const add = async () => {
    if (!here || toAdd <= 0) return;
    setBusy(true);
    setError(null);
    try {
      const r = await send<{ id: number | null }>("lists", only ? { list: at, only: [...only] } : { list: at, skip: [...skip] });
      if (r.id !== null) {
        const { additions } = await get<{ additions: Addition[] }>("additions", { id: r.id });
        setAdded(additions[0] ?? null);
      }
      loadTree();
      if (leaf) loadWords(0);
      setSkip(new Set());
      setOnly(null);
      refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  if (!nodes && !error) return <Loading label="Reading the lists…" />;

  return (
    <div className="cf-lists">
      {/* The phone's back goes up one level, as Pleco's did. */}
      {at
        .split("/")
        .filter(Boolean)
        .map((_, i, all) => {
          const path = all.slice(0, i + 1).join("/");
          return <BackStep key={path} onBack={() => go(parentOf(path))} />;
        })}
      {/* Where in the tree: every step back is a tap. None at the top, where the lists speak for themselves. */}
      {at && (
        <nav className="cf-crumbs" aria-label="Lists">
          <button onClick={() => go("")}>Lists</button>
          {at.split("/").map((part, i, steps) => {
            const path = steps.slice(0, i + 1).join("/");
            return (
              <span key={path}>
                <i aria-hidden="true">›</i>
                <button className={path === at ? "is-here" : ""} onClick={() => go(path)}>
                  {byList.get(path)?.song?.title ?? part}
                </button>
              </span>
            );
          })}
        </nav>
      )}

      {here && (
        <header className="cf-list-head">
          <h2 className="cf-zh">{here.song?.title ?? nameOf(at)}</h2>
          {here.song && (
            <p className="cf-list-song">
              {here.song.artist}
              {here.song.url && (
                <a className="cf-link" href={here.song.url} target="_blank" rel="noreferrer">
                  Open in Spotify
                </a>
              )}
            </p>
          )}
          {at === SPOTIFY && (
            <p className="cf-list-about">Songs you listen to, as word lists: paste a song&apos;s Spotify link and the words of its lyrics become a list here.</p>
          )}
          {at === SPOTIFY && canWrite && (
            <AddSong
              onAdded={(list) => {
                loadTree();
                go(list);
              }}
            />
          )}
          {here.linked === "longku" && (
            <p className="cf-list-about">
              The chengyu <a className="cf-link" href="/longku">龙库</a> plays, kept in step with it: every chengyu in your deck is here unless
              you removed it in 龙库, and a chengyu added in 龙库 joins the deck. 龙库 keeps its own practice schedule.
            </p>
          )}
          {here.total > 0 && (
            <>
              <p className="cf-muted">
                {fmt(here.inDeck)} of {fmt(here.total)} words in the deck
                {missing > 0 ? `, ${fmt(missing)} not yet` : ", all of them"}.
              </p>
              <Bar node={here} />
            </>
          )}
          {/* Learn its new words and review its due ones, side by side, the counts beneath. Only on a
              list with none under it (a lesson, a level, a song), at the owner's request. */}
          {leaf && canWrite && ((onLearn && here.toLearn > 0) || (onReview && here.due > 0)) && (
            <div className="cf-list-actions">
              {onLearn && here.toLearn > 0 && (
                <button className="cf-btn cf-list-learn" onClick={() => onLearn(at)}>
                  Learn
                  <small>{here.toLearn > 10 ? `10 of ${fmt(here.toLearn)} new` : `${fmt(here.toLearn)} new`}</small>
                </button>
              )}
              {onReview && here.due > 0 && (
                <button className="cf-btn cf-list-review" onClick={() => onReview({ list: at, due: here.due })}>
                  Review
                  <small>{fmt(here.due)} due</small>
                </button>
              )}
            </div>
          )}
          {leaf && canWrite && missing > 0 && (
            <>
              <button
                className={`cf-btn cf-list-add${(onReview && here.due > 0) || (onLearn && here.toLearn > 0) ? " cf-btn-ghost" : ""}`}
                disabled={busy || toAdd <= 0 || toAdd > ADD_MAX}
                onClick={() => void add()}
              >
                {busy ? "Adding…" : `Add ${fmt(toAdd)} ${toAdd === 1 ? "word" : "words"} to the deck`}
              </button>
              {toAdd > ADD_MAX && (
                <p className="cf-muted">More than {fmt(ADD_MAX)} at once: open a list inside it, or untick some.</p>
              )}
            </>
          )}
        </header>
      )}

      {error && <p className="cf-error">{error}</p>}

      {study.length > 0 && <Rows nodes={study} go={go} />}
      {content.length > 0 && (
        <>
          <h3 className="cf-list-section">From your content</h3>
          <Rows nodes={content} go={go} />
        </>
      )}

      {leaf && words === null && !error && <Loading small label="Reading the words…" />}
      {leaf && words && (
        <>
          {canWrite && missing > 0 && (
            <p className="cf-muted cf-list-ticks">
              {toAdd > 0 ? "Untick any to leave them out." : "Tick the ones to add."}
              {/* Every word not in the deck at once, those not loaded yet too. */}
              <button
                className="cf-link"
                onClick={() => {
                  setSkip(new Set());
                  setOnly(toAdd > 0 ? new Set() : null);
                }}
              >
                {toAdd > 0 ? "Untick all" : "Tick all"}
              </button>
            </p>
          )}
          <ul className="cf-kinds cf-list-words">
            {words.map((w) => (
              <li key={w.word}>
                {w.inDeck || !canWrite ? (
                  <a className={`cf-kind is-read${w.inDeck ? " is-in" : ""}`} href={plecoHref(w.word)}>
                    <i className="cf-dot" />
                    <Word w={w} />
                    <b>{w.inDeck ? "in deck" : ""}</b>
                  </a>
                ) : (
                  <label className={`cf-kind is-read${ticked(w.word) ? "" : " is-off"}`}>
                    <input type="checkbox" checked={ticked(w.word)} onChange={(e) => tick(w.word, e.target.checked)} />
                    <i className="cf-tick" />
                    <Word w={w} />
                  </label>
                )}
              </li>
            ))}
          </ul>
          {here && words.length < here.total && (
            <button className="cf-more" onClick={() => loadWords(words.length)}>
              Show more ({fmt(here.total - words.length)} left)
            </button>
          )}
        </>
      )}

      {added && (
        <Added
          addition={added}
          list={nameOf(at)}
          onDone={() => setAdded(null)}
          onUndone={() => {
            setAdded(null);
            loadTree();
            if (leaf) loadWords(0);
            refresh();
          }}
        />
      )}
    </div>
  );
}

/** Lists side by side, each with how much is in the deck and what is due; a song with its singer. */
function Rows({ nodes, go }: { nodes: ListNode[]; go: (list: string) => void }) {
  return (
    <ul className="cf-list-rows">
      {nodes.map((n) => (
        <li key={n.list}>
          <button className={n.due > 0 ? "has-due" : undefined} onClick={() => go(n.list)}>
            <span className="cf-list-name cf-zh">
              {n.song?.title ?? nameOf(n.list)}
              {n.linked === "longku" && <span className="cf-list-linked">linked to 龙库</span>}
              {n.song?.artist && <small className="cf-list-artist">{n.song.artist}</small>}
            </span>
            <span className="cf-list-count">
              {n.total === 0 ? "add a song" : n.inDeck === n.total ? `all ${fmt(n.total)}` : `${fmt(n.inDeck)} / ${fmt(n.total)}`}
            </span>
            <Bar node={n} />
            {n.due > 0 && <b className="cf-list-due">{fmt(n.due)} due</b>}
            <i className="cf-list-go" aria-hidden="true">
              ›
            </i>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * A song's Spotify link in; its lyrics' words out, as a list. When no lyrics
 * are found for it, they can be pasted.
 */
function AddSong({ onAdded }: { onAdded: (list: string) => void }) {
  const [link, setLink] = useState("");
  const [asked, setAsked] = useState<{ title: string; artist: string | null } | null>(null);
  const [lyrics, setLyrics] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (busy || !link.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await send<SongReply>("lists/spotify", { link: link.trim(), ...(asked ? { lyrics } : {}) });
      if ("needLyrics" in r) return setAsked({ title: r.title, artist: r.artist });
      setLink("");
      setAsked(null);
      setLyrics("");
      onAdded(r.list);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="cf-song-add"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="cf-song-row">
        <input
          className="cf-input"
          type="url"
          inputMode="url"
          placeholder="Paste a Spotify song link"
          value={link}
          onChange={(e) => {
            setLink(e.target.value);
            setAsked(null);
          }}
        />
        <button className="cf-btn" disabled={busy || !link.trim() || (asked !== null && !lyrics.trim())}>
          {busy ? "Adding…" : "Add song"}
        </button>
      </div>
      {asked && (
        <>
          <p className="cf-muted">
            No lyrics found for <b className="cf-zh">{asked.title}</b>
            {asked.artist ? ` by ${asked.artist}` : ""}. Paste them here to use them instead (only the words are kept).
          </p>
          <textarea className="cf-input" rows={6} value={lyrics} onChange={(e) => setLyrics(e.target.value)} placeholder="The lyrics" />
        </>
      )}
      {busy && <Loading small label={asked ? "Reading the lyrics…" : "Finding the song and its lyrics…"} />}
      {error && <p className="cf-error">{error}</p>}
    </form>
  );
}

type SongReply =
  | { list: string; title: string; artist: string | null; words: number; fresh: number }
  | { needLyrics: true; title: string; artist: string | null };

function Word({ w }: { w: ListWord }) {
  return (
    <span className="cf-list-word">
      <span className="cf-zh">{w.word}</span>
      <small>
        {w.pinyin ? displayPinyin(w.pinyin) : ""}
        {w.gloss ? `${w.pinyin ? " · " : ""}${w.gloss}` : ""}
        {w.gloss && (
          <>
            {" "}
            <AiPill word={w.word} still />
          </>
        )}
      </small>
    </span>
  );
}

/** How much of a list is in the deck. */
function Bar({ node }: { node: ListNode }) {
  const pct = node.total ? (100 * node.inDeck) / node.total : 0;
  return (
    <span className="cf-list-bar" role="img" aria-label={`${Math.round(pct)}% in the deck`}>
      <i style={{ width: `${pct}%` }} />
    </span>
  );
}

/** What adding brought, at once, with Keep or Undo: the same page a sync's new words get. */
export function Added({ addition, list, onDone, onUndone }: { addition: Addition; list: string; onDone: () => void; onUndone: () => void }) {
  const [busy, setBusy] = useState<"keep" | "undo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const n = addition.words.length;
  const act = async (action: "seen" | "undo") => {
    setBusy(action === "seen" ? "keep" : "undo");
    try {
      await send(`additions/${addition.id}`, { action });
      if (action === "undo") onUndone();
      else onDone();
    } catch (e) {
      setError(message(e));
      setBusy(null);
    }
  };
  // Back keeps them, as closing a sync's page does.
  useBackLayer(true, () => void act("seen"));
  return (
    <div className="cf-arrival-back">
      <div className="cf-arrival" role="dialog" aria-modal="true" aria-labelledby="cf-added-title">
        <p className="cf-arrival-from cf-zh">From {list}</p>
        <h2 id="cf-added-title" className="cf-arrival-title">
          <b>+{fmt(n)}</b> {n === 1 ? "new word" : "new words"}
        </h2>
        <AdditionDetails addition={addition} />
        {error && <p className="cf-error">{error}</p>}
        <div className="cf-arrival-actions">
          <button className="cf-answer-btn cf-answer-ghost cf-arrival-undo" disabled={busy !== null} onClick={() => void act("undo")}>
            {busy === "undo" ? "Undoing…" : "Undo"}
          </button>
          <button className="cf-answer-btn cf-answer-good" disabled={busy !== null} onClick={() => void act("seen")}>
            {busy === "keep" ? "Keeping…" : "Keep"}
          </button>
        </div>
      </div>
    </div>
  );
}
