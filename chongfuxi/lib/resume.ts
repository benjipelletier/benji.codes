// A Fast review in progress, kept on the device so leaving it (back, the close
// button, closing the site) loses nothing: open the app again and it is where
// it was. Its marks are not answers until Done, so they would be lost
// otherwise. A review session keeps nothing: each answer is sent (or put in
// the outbox) as it is given, so starting again simply deals what is still due.
//
// One study day only: a record from another day is dropped. In localStorage,
// so every read and write may fail (a private window); then there is simply
// nothing to resume.

import type { FastCard } from "./api";
import { today } from "./client";

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

const KEY = "chongfuxi:resume:fast";
/** Where a review session was kept, before sessions stopped keeping anything: cleared. */
const OLD_SESSION_KEY = "chongfuxi:resume:session";

export function load(): FastResume | null {
  try {
    window.localStorage.removeItem(OLD_SESSION_KEY);
    const raw = window.localStorage.getItem(KEY);
    const r = raw ? (JSON.parse(raw) as FastResume) : null;
    if (r && r.day === today().day) return r;
    if (r) window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to resume.
  }
  return null;
}

export function save(r: Omit<FastResume, "day">) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...r, day: today().day }));
  } catch {
    // Too big or refused: this visit goes on, it just won't come back.
  }
}

/** Left, but kept to carry on from Today. */
export function close() {
  const r = load();
  if (r) save({ ...r, open: false });
}

export function clear() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing kept.
  }
}

/** Whether a Fast review was on screen when the app was last left. */
export function wasOpen(): boolean {
  return Boolean(load()?.open);
}
