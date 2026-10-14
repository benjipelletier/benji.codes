// Filing a bug from any screen, browser side: what the screens report about
// themselves, the errors the page has seen, and a screenshot of the screen.
//
// A screen says what it is showing with `note` (a session notes its card),
// and stops with the function it returns. The screenshot is drawn from the
// page itself (Android's browser lets a page capture nothing else), so it is
// the page as the browser laid it out, not pixels off the glass.

import type { BugContext } from "./api";
import { getState } from "./outbox";

const state = new Map<string, unknown>();
const errors: Array<{ at: number; message: string }> = [];
const ERRORS_KEPT = 10;
let listening = false;

/** What a screen is showing, for a report filed while it is up. Returns how to take it back. */
export function note(key: string, value: unknown): () => void {
  state.set(key, value);
  return () => {
    if (state.get(key) === value) state.delete(key);
  };
}

function remember(message: string) {
  errors.push({ at: Date.now(), message: message.slice(0, 500) });
  if (errors.length > ERRORS_KEPT) errors.shift();
}

/** Start keeping the page's errors. Once per page. */
export function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("error", (e) => remember(`${e.message}${e.filename ? ` (${e.filename}:${e.lineno})` : ""}`));
  window.addEventListener("unhandledrejection", (e) => remember(`Unhandled: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`));
}

export function context(screen: string): BugContext {
  return {
    url: window.location.href,
    screen,
    viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 },
    userAgent: navigator.userAgent,
    theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    build: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? null,
    state: Object.fromEntries(state),
    errors: [...errors],
    pending: getState().pending,
  };
}

/** Longest side of a screenshot, in pixels: enough to read, small enough to send. */
const SHOT_MAX = 1600;

/**
 * The screen as it is now, as a JPEG data URL; null if it couldn't be drawn.
 * Only what is in view, at up to twice the screen's resolution. Elements
 * marked `data-bug-skip` (the bug button) are left out.
 */
export async function screenshot(): Promise<string | null> {
  try {
    const { domToCanvas } = await import("modern-screenshot");
    const scale = Math.min(window.devicePixelRatio || 1, 2, SHOT_MAX / Math.max(window.innerWidth, window.innerHeight));
    const bg = getComputedStyle(document.querySelector(".cfx") ?? document.body).backgroundColor;
    const full = await domToCanvas(document.body, {
      scale,
      backgroundColor: bg,
      timeout: 15000,
      filter: (n) => !(n instanceof HTMLElement && n.dataset.bugSkip !== undefined),
    });
    // The page is drawn whole; keep the part on screen.
    const out = document.createElement("canvas");
    out.width = Math.round(window.innerWidth * scale);
    out.height = Math.round(window.innerHeight * scale);
    const ctx = out.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(full, 0, -Math.round(window.scrollY * scale));
    return out.toDataURL("image/jpeg", 0.8);
  } catch {
    return null;
  }
}

/** A picture from the phone (a real screenshot), made small enough to send, as a JPEG data URL. */
export async function fromFile(file: File): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const k = Math.min(1, SHOT_MAX / Math.max(bitmap.width, bitmap.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bitmap.width * k);
    c.height = Math.round(bitmap.height * k);
    c.getContext("2d")?.drawImage(bitmap, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  } catch {
    return null;
  }
}
