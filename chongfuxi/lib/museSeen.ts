// What of Muse's content the owner has opened on this device, for the New
// badges on Muse reviews: each thing by a key and when it was last opened.
// A per-device convenience in localStorage (lib/resume.ts does the same);
// with no storage everything simply reads as new.

const KEY = "cfx-muse-seen";
const EVENT = "cfx-muse-seen";

function read(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

/** When this was last opened here, or 0. */
export function seenAt(key: string): number {
  return read()[key] ?? 0;
}

/** Mark it opened now. */
export function markSeen(key: string) {
  try {
    const all = read();
    all[key] = Date.now();
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Not remembered: it stays new.
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Called whenever something is marked seen, so badges redraw. */
export function onSeen(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
