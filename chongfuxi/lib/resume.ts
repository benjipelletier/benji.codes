// A review in progress, kept on the device so leaving it (back, the close
// button, closing the site) loses nothing: open the app again and it is where
// it was. Answers are safe anyway (the server has them, or the outbox does);
// this keeps the rest: the cards in hand, how far in, and Fast review's marks,
// which are not answers until Done.
//
// One study day only: a record from another day is dropped. In localStorage,
// so every read and write may fail (a private window); then there is simply
// nothing to resume.

import type { FastCard, SessionCard, SessionKinds } from "./api";
import { today } from "./client";

export interface SessionResume {
  day: string;
  /** Still on screen when last saved: open the app again straight into it. */
  open: boolean;
  session: string;
  kinds: SessionKinds;
  /** The cards in hand, the one showing first. */
  queue: SessionCard[];
  dealt: number;
  answered: number;
  streak: number;
  recentIds: number[];
  recentWords: string[];
}

export interface FastResume {
  day: string;
  open: boolean;
  session: string;
  cards: FastCard[];
  total: number | null;
  forgot: number[];
  /** Cards that would be answered at Done: the ones scrolled past, and those marked forgotten further down. */
  marked: number;
  scrollTop: number;
}

const KEYS = { session: "chongfuxi:resume:session", fast: "chongfuxi:resume:fast" } as const;
type Kind = keyof typeof KEYS;
type Of<K extends Kind> = K extends "session" ? SessionResume : FastResume;

export function load<K extends Kind>(kind: K): Of<K> | null {
  try {
    const raw = window.localStorage.getItem(KEYS[kind]);
    const r = raw ? (JSON.parse(raw) as Of<K>) : null;
    if (r && r.day === today().day) return r;
    if (r) window.localStorage.removeItem(KEYS[kind]);
  } catch {
    // Nothing to resume.
  }
  return null;
}

export function save<K extends Kind>(kind: K, r: Omit<Of<K>, "day">) {
  try {
    window.localStorage.setItem(KEYS[kind], JSON.stringify({ ...r, day: today().day }));
  } catch {
    // Too big or refused: this visit goes on, it just won't come back.
  }
}

/** Left, but kept to carry on from Today. */
export function close(kind: Kind) {
  const r = load(kind);
  if (r) save(kind, { ...r, open: false });
}

export function clear(kind: Kind) {
  try {
    window.localStorage.removeItem(KEYS[kind]);
  } catch {
    // Nothing kept.
  }
}

/** Which review was on screen when the app was last left, if any. */
export function wasOpen(): Kind | null {
  if (load("session")?.open) return "session";
  if (load("fast")?.open) return "fast";
  return null;
}
