// The phone's back button, for a one-page app.
//
// Every layer that opens over another (a sheet, a list inside a list, a
// review session, a tab other than Review) puts one entry on the browser's
// history; back takes the top one off and closes that layer, instead of
// leaving the site. A layer closed from the page (its own close button)
// takes its entry back off, quietly, so back never has to be pressed twice.
//
// Browser side only. Used through useBackLayer in components/shared.tsx.

type Layer = { id: number; close: () => void };

const stack: Layer[] = [];
let next = 1;
/** Back steps taken by the page itself, whose popstate is not the owner pressing back. */
let ignoring = 0;
/** Layers opened while such steps were still on their way: their entries go on once those land. */
let waiting = 0;
let installed = false;

/** Listen for back. Also called from the shell on load, so stale entries are skipped before any layer opens. */
export function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("popstate", (e) => {
    if (ignoring > 0) {
      ignoring--;
      if (ignoring === 0) {
        for (; waiting > 0; waiting--) window.history.pushState({ cf: true }, "");
      }
      return;
    }
    // The owner pressed back: close the top layer. Its entry is already gone.
    const top = stack.pop();
    if (top) return top.close();
    // Nothing open, yet still on an entry of ours: one left from before the
    // page was reloaded, with no layer behind it now. Step past it.
    if ((e.state as { cf?: boolean } | null)?.cf) window.history.back();
  });
}

/** Open a layer. Returns its id, to release it when the page closes it. */
export function open(close: () => void): number {
  install();
  const id = next++;
  stack.push({ id, close });
  if (ignoring > 0) waiting++;
  else window.history.pushState({ cf: true }, "");
  return id;
}

/**
 * The page closed a layer (or it went away): take its entry, and those of any
 * layers above it, back off the history. Nothing if back already closed it.
 */
export function release(id: number) {
  const at = stack.findIndex((l) => l.id === id);
  if (at < 0) return;
  let steps = stack.length - at;
  stack.splice(at);
  // Entries not pushed yet need no step back.
  const unpushed = Math.min(waiting, steps);
  waiting -= unpushed;
  steps -= unpushed;
  if (steps > 0) {
    ignoring += steps;
    window.history.go(-steps);
  }
}
