// A synonym group's page (words with the same English), from anywhere: Cards ›
// Synonyms, or a word's page. The shell draws it once (`SynonymPageHost` in
// components/Synonyms.tsx), under a word page opened from it.

let open: string | null = null;
const listeners = new Set<() => void>();
const told = () => listeners.forEach((f) => f());

export function openGroup(key: string) {
  open = key;
  told();
}

export function closeGroup() {
  open = null;
  told();
}

export const openKey = () => open;

export function subscribe(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
