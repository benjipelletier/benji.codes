// Where the owner is, kept in the address, so a reload comes back to it:
// the tab, Cards' section, the list open, a word's or sentence's sheet, the
// Import page, Look up's question, a review under way. Each screen keeps its
// own part while it is on screen and clears it when it goes, so the address
// only ever holds what is showing.
//
// The address is replaced, never pushed: back.ts owns the history (one entry
// per layer, the phone's back closing the top one), and its entries keep
// their state here.

import { useEffect } from "react";

/**
 * What the screens on show have set, the truth the address is written from.
 * Kept apart from the address because back.ts steps through the history to
 * close layers, and each step back brings an older entry's address with it.
 */
let current: Map<string, string> | null = null;

function state(): Map<string, string> {
  if (!current) {
    current = new Map(new URLSearchParams(window.location.search));
    // After any step through the history, put back what is on screen.
    window.addEventListener("popstate", write);
  }
  return current;
}

function write() {
  const url = new URL(window.location.href);
  url.search = new URLSearchParams([...state()]).toString();
  if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
}

/** A part of the address, as the page was loaded or last set; null on the server. */
export function routeParam(key: string): string | null {
  if (typeof window === "undefined") return null;
  return state().get(key) ?? null;
}

/** Set a part of the address (null clears it), in place. */
export function setRouteParam(key: string, value: string | null) {
  if (typeof window === "undefined") return;
  if (value === null || value === "") state().delete(key);
  else state().set(key, value);
  write();
}

/**
 * Keep `value` in the address under `key` while the component is on
 * screen; gone with it. `ready` false holds off until the component has read
 * the address itself, so its default doesn't wipe what the reload brought.
 */
export function useRouteParam(key: string, value: string | null, ready = true) {
  useEffect(() => {
    if (ready) setRouteParam(key, value);
  }, [key, value, ready]);
  useEffect(() => () => setRouteParam(key, null), [key]);
}

/** A value from the address, if it is one of `allowed`. */
export function routeChoice<T extends string>(key: string, allowed: readonly T[]): T | null {
  const v = routeParam(key);
  return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}
