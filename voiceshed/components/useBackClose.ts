'use client';

// The phone's back button (Android's, a browser's) closes what's open on the
// page — a sheet, a run, a run's summary — before it leaves the page (the
// owner: "fix the back button, they don't always go to the previous page").
// Each open thing is a step in the browser's history: opening it pushes one;
// back pops the top one and closes it; closing it any other way (×, Done, END)
// takes its step back off, so the history stays in step with the screen.
//
// Pushes and pops go through one queue: history.back() is asynchronous, so a
// push right after one (a run ending into its summary) waits for that back to
// land rather than being popped by it.

import { useEffect, useRef } from 'react';

interface Entry {
  close: () => void;
}

const stack: Entry[] = [];
const queue: (() => void)[] = [];
/** Backs we started ourselves, whose popstate isn't the user's. */
let ours = 0;
let listening = false;

function flush() {
  while (queue.length && ours === 0) queue.shift()!();
}

function onPop() {
  if (ours > 0) {
    ours--;
    flush();
    return;
  }
  stack.pop()?.close();
}

function listen() {
  if (listening || typeof window === 'undefined') return;
  window.addEventListener('popstate', onPop);
  listening = true;
}

/** While `open`, the back button calls `close` (and only the newest open thing's). */
export function useBackClose(open: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    listen();
    const entry: Entry = { close: () => closeRef.current() };
    stack.push(entry);
    queue.push(() => window.history.pushState({ ...(window.history.state ?? {}), vshBack: stack.length }, ''));
    flush();
    return () => {
      const i = stack.indexOf(entry);
      if (i < 0) return; // closed by the back button: its step is already gone
      stack.splice(i, 1);
      queue.push(() => {
        ours++;
        window.history.back();
      });
      flush();
    };
  }, [open]);
}
