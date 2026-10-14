// Answers on their way to the server, kept on the device until they arrive.
//
// Every answer is put here before it is sent and leaves only when the server
// has taken it (or refused it for good), so an answer given on the subway, or
// in a tab that is then closed, goes the next time there is a connection.
// The server records an id once, so sending one twice is harmless.
//
// Kept in localStorage, read afresh on every change so two tabs don't write
// over each other; in memory alone where storage is refused. Sent oldest
// first, a batch at a time, through the same answer code as a session.

import type { ReviewInput } from "./api";
import { ApiError, send } from "./client";

const KEY = "chongfuxi:outbox";
/** Answers per request (the batch route takes up to 60). */
const CHUNK = 40;
/** While answers wait, try again this often, as well as when the device says it is back online. */
const RETRY_MS = 30_000;

export interface OutboxState {
  /** Answers not yet taken by the server. */
  pending: number;
  sending: boolean;
  /** Why the last attempt stopped, while answers still wait. */
  stalled: string | null;
}

export interface Flushed {
  done: number;
  refused: number;
  recallOpened: number;
  revived: number;
  /** Still waiting when this attempt ended. */
  left: number;
  error: string | null;
}

type BatchReply = { done: string[]; refused: Array<{ id: string }>; recallOpened: number; revived: number };

let memory: ReviewInput[] = [];
let state: OutboxState = { pending: 0, sending: false, stalled: null };
const listeners = new Set<() => void>();
let running: Promise<Flushed> | null = null;
let retry: number | null = null;
let started = false;

function read(): ReviewInput[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    memory = Array.isArray(list) ? (list as ReviewInput[]) : [];
  } catch {
    // Storage refused: what is in memory is all there is.
  }
  return memory;
}

function write(list: ReviewInput[]) {
  memory = list;
  try {
    if (list.length) window.localStorage.setItem(KEY, JSON.stringify(list));
    else window.localStorage.removeItem(KEY);
  } catch {
    // Kept in memory only; it still survives a lost connection, if not a closed tab.
  }
  update({ pending: list.length, ...(list.length ? {} : { stalled: null }) });
}

function update(next: Partial<OutboxState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

/** Why sending stopped, said for the owner. */
function why(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return "Sign in to send them.";
    if (e.status === 403) return "Only the owner's answers can be sent.";
    return e.message;
  }
  if (typeof navigator !== "undefined" && !navigator.onLine) return "No connection.";
  // fetch rejects with a TypeError ("Failed to fetch") when the network drops.
  return e instanceof TypeError ? "The connection dropped." : e instanceof Error ? e.message : String(e);
}

function scheduleRetry() {
  if (retry !== null || typeof window === "undefined") return;
  retry = window.setTimeout(() => {
    retry = null;
    if (read().length) void flush();
  }, RETRY_MS);
}

export function getState(): OutboxState {
  return state;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Keep answers to send. Written to storage before anything goes over the network. */
export function add(...inputs: ReviewInput[]) {
  const list = read();
  const have = new Set(list.map((r) => r.id));
  write([...list, ...inputs.filter((r) => !have.has(r.id))]);
}

/** The server has the answer (or has refused it for good): stop keeping it. */
export function remove(...ids: string[]) {
  const gone = new Set(ids);
  const list = read();
  if (list.some((r) => gone.has(r.id))) write(list.filter((r) => !gone.has(r.id)));
}

/** The cards answered here that the server doesn't know about yet, so a session doesn't deal them again. */
export function waitingCards(): number[] {
  return read().map((r) => r.cardId);
}

/** Note a failed send made outside `flush`, and try again later. */
export function stall(e: unknown) {
  update({ stalled: why(e) });
  scheduleRetry();
}

/**
 * Send everything waiting, oldest first. One attempt runs at a time; a call
 * made while one runs waits for it, then sends whatever is still here.
 */
export function flush(progress?: (sent: number, of: number) => void): Promise<Flushed> {
  if (running) return running.then(() => flush(progress));
  running = attempt(progress).finally(() => {
    running = null;
  });
  return running;
}

async function attempt(progress?: (sent: number, of: number) => void): Promise<Flushed> {
  const tally: Flushed = { done: 0, refused: 0, recallOpened: 0, revived: 0, left: 0, error: null };
  const of = read().length;
  if (!of) return tally;
  update({ sending: true });
  try {
    for (;;) {
      const batch = read().slice(0, CHUNK);
      if (!batch.length) break;
      const sentAt = Date.now();
      const reply = await send<BatchReply>("review/batch", { reviews: batch.map((r) => ({ ...r, sentAt })) });
      const taken = [...reply.done, ...reply.refused.map((r) => r.id)];
      // A reply that takes nothing would send the same batch forever.
      if (!taken.length) throw new Error("The server took none of the waiting answers.");
      remove(...taken);
      tally.done += reply.done.length;
      tally.refused += reply.refused.length;
      tally.recallOpened += reply.recallOpened;
      tally.revived += reply.revived;
      progress?.(tally.done + tally.refused, of);
    }
    update({ stalled: null });
  } catch (e) {
    tally.error = why(e);
    update({ stalled: tally.error });
    scheduleRetry();
  } finally {
    tally.left = read().length;
    update({ sending: false, pending: tally.left });
  }
  return tally;
}

/**
 * Start watching for a way out: send what waits now, when the device comes
 * back online, when the app comes back to the front, and every so often while
 * answers wait. Once per page.
 */
export function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  update({ pending: read().length });
  const go = () => {
    if (read().length) void flush();
  };
  window.addEventListener("online", go);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") go();
  });
  // Another tab changed what waits.
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) update({ pending: read().length });
  });
  go();
}
