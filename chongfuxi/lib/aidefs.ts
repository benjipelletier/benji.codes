// The words whose definition the model wrote (app/api/chongfuxi/define.ts),
// fetched once and shared, so every place a definition is shown can put an AI
// pill beside it without each API saying so. Changed here when one is written
// or undone, and read by components through useSyncExternalStore.

import { get, send } from "./client";

let words = new Set<string>();
let owner = false;
let version = 0;
let loading = false;
const listeners = new Set<() => void>();

function changed() {
  version++;
  for (const f of listeners) f();
}

function load() {
  if (loading) return;
  loading = true;
  get<{ words: string[] }>("define")
    .then((r) => {
      words = new Set(r.words);
      changed();
    })
    .catch(() => {
      // Tried again by the next component that subscribes.
      loading = false;
    });
}

export function subscribe(f: () => void): () => void {
  listeners.add(f);
  load();
  return () => listeners.delete(f);
}

/** Changes whenever the set or the owner flag does. */
export const snapshot = () => version;

export const isAi = (word: string) => words.has(word);

/** Whether this viewer can undo one (the owner). */
export const canUndo = () => owner;

export function setOwner(on: boolean) {
  if (on === owner) return;
  owner = on;
  changed();
}

/** A definition just written. */
export function written(word: string) {
  words.add(word);
  changed();
}

/** Take a word's AI definition away: it has none again. */
export async function undo(word: string): Promise<void> {
  await send("define", { word, undo: true });
  words.delete(word);
  changed();
}
