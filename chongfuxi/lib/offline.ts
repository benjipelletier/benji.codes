// Reviewing with no connection (the owner, before a flight: "a way to review
// my cards offline ... all of them"). The pack: every card a session would
// deal now, downloaded ahead (POST session/pack, a page at a time) and kept
// in the browser's Cache Storage (localStorage is too small for thousands of
// cards). When a session can't reach the server it deals from the pack, as
// the server would deal (one card a word in a session, nothing answered on
// this device again); every answer goes to the outbox as always and is sent
// once the connection is back. The app itself opens offline through the
// service worker (public/chongfuxi-sw.js).

import type { SessionCard } from "./api";
import { send, today } from "./client";
import * as outbox from "./outbox";

const CACHE = "cfx-offline-pack";
const KEY = "/__cfx/offline-pack";
const META_KEY = "cfx-offline-meta";
const DONE_KEY = "cfx-offline-done";
/** Cards a page asks for (the route's most); and the most a pack holds. */
const PAGE = 120;
const PACK_MAX = 8000;

export interface PackMeta {
  /** When it was downloaded, the study day it was for, and how many cards. */
  at: number;
  day: string;
  cards: number;
}

type Pack = PackMeta & { list: SessionCard[] };

/** What is on the device, read without opening the pack. */
export function packMeta(): PackMeta | null {
  try {
    const raw = localStorage.getItem(META_KEY);
    return raw ? (JSON.parse(raw) as PackMeta) : null;
  } catch {
    return null;
  }
}

/** Cards answered on this device since the pack was made: not dealt from it again. */
function done(): Set<number> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DONE_KEY) ?? "[]") as number[]);
  } catch {
    return new Set();
  }
}

/** An answer given (online or not): the pack won't deal that card again. */
export function markAnswered(cardId: number) {
  if (!packMeta()) return;
  try {
    const d = done();
    d.add(cardId);
    localStorage.setItem(DONE_KEY, JSON.stringify([...d]));
  } catch {
    // Not kept: the outbox still holds it until it is sent.
  }
}

let loaded: Promise<Pack | null> | null = null;
async function readPack(): Promise<Pack | null> {
  loaded ??= (async () => {
    if (typeof caches === "undefined") return null;
    const hit = await (await caches.open(CACHE)).match(KEY);
    return hit ? ((await hit.json()) as Pack) : null;
  })().catch(() => null);
  return loaded;
}

/**
 * Download every card a session would deal now, a page at a time, each
 * leaving out the cards already fetched, until none are left (or PACK_MAX).
 * Replaces the pack on the device. Owner or not, it is what the session
 * reads; answering still needs the owner.
 */
export async function downloadPack(onProgress: (n: number) => void): Promise<PackMeta> {
  if (typeof caches === "undefined") throw new Error("This browser can't keep cards offline.");
  const day = today();
  const list: SessionCard[] = [];
  const seen = new Set<number>();
  while (list.length < PACK_MAX) {
    const { cards } = await send<{ cards: SessionCard[] }>("session/pack", { ...day, exclude: [...seen], position: list.length, limit: PAGE });
    const fresh = cards.filter((c) => !seen.has(c.id));
    if (!fresh.length) break;
    for (const c of fresh) seen.add(c.id);
    list.push(...fresh);
    onProgress(list.length);
  }
  await warmAppCache();
  const meta: PackMeta = { at: Date.now(), day: day.day, cards: list.length };
  await (await caches.open(CACHE)).put(KEY, new Response(JSON.stringify({ ...meta, list }), { headers: { "Content-Type": "application/json" } }));
  loaded = null;
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
    localStorage.setItem(DONE_KEY, "[]");
  } catch {
    // The pack is kept all the same; its figures just won't show.
  }
  return meta;
}

/**
 * The app's own code and fonts kept by the service worker: what this page
 * loaded before the worker was in control isn't kept, so it is fetched again
 * through it (the worker keeps /_next/static files as they pass).
 */
async function warmAppCache() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 4000))]);
    if (!navigator.serviceWorker.controller)
      await new Promise((r) => {
        navigator.serviceWorker.addEventListener("controllerchange", r, { once: true });
        setTimeout(r, 4000);
      });
    if (!navigator.serviceWorker.controller) return;
    const urls = new Set(
      performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .filter((u) => u.startsWith(`${location.origin}/_next/static/`)),
    );
    await Promise.all([...urls].map((u) => fetch(u).catch(() => undefined)));
    // Today's figures, kept as last answered, so Today draws (and Start shows) with no connection.
    const q = new URLSearchParams({ day: today().day, cutoff: String(today().cutoff) });
    await Promise.all(["summary", "days", "habit"].map((p) => fetch(`/api/chongfuxi/${p}?${q}`, { cache: "no-store" }).catch(() => undefined)));
  } catch {
    // The pack is kept all the same; opening offline may need one visit more online.
  }
}

/** Take the pack off the device. */
export async function dropPack() {
  loaded = null;
  try {
    localStorage.removeItem(META_KEY);
    localStorage.removeItem(DONE_KEY);
  } catch {
    // Nothing to do.
  }
  if (typeof caches !== "undefined") await caches.delete(CACHE);
}

/**
 * The next cards from the pack, as a session deals them: not in hand, not
 * answered on this device (sent or still in the outbox), of the kinds the
 * session takes, one card a word (a word in hand or answered in this session
 * waits), in the pack's order (the server's).
 */
export async function dealFromPack(o: {
  held: number[];
  words: string[];
  n: number;
  kinds: { read: boolean; recall: boolean; sentences: boolean };
}): Promise<SessionCard[] | null> {
  const pack = await readPack();
  if (!pack) return null;
  const skip = new Set([...o.held, ...outbox.waitingCards(), ...done()]);
  const words = new Set(o.words);
  // A word whose other card is answered and waiting to be sent, or in hand, waits too.
  const byId = new Map(pack.list.map((c) => [c.id, c]));
  for (const id of skip) {
    const w = byId.get(id)?.word?.word;
    if (w) words.add(w);
  }
  const out: SessionCard[] = [];
  for (const c of pack.list) {
    if (out.length >= o.n) break;
    if (skip.has(c.id)) continue;
    if (c.kind === "read" && !o.kinds.read) continue;
    if (c.kind === "produce" && !o.kinds.recall) continue;
    if (c.kind === "sentence" && !o.kinds.sentences) continue;
    const w = c.word?.word;
    if (w && words.has(w)) continue;
    if (w) words.add(w);
    out.push(c);
  }
  return out;
}

/** How many cards in the pack are still to answer on this device. */
export async function packLeft(): Promise<number> {
  const pack = await readPack();
  if (!pack) return 0;
  const skip = new Set([...outbox.waitingCards(), ...done()]);
  return pack.list.filter((c) => !skip.has(c.id)).length;
}
