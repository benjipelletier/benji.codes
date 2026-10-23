"use client";

// Pieces every screen uses: what the shell hands down, and a few ways of
// writing things.

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import type { CardHistory, SentenceInfo, Summary, WordInfo } from "@chongfuxi/lib/api";
import { send } from "@chongfuxi/lib/client";
import type { Definition } from "@chongfuxi/lib/dict";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import * as aidefs from "@chongfuxi/lib/aidefs";
import * as back from "@chongfuxi/lib/back";
import * as outbox from "@chongfuxi/lib/outbox";
import * as wordpage from "@chongfuxi/lib/wordpage";

export interface Shell {
  /** Where the deck stands; null until the server has answered. */
  summary: Summary | null;
  /** Signed in as the owner. Everyone else looks on and changes nothing. */
  canWrite: boolean;
  /** Fetch the counts again, after something that moved them. */
  refresh(): void;
  /** Give the whole screen to a review session: the header and tabs step aside. */
  setFocus(on: boolean): void;
}

export function plecoHref(word: string): string {
  return `plecoapi://x-callback-url/s?q=${encodeURIComponent(word)}`;
}

/**
 * Pleco, as a character tile: 魚 (traditional; Pleco's fish) on a soft blue
 * round, in the tab icons' face, its name small under it. Inline, for a
 * popup or a row of tags: a smaller round with the name beside it. Every
 * "Open in Pleco" is one of these, at the owner's request.
 */
export function PlecoTile({ word, label = "Pleco", inline = false }: { word: string; label?: string; inline?: boolean }) {
  return (
    <a className={`cf-foot-btn is-pleco${inline ? " is-inline" : ""}`} href={plecoHref(word)} aria-label={`${label === "Pleco" ? "Open" : label} ${word} in Pleco`}>
      <span className="cf-foot-zh" aria-hidden="true">
        魚
      </span>
      <small>{label}</small>
    </a>
  );
}

export const fmt = (n: number) => n.toLocaleString("en-US");

/** How long until a card comes back, as the buttons say it: 3d, 5w, 4mo, 2.5y. */
export function span(days: number): string {
  if (days < 21) return `${days}d`;
  if (days < 84) return `${Math.round(days / 7)}w`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  const years = days / 365;
  return `${years < 10 ? years.toFixed(1).replace(/\.0$/, "") : Math.round(years)}y`;
}

/** A sentence with one word picked out, where it appears as written. */
export function Highlighted({ text, word }: { text: string; word: string }) {
  const at = word ? text.indexOf(word) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="cf-mark">{word}</mark>
      {text.slice(at + word.length)}
    </>
  );
}

/** A stretch of a sentence: one of its words, with what a tap shows, or the text between. */
export interface Piece {
  zh: string;
  /** Where it starts in the sentence, for picking out the card's word. */
  at: number;
  /** Index into the sentence's words; null for the text between them. */
  word: number | null;
}

/** The sentence cut at its words, as far as they can be found in it, in order. */
export function piecesOf(sentence: SentenceInfo): Piece[] {
  const { zh, words } = sentence;
  const out: Piece[] = [];
  let at = 0;
  words.forEach((w, i) => {
    const found = w ? zh.indexOf(w, at) : -1;
    // A word written differently in the text (a traditional character) stays plain.
    if (found < 0) return;
    if (found > at) out.push({ zh: zh.slice(at, found), at, word: null });
    out.push({ zh: w, at: found, word: i });
    at = found + w.length;
  });
  if (at < zh.length) out.push({ zh: zh.slice(at), at, word: null });
  return out;
}

/**
 * A sentence with one word picked out, each of its words tappable for its
 * pinyin and meaning in a small popup (`looks`, from the server) once
 * `taps` is on: on a card, only after Show answer.
 */
export function SentenceText({
  sentence,
  word = "",
  taps,
  pinyin = false,
  onLook,
}: {
  sentence: SentenceInfo;
  word?: string;
  taps: boolean;
  /** Each word's reading over it (a sentence card's back, the owner's ask). */
  pinyin?: boolean;
  onLook?: (word: string) => void;
}) {
  const [open, setOpen] = useState<{ i: number; el: HTMLElement } | null>(null);
  const pop = useRef<HTMLSpanElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number; below: boolean } | null>(null);

  // Placed over the word, or under it near the top of the screen, and kept on screen.
  useLayoutEffect(() => {
    if (!open || !pop.current) return setPlace(null);
    const r = open.el.getBoundingClientRect();
    const box = pop.current.getBoundingClientRect();
    const below = r.top - box.height - 8 < 8;
    setPlace({
      left: Math.min(Math.max(8, r.left + r.width / 2 - box.width / 2), window.innerWidth - box.width - 8),
      top: below ? r.bottom + 8 : r.top - box.height - 8,
      below,
    });
  }, [open]);

  // Any tap elsewhere, or the card scrolling, puts it away.
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e.target instanceof Node && (pop.current?.contains(e.target) || open.el.contains(e.target))) return;
      setOpen(null);
    };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("scroll", close, true);
    };
  }, [open]);

  // Turning the card back to its front (the next card) puts the popup away.
  useEffect(() => {
    if (!taps) setOpen(null);
  }, [taps]);

  const pieces = taps && sentence.looks ? piecesOf(sentence) : null;
  if (!pieces) return <Highlighted text={sentence.zh} word={word} />;
  const from = word ? sentence.zh.indexOf(word) : -1;
  const to = from + word.length;
  /** A piece's characters, the picked-out word's in a mark. */
  const marked = (b: Piece) => {
    if (from < 0 || b.at >= to || b.at + b.zh.length <= from) return b.zh;
    const x = Math.max(0, from - b.at);
    const y = Math.min(b.zh.length, to - b.at);
    return (
      <>
        {b.zh.slice(0, x)}
        <mark className="cf-mark">{b.zh.slice(x, y)}</mark>
        {b.zh.slice(y)}
      </>
    );
  };
  const look = open ? sentence.looks?.[open.i] : null;
  const host = open?.el.closest(".cfx");
  return (
    <>
      {pieces.map((b) => {
        const i = b.word;
        if (i === null || !sentence.looks?.[i]) return <span key={b.at}>{marked(b)}</span>;
        const show = (el: HTMLElement) => {
          if (open?.i === i) return setOpen(null);
          setOpen({ i, el });
          onLook?.(b.zh);
        };
        return (
          <span
            key={b.at}
            role="button"
            tabIndex={0}
            className={`cf-tap${open?.i === i ? " is-open" : ""}`}
            onClick={(e) => show(e.currentTarget)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                show(e.currentTarget);
              }
            }}
          >
            {pinyin ? (
              <span className="cf-ruby">
                <small>{displayPinyin(sentence.looks[i]!.p)}</small>
                <span>{marked(b)}</span>
              </span>
            ) : (
              marked(b)
            )}
          </span>
        );
      })}
      {look &&
        host &&
        createPortal(
          <span
            ref={pop}
            role="tooltip"
            className={`cf-look${place?.below ? " is-below" : ""}`}
            style={place ? { left: place.left, top: place.top } : { visibility: "hidden", left: 0, top: 0 }}
          >
            <span className="cf-look-zh">{sentence.words[open!.i]}</span>
            <span className="cf-look-py">{displayPinyin(look.p)}</span>
            {look.gloss && (
              <span className="cf-look-gloss">
                {look.gloss} <AiPill word={sentence.words[open!.i]} still />
              </span>
            )}
            {/* The word's page, over everything (lib/wordpage.ts). */}
            <button
              className="cf-look-page"
              onClick={() => {
                const w = sentence.words[open!.i];
                setOpen(null);
                wordpage.openWordPage(w);
              }}
            >
              Word page ›
            </button>
          </span>,
          host,
        )}
    </>
  );
}

/** How long ago something was, in the largest unit that fits: today, 5 days ago, 14 months ago. */
export function ago(at: number, now = Date.now()): string {
  const days = Math.floor((now - at) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 60) return `${days} days ago`;
  if (days < 730) return `${Math.round(days / 30.4)} months ago`;
  return `${(days / 365).toFixed(1).replace(/\.0$/, "")} years ago`;
}

export const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** What a lost connection is called; the waiting line says it already, so it isn't repeated. */
const OFFLINE = ["No connection.", "The connection dropped."];

/** While `isOpen`, the phone's back button calls `close` instead of leaving the site (lib/back.ts). */
export function useBackLayer(isOpen: boolean, close: () => void) {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    if (!isOpen) return;
    const id = back.open(() => latest.current());
    return () => back.release(id);
  }, [isOpen]);
}

/** One step of back, for as long as it is rendered: one per level of a tree, say. */
export function BackStep({ onBack }: { onBack: () => void }) {
  useBackLayer(true, onBack);
  return null;
}

const NOTHING_WAITING: outbox.OutboxState = { pending: 0, sending: false, stalled: null };

/** Answers kept on this device until the server has them. */
export function useOutbox(): outbox.OutboxState {
  return useSyncExternalStore(outbox.subscribe, outbox.getState, () => NOTHING_WAITING);
}

/** A line while answers wait on the device: how many, why, and a way to send them now. */
export function Waiting() {
  const { pending, sending, stalled } = useOutbox();
  // An answer on its way in the ordinary course is in the outbox too; say nothing until a send has failed.
  if (!pending || (!stalled && !sending)) return null;
  const n = `${fmt(pending)} answer${pending === 1 ? "" : "s"}`;
  return (
    <p className="cf-warn cf-waiting" role="status">
      {sending ? (
        `Sending ${n}…`
      ) : (
        <>
          {n} saved on this device, to send when the connection is back.
          {stalled && !OFFLINE.includes(stalled) ? ` ${stalled}` : ""}{" "}
          <button className="cf-link" onClick={() => void outbox.flush()}>
            Send now
          </button>
        </>
      )}
    </p>
  );
}

/**
 * Something on its way: a little stack of cards, the top one dealt off and
 * tucked under again and again: 重 复 习 coming to the front in turn, in the
 * Read, Recall and Sentence colours, with what is being done under it. `small` sits beside its words,
 * for inside a sheet or a list.
 */
export function Loading({ label, small = false }: { label: string; small?: boolean }) {
  return (
    <div className={`cf-loading${small ? " is-small" : ""}`} role="status" aria-live="polite">
      <span className="cf-deal" aria-hidden="true">
        <i className="cf-deal-card is-read">重</i>
        <i className="cf-deal-card is-produce">复</i>
        <i className="cf-deal-card is-sentence">习</i>
      </span>
      <span className="cf-loading-label">{label}</span>
    </div>
  );
}

/** Bubbles shown at most: the latest answers, here first and Pleco's before them. */
const BUBBLES = 16;

/**
 * How the card has gone: a bubble per answer, oldest first — filled for got
 * it, a ring for forgot — Pleco's smaller and before a gap, then the ones
 * given here. And when it was last seen.
 */
export function History({ h }: { h: CardHistory }) {
  const here = h.here.slice(-BUBBLES);
  const pleco = h.pleco.slice(-Math.max(0, BUBBLES - here.length));
  const count = (list: string[]) => `${list.filter((g) => g === "good").length} right, ${list.filter((g) => g === "forgot").length} wrong`;
  const label = [h.pleco.length ? `In Pleco: ${count(h.pleco)}` : "", h.here.length ? `Here: ${count(h.here)}` : ""].filter(Boolean).join(". ");
  return (
    <div className="cf-history">
      {(pleco.length > 0 || here.length > 0) && (
        <span className="cf-bubbles" role="img" aria-label={label}>
          {pleco.map((g, i) => (
            <i key={`p${i}`} className={`cf-bubble is-pleco is-${g}`} />
          ))}
          {pleco.length > 0 && here.length > 0 && <i className="cf-bubble-gap" />}
          {here.map((g, i) => (
            <i key={`h${i}`} className={`cf-bubble is-${g}`} />
          ))}
        </span>
      )}
      <span className="cf-history-when">
        {h.lastAt === null ? "First time" : `Last seen ${ago(h.lastAt)}${h.lastIn === "pleco" ? " in Pleco" : ""}`}
      </span>
    </div>
  );
}

/** A word 龙库 plays: the chengyu are kept in step with it (app/api/chongfuxi/longku.ts). */
export function LongkuTag() {
  return (
    <span className="cf-tag cf-longku" title="One of the chengyu 龙库 plays">
      龙库
    </span>
  );
}

/** A word whose definition the model wrote (app/api/chongfuxi/define.ts), not a dictionary. */
export function AiTag() {
  return (
    <span className="cf-tag cf-ai-tag" title="Its definition was written by AI, not taken from a dictionary">
      AI
    </span>
  );
}

/** Whether a word's definition is the model's. */
export const aiDefined = (defs: Definition[]) => defs.some((d) => d.ai);

/**
 * For a word with no definition: has the model write one, which is kept and
 * tagged AI. The owner only; the result goes to `onDefined` to redraw with.
 */
export function DefineButton({
  word,
  onDefined,
}: {
  word: string;
  onDefined: (r: { pinyin: string | null; defs: Definition[] }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const define = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await send<{ pinyin: string | null; defs: Definition[] }>("define", { word });
      aidefs.written(word);
      onDefined(r);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="cf-define">
      <button className="cf-btn cf-btn-ghost cf-define-btn" onClick={() => void define()} disabled={busy}>
        <span className="cf-ai-tag cf-tag" aria-hidden="true">
          AI
        </span>
        {busy ? "Writing a definition…" : "Write one with AI"}
      </button>
      {error && <p className="cf-error">{error}</p>}
    </div>
  );
}

/**
 * Beside a definition the model wrote, wherever one is shown: a small "AI"
 * pill. Tapped, it says so and, for the owner, offers Undo, which takes the
 * definition away (the word has none again; `onUndone` redraws). `still`
 * where the pill sits inside something tappable (a row, a link, a tooltip):
 * the pill alone, not a button.
 */
export function AiPill({ word, onUndone, still = false }: { word: string; onUndone?: () => void; still?: boolean }) {
  useSyncExternalStore(aidefs.subscribe, aidefs.snapshot, () => 0);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!aidefs.isAi(word)) return null;
  if (still) {
    return (
      <span className="cf-ai-pill" title="Definition written by AI">
        AI
      </span>
    );
  }
  const undo = async () => {
    setBusy(true);
    setError(null);
    try {
      await aidefs.undo(word);
      setOpen(false);
      onUndone?.();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className={`cf-ai-pill-wrap${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="cf-ai-pill"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        aria-expanded={open}
        title="Definition written by AI"
      >
        AI
      </button>
      {open && (
        <span className="cf-ai-pill-more">
          Written by AI
          {aidefs.canUndo() && (
            <button
              type="button"
              className="cf-link"
              onClick={(e) => {
                e.stopPropagation();
                void undo();
              }}
              disabled={busy}
            >
              {busy ? "Undoing…" : "Undo"}
            </button>
          )}
          {error && <span className="cf-error">{error}</span>}
        </span>
      )}
    </span>
  );
}

/** A word's HSK levels, old and 3.0, as tags; "not HSK" when it is in neither. */
export function HskTags({ hsk }: { hsk: WordInfo["hsk"] }) {
  if (!hsk.old && !hsk.v3) return <span className="cf-tag cf-hsk is-none">not HSK</span>;
  return (
    <>
      {hsk.old && <span className={`cf-tag cf-hsk cf-level is-l${hsk.old}`}>HSK {hsk.old}</span>}
      {hsk.v3 && <span className={`cf-tag cf-hsk cf-level is-l${hsk.v3.split("-")[0]}`}>HSK 3.0: {hsk.v3.replace("-", "–")}</span>}
    </>
  );
}

/** The word, large, on one line: its length sets its size. */
/** A card's headword, sized to its length. With `onOpen` (once the answer shows) a tap opens its word page, a faint › after it. */
export function Word({ word, onOpen }: { word: string; onOpen?: () => void }) {
  const n = [...word].length;
  const style = { "--n": Math.min(n, 6) } as React.CSSProperties;
  const cls = `cf-card-word${n > 6 ? " is-long" : ""}`;
  if (!onOpen) {
    return (
      <div className={cls} style={style}>
        {word}
      </div>
    );
  }
  return (
    <button className={`${cls} is-link`} style={style} onClick={onOpen} aria-label={`${word}: word page`}>
      <span className="cf-card-word-in">
        {word}
        <span className="cf-card-word-go" aria-hidden="true">
          ›
        </span>
      </span>
    </button>
  );
}

/**
 * A sheet over the page, risen from the bottom: a tap outside, the close
 * button, Escape or the phone's back closes it. `escape` off while another
 * sheet is open on top of it, so Escape closes only that one.
 */
export function Sheet({
  label,
  onClose,
  escape = true,
  children,
}: {
  label: string;
  onClose: () => void;
  escape?: boolean;
  children: ReactNode;
}) {
  useBackLayer(true, onClose);
  const latest = useRef(onClose);
  latest.current = onClose;
  useEffect(() => {
    if (!escape) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && latest.current();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [escape]);
  return (
    <div className="cf-sheet-back" onClick={onClose}>
      <div className="cf-sheet" role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        <button className="cf-close cf-sheet-close" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        {children}
      </div>
    </div>
  );
}
