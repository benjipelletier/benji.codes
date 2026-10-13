// The app as one state machine.
//
// Every action is an event, and the state at any moment is the events so far
// folded in order — nothing else is stored as truth. That gives three things
// for free: the state after any past event (replay up to it), the effect of an
// action before taking it (apply it to the current state and diff), and the
// freedom to change the rules later (replay everything under the new ones).
//
// Milestone 1 has four events: importing a Pleco backup, changing what the
// categories mean, and marking a word known (or as a name) or unmarking it.
// Reviews arrive in milestone 2 as more events on the same fold.

import type { Corpus, Settings } from "./corpus";

export type MarkReason = "known" | "name";

export type ChongEvent =
  | { kind: "import"; at: number; importId: string; fileName: string; settings: Settings }
  | { kind: "settings"; at: number; settings: Settings }
  | { kind: "mark"; at: number; word: string; as: MarkReason }
  | { kind: "unmark"; at: number; word: string };

export interface Counts {
  knownWords: number;
  knownByCategory: number;
  knownByScore: number;
  markedKnown: number;
  names: number;
  texts: number;
  studied: number;
  /** Texts with no unknown word: readable now. */
  unlocked: number;
  /** Texts with exactly one unknown word. */
  oneAway: number;
  /** Texts with two or more. */
  locked: number;
}

export interface Derived {
  known: Set<string>;
  /** Unknown words in each text, by index into corpus.texts. */
  blocking: string[][];
  /** Ids of texts with nothing blocking them. */
  unlocked: Set<number>;
  /** Ids of every text in the corpus, so a diff can tell gone from relocked. */
  present: Set<number>;
  /** Word → indices of the texts it alone blocks. */
  soleBlocker: Map<string, number[]>;
  counts: Counts;
}

export interface MachineState {
  importId: string | null;
  settings: Settings | null;
  corpus: Corpus | null;
  marks: Map<string, MarkReason>;
  derived: Derived | null;
}

/** What an event did, or would do. */
export interface Effects {
  wordsAdded: string[];
  wordsRemoved: string[];
  /** Ids of texts that became readable. */
  unlocked: number[];
  /** Ids of texts that stopped being readable. */
  relocked: number[];
  before: Counts | null;
  after: Counts | null;
}

export interface Env {
  /** The corpus for an import under some settings. Expensive; callers cache. */
  corpus(importId: string, settings: Settings): Corpus;
}

export const EMPTY_STATE: MachineState = {
  importId: null,
  settings: null,
  corpus: null,
  marks: new Map(),
  derived: null,
};

export function apply(state: MachineState, event: ChongEvent, env: Env): MachineState {
  switch (event.kind) {
    case "import": {
      const corpus = env.corpus(event.importId, event.settings);
      return {
        ...state,
        importId: event.importId,
        settings: event.settings,
        corpus,
        derived: derive(corpus, state.marks),
      };
    }
    case "settings": {
      if (!state.importId) return { ...state, settings: event.settings };
      const corpus = env.corpus(state.importId, event.settings);
      return { ...state, settings: event.settings, corpus, derived: derive(corpus, state.marks) };
    }
    case "mark":
    case "unmark": {
      const marks = new Map(state.marks);
      if (event.kind === "mark") marks.set(event.word, event.as);
      else marks.delete(event.word);
      return { ...state, marks, derived: state.corpus ? derive(state.corpus, marks) : null };
    }
  }
}

export function replay(events: ChongEvent[], env: Env, upTo = events.length): MachineState {
  let state = EMPTY_STATE;
  for (let i = 0; i < upTo && i < events.length; i++) state = apply(state, events[i], env);
  return state;
}

/** What an event would do, without doing it. */
export function preview(state: MachineState, event: ChongEvent, env: Env): Effects {
  return diff(state.derived, apply(state, event, env).derived);
}

export function diff(a: Derived | null, b: Derived | null): Effects {
  const wordsAdded: string[] = [];
  const wordsRemoved: string[] = [];
  const unlocked: number[] = [];
  const relocked: number[] = [];
  const knownA = a?.known ?? new Set<string>();
  const knownB = b?.known ?? new Set<string>();
  for (const w of knownB) if (!knownA.has(w)) wordsAdded.push(w);
  for (const w of knownA) if (!knownB.has(w)) wordsRemoved.push(w);
  const openA = a?.unlocked ?? new Set<number>();
  const openB = b?.unlocked ?? new Set<number>();
  for (const id of openB) if (!openA.has(id)) unlocked.push(id);
  // A text that left the corpus (deleted in Pleco) hasn't been relocked.
  for (const id of openA) if (!openB.has(id) && b?.present.has(id)) relocked.push(id);
  return { wordsAdded, wordsRemoved, unlocked, relocked, before: a?.counts ?? null, after: b?.counts ?? null };
}

/**
 * Everything that follows from the corpus and your marks: which words are
 * known, what blocks each text, which texts are readable.
 *
 * A word counts as known if it is one of yours, or if it splits entirely into
 * words that are — 这个 is known when 这 and 个 are, 孩子们 when 孩子 and 们 are.
 * When a word isn't known, the blame goes to the part you'd actually learn:
 * 孩子们 is blocked by 孩子. A word that doesn't break into words from your
 * Pleco data (约翰, most names) is blamed whole.
 */
export function derive(corpus: Corpus, marks: Map<string, MarkReason>): Derived {
  const known = new Set<string>();
  let knownByCategory = 0;
  let knownByScore = 0;
  for (const w of corpus.words.values()) {
    if (!w.known) continue;
    known.add(w.w);
    if (w.inKnownCategory) knownByCategory++;
    else knownByScore++;
  }
  let markedKnown = 0;
  let names = 0;
  for (const [w, why] of marks) {
    known.add(w);
    if (why === "name") names++;
    else markedKnown++;
  }

  const readableMemo = new Map<string, boolean>();
  const readable = (t: string): boolean => {
    if (known.has(t)) return true;
    const hit = readableMemo.get(t);
    if (hit !== undefined) return hit;
    const chars = [...t];
    // Erhua: 一点儿 reads as 一点 does.
    let ok = chars.length > 1 && chars[chars.length - 1] === "儿" && readable(chars.slice(0, -1).join(""));
    for (let k = 1; k < chars.length && !ok; k++) {
      ok = known.has(chars.slice(0, k).join("")) && readable(chars.slice(k).join(""));
    }
    readableMemo.set(t, ok);
    return ok;
  };

  const blameMemo = new Map<string, string[]>();
  const blame = (t: string): string[] => {
    if (corpus.words.has(t)) return [t];
    const hit = blameMemo.get(t);
    if (hit) return hit;
    // Fewest pieces drawn from your words and what you know; single
    // characters always allowed so there is always a split.
    const chars = [...t];
    const best: Array<string[] | null> = [[]];
    for (let i = 1; i <= chars.length; i++) {
      best[i] = null;
      for (let j = 0; j < i; j++) {
        const prev = best[j];
        if (!prev) continue;
        const piece = chars.slice(j, i).join("");
        if (i - j > 1 && !corpus.words.has(piece) && !known.has(piece)) continue;
        if (!best[i] || prev.length + 1 < best[i]!.length) best[i] = [...prev, piece];
      }
    }
    const unknown = (best[chars.length] ?? [t]).filter((p) => !readable(p));
    const out = unknown.length && unknown.every((p) => corpus.words.has(p)) ? unknown : [t];
    blameMemo.set(t, out);
    return out;
  };

  const blocking: string[][] = [];
  const unlocked = new Set<number>();
  const present = new Set<number>();
  const soleBlocker = new Map<string, number[]>();
  let oneAway = 0;
  let locked = 0;
  let studied = 0;
  corpus.texts.forEach((text, i) => {
    present.add(text.id);
    if (text.studied) studied++;
    const out = new Set<string>();
    for (const w of text.words) if (!readable(w)) for (const b of blame(w)) out.add(b);
    const list = [...out];
    blocking.push(list);
    if (list.length === 0) unlocked.add(text.id);
    else if (list.length === 1) {
      oneAway++;
      const ids = soleBlocker.get(list[0]);
      if (ids) ids.push(i);
      else soleBlocker.set(list[0], [i]);
    } else locked++;
  });

  return {
    known,
    blocking,
    unlocked,
    present,
    soleBlocker,
    counts: {
      knownWords: known.size,
      knownByCategory,
      knownByScore,
      markedKnown,
      names,
      texts: corpus.texts.length,
      studied,
      unlocked: unlocked.size,
      oneAway,
      locked,
    },
  };
}

export interface Suggestion {
  word: string;
  /** Texts this word alone is blocking. */
  unlocks: number;
  /** Numbered pinyin from its Pleco card, when it has one. */
  pron: string | null;
}

/**
 * Words worth learning next — from your own lists, ranked by how many texts
 * each would unlock — and the other words blocking texts, which are mostly
 * names and rarities to mark rather than learn.
 */
export function suggestions(state: MachineState): { learnNext: Suggestion[]; blockers: Suggestion[] } {
  const learnNext: Suggestion[] = [];
  const blockers: Suggestion[] = [];
  if (!state.corpus || !state.derived) return { learnNext, blockers };
  for (const [word, ids] of state.derived.soleBlocker) {
    const entry = state.corpus.words.get(word);
    const s = { word, unlocks: ids.length, pron: entry?.prons[0] ?? null };
    if (entry?.inList) learnNext.push(s);
    else blockers.push(s);
  }
  const order = (a: Suggestion, b: Suggestion) => b.unlocks - a.unlocks || a.word.localeCompare(b.word, "zh");
  learnNext.sort(order);
  blockers.sort(order);
  return { learnNext, blockers };
}
