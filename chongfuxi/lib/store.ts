// Where the event log and imported backups live — for now, this browser.
//
// Milestone 1 keeps everything in IndexedDB. Nothing here is irreplaceable
// yet: every import can be redone from its Pleco backup, and the only other
// events are a handful of words marked known. Server storage arrives with
// reviews in milestone 2, when the log starts holding things that can't be
// recreated; the shape of what's stored (imports + an append-only event log)
// is already the one the server will keep.
//
// When IndexedDB isn't available (private windows in some browsers) the store
// falls back to memory and says so, rather than failing to open.

import type { PlecoSnapshot } from "./pleco";
import type { ChongEvent, Effects } from "./machine";

export interface StoredImport {
  id: string;
  at: number;
  fileName: string;
  /**
   * SHA-256 of the backup file, to spot the same backup imported twice. Null
   * when the page was served over plain http (a phone on the LAN hitting a
   * dev server), where browsers withhold crypto.subtle.
   */
  sha256: string | null;
  snapshot: PlecoSnapshot;
}

export interface LoggedEvent {
  /** Position in the log, from 1. */
  seq: number;
  event: ChongEvent;
  /** What the event did when it was applied, kept so the log reads without replaying. */
  effects: Effects | null;
}

export interface Store {
  mode: "local" | "memory";
  load(): Promise<{ imports: StoredImport[]; events: LoggedEvent[] }>;
  putImport(imp: StoredImport): Promise<void>;
  appendEvent(event: ChongEvent, effects: Effects | null): Promise<LoggedEvent>;
}

const DB_NAME = "chongfuxi";
const DB_VERSION = 1;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("imports")) db.createObjectStore("imports", { keyPath: "id" });
      if (!db.objectStoreNames.contains("events")) db.createObjectStore("events", { keyPath: "seq" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB is blocked by another tab."));
  });
}

function indexedDbStore(db: IDBDatabase): Store {
  let nextSeq = 1;
  return {
    mode: "local",
    async load() {
      const tx = db.transaction(["imports", "events"], "readonly");
      const imports = await request(tx.objectStore("imports").getAll() as IDBRequest<StoredImport[]>);
      const events = await request(tx.objectStore("events").getAll() as IDBRequest<LoggedEvent[]>);
      events.sort((a, b) => a.seq - b.seq);
      nextSeq = (events[events.length - 1]?.seq ?? 0) + 1;
      return { imports, events };
    },
    async putImport(imp) {
      const tx = db.transaction("imports", "readwrite");
      await request(tx.objectStore("imports").put(imp));
    },
    async appendEvent(event, effects) {
      const logged: LoggedEvent = { seq: nextSeq++, event, effects };
      const tx = db.transaction("events", "readwrite");
      await request(tx.objectStore("events").add(logged));
      return logged;
    },
  };
}

function memoryStore(): Store {
  const imports: StoredImport[] = [];
  const events: LoggedEvent[] = [];
  return {
    mode: "memory",
    async load() {
      return { imports: [...imports], events: [...events] };
    },
    async putImport(imp) {
      imports.push(imp);
    },
    async appendEvent(event, effects) {
      const logged = { seq: events.length + 1, event, effects };
      events.push(logged);
      return logged;
    },
  };
}

export async function openStore(): Promise<Store> {
  try {
    if (typeof indexedDB === "undefined") return memoryStore();
    return indexedDbStore(await openDb());
  } catch {
    return memoryStore();
  }
}

export async function sha256(bytes: ArrayBuffer): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A fresh id. crypto.randomUUID is secure-context only too, hence the fallback. */
export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
