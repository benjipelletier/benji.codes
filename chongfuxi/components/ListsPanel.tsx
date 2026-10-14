"use client";

// The Pleco word lists, browsed the way Pleco's flashcards showed them
// (HSK标准教程 › HSK标准教程5 › 第24课), and a lesson's words added to the deck
// in one go. Pleco's own flashcard screen is gone once Pleco hands its cards
// to AnkiDroid, and this is where taking a lesson at a time went.
//
// The lists came in with the Pleco backup: each word row knows the lists it
// is filed under. Adding is one addition, shown at once with Keep and Undo,
// as a sync's new words are.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Addition, ListNode, ListWord } from "@chongfuxi/lib/api";
import { get, send } from "@chongfuxi/lib/client";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import * as bugs from "@chongfuxi/lib/bugs";
import { AdditionDetails } from "./NewWords";
import { BackStep, fmt, message, plecoHref, useBackLayer, type Shell } from "./shared";

const PAGE = 300;
/** As the server allows (LIST_ADD_MAX). */
const ADD_MAX = 500;

const nameOf = (list: string) => list.slice(list.lastIndexOf("/") + 1);
const parentOf = (list: string) => (list.includes("/") ? list.slice(0, list.lastIndexOf("/")) : "");
/** 第9课 before 第10课, Level 2 before Level 10. */
const natural = (a: string, b: string) => a.localeCompare(b, "zh-Hans-CN", { numeric: true });

export function ListsPanel({ shell }: { shell: Shell }) {
  const { canWrite, refresh } = shell;
  const [nodes, setNodes] = useState<ListNode[] | null>(null);
  const [at, setAt] = useState("");
  const [words, setWords] = useState<ListWord[] | null>(null);
  // Missing words unticked, so left out of the add.
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Addition | null>(null);

  const loadTree = useCallback(() => {
    get<{ lists: ListNode[] }>("lists")
      .then((r) => setNodes(r.lists))
      .catch((e) => setError(message(e)));
  }, []);
  useEffect(loadTree, [loadTree]);

  const byList = useMemo(() => new Map((nodes ?? []).map((n) => [n.list, n])), [nodes]);
  const children = useMemo(
    () => (nodes ?? []).filter((n) => parentOf(n.list) === at).sort((a, b) => natural(nameOf(a.list), nameOf(b.list))),
    [nodes, at],
  );
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
  const toAdd = missing - skip.size;

  const add = async () => {
    if (!here || toAdd <= 0) return;
    setBusy(true);
    setError(null);
    try {
      const r = await send<{ id: number | null }>("lists", { list: at, skip: [...skip] });
      if (r.id !== null) {
        const { additions } = await get<{ additions: Addition[] }>("additions", { id: r.id });
        setAdded(additions[0] ?? null);
      }
      loadTree();
      if (leaf) loadWords(0);
      setSkip(new Set());
      refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  if (!nodes && !error) return <p className="cf-muted cf-pad">Reading the lists…</p>;

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
      {/* Where in the tree: every step back is a tap. */}
      <nav className="cf-crumbs" aria-label="Lists">
        <button className={at ? "" : "is-here"} onClick={() => go("")}>
          Lists
        </button>
        {at.split("/").filter(Boolean).map((part, i, all) => {
          const path = all.slice(0, i + 1).join("/");
          return (
            <span key={path}>
              <i aria-hidden="true">›</i>
              <button className={path === at ? "is-here" : ""} onClick={() => go(path)}>
                {part}
              </button>
            </span>
          );
        })}
      </nav>

      {here && (
        <header className="cf-list-head">
          <h2 className="cf-zh">{nameOf(at)}</h2>
          <p className="cf-muted">
            {fmt(here.inDeck)} of {fmt(here.total)} words in the deck
            {missing > 0 ? `, ${fmt(missing)} not yet` : ", all of them"}.
          </p>
          <Bar node={here} />
          {canWrite && missing > 0 && (
            <>
              <button className="cf-btn cf-list-add" disabled={busy || toAdd <= 0 || toAdd > ADD_MAX} onClick={() => void add()}>
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

      {children.length > 0 && (
        <ul className="cf-list-rows">
          {children.map((n) => (
            <li key={n.list}>
              <button onClick={() => go(n.list)}>
                <span className="cf-list-name cf-zh">{nameOf(n.list)}</span>
                <span className="cf-list-count">
                  {n.inDeck === n.total ? "all " : `${fmt(n.inDeck)} / `}
                  {fmt(n.total)}
                </span>
                <Bar node={n} />
                <i className="cf-list-go" aria-hidden="true">
                  ›
                </i>
              </button>
            </li>
          ))}
        </ul>
      )}

      {leaf && words === null && !error && <p className="cf-muted">Reading the words…</p>}
      {leaf && words && (
        <>
          {canWrite && missing > 0 && <p className="cf-muted">Untick any to leave them out.</p>}
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
                  <label className={`cf-kind is-read${skip.has(w.word) ? " is-off" : ""}`}>
                    <input
                      type="checkbox"
                      checked={!skip.has(w.word)}
                      onChange={(e) =>
                        setSkip((s) => {
                          const next = new Set(s);
                          if (e.target.checked) next.delete(w.word);
                          else next.add(w.word);
                          return next;
                        })
                      }
                    />
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

function Word({ w }: { w: ListWord }) {
  return (
    <span className="cf-list-word">
      <span className="cf-zh">{w.word}</span>
      <small>
        {w.pinyin ? displayPinyin(w.pinyin) : ""}
        {w.gloss ? `${w.pinyin ? " · " : ""}${w.gloss}` : ""}
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
function Added({ addition, list, onDone, onUndone }: { addition: Addition; list: string; onDone: () => void; onUndone: () => void }) {
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
