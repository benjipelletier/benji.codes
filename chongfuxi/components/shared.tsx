"use client";

// Pieces every screen uses: what the shell hands down, and a few ways of
// writing things.

import type { CardHistory, Summary } from "@chongfuxi/lib/api";

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
