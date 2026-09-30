// A clock that ticks when something falls due.

import { useEffect, useState } from "react";
import type { BankEntry } from "./store";
import { nextDueAt } from "./srs";

/** setTimeout's ceiling. Anything further is re-read when that fires. */
const MAX_WAIT = 2 ** 31 - 1;

/**
 * The time, moved on whenever a word in `bank` falls due.
 *
 * What's due is read off the clock, but components only re-read it when the
 * bank changes. That held while everything fell due at midnight; a word still
 * being learned is back ten minutes after it's played, and a finished pass or
 * a closed dock sitting on screen should notice without waiting for a click.
 *
 * Pass the result as a dependency of anything computed from due dates. A
 * phone that slept through the moment catches up when the page is shown.
 */
export function useDueClock(bank: Record<string, BankEntry>): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t0 = Date.now();
    const next = nextDueAt(bank, t0);
    if (!Number.isFinite(next)) return;
    // A beat past the moment, so the word reads as due when it fires.
    const t = setTimeout(() => setNow(Date.now()), Math.min(MAX_WAIT, next - t0 + 250));
    return () => clearTimeout(t);
  }, [bank, now]);

  useEffect(() => {
    const wake = () => document.visibilityState === "visible" && setNow(Date.now());
    document.addEventListener("visibilitychange", wake);
    return () => document.removeEventListener("visibilitychange", wake);
  }, []);

  return now;
}
