// The word page, from anywhere: any screen with a word on it (a popup over a
// sentence, Look up, a list, Unlock next, the session's answers) opens it
// here, and the shell draws it over everything but its header (`WordPageHost` in
// ChongfuxiApp.tsx). Screens that show words hear when one is removed,
// brought back or added, to redraw; Cards says how to find a word's sentences.

type Change = { word: string; change: "removed" | "resumed" | "added" };

let open: string | null = null;
const listeners = new Set<() => void>();
const changeListeners = new Set<(c: Change) => void>();
let findSentences: ((word: string) => void) | null = null;

const told = () => listeners.forEach((f) => f());

/** Open a word's page over whatever is on screen. */
export function openWordPage(word: string) {
  open = word;
  told();
}

export function closeWordPage() {
  open = null;
  told();
}

export const openWord = () => open;

export function subscribe(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** A word removed from the deck, brought back or added, from its page. */
export function changed(c: Change) {
  changeListeners.forEach((f) => f(c));
}

export function onChange(f: (c: Change) => void): () => void {
  changeListeners.add(f);
  return () => changeListeners.delete(f);
}

/** Cards, while it is on screen: how to show a word's sentences under Sentences. */
export function setFindSentences(f: ((word: string) => void) | null) {
  findSentences = f;
}

export const sentencesFinder = () => findSentences;
