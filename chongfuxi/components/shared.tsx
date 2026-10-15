"use client";

// Pieces every screen uses: what the shell hands down, and a few ways of
// writing things.

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import type { CardHistory, SentenceInfo, Summary, WordInfo } from "@chongfuxi/lib/api";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import * as back from "@chongfuxi/lib/back";
import * as outbox from "@chongfuxi/lib/outbox";

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
  onLook,
}: {
  sentence: SentenceInfo;
  word?: string;
  taps: boolean;
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
            {marked(b)}
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
            {look.gloss && <span className="cf-look-gloss">{look.gloss}</span>}
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
export function Word({ word }: { word: string }) {
  const n = [...word].length;
  return (
    <div className={`cf-card-word${n > 6 ? " is-long" : ""}`} style={{ "--n": Math.min(n, 6) } as React.CSSProperties}>
      {word}
    </div>
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
