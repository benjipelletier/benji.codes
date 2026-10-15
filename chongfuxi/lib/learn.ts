// Learn's ladder, as pure functions: which word comes next, which sentence a
// step uses, and what passing or missing a step does. Used by
// components/Learn.tsx, in a review session (a step every fifth card) and in
// a list's drill; nothing here touches a schedule. Where each word is on the
// ladder is saved on its card as each step is taken (app/api/chongfuxi/learn.ts).
//
// Each word climbs its steps: meet it (pinyin, meaning, sentences; not a
// test), read it in a sentence, fill it into a gap, the word alone. A few
// words are in play at once and take turns, so a word comes back only after
// others, and the gap grows as it climbs. A miss puts it back a step and
// brings it back soon, with a sentence it hasn't been shown. Every step takes
// a sentence the word hasn't been shown with, while there is one.

import type { LearnSentence, LearnStep, LearnStepDone, LearnWord } from "./api";

/** Words on the ladder at once; the rest wait their turn to be met. */
export const IN_PLAY = 5;
/** The ladder in order: a word without sentences skips reading one. */
const LADDER: LearnStep[] = ["meet", "context", "cloze", "word"];
/** Turns before a word comes back, by the step it comes back for. */
const GAP: Record<LearnStep, number> = {
  meet: 0,
  context: 2,
  cloze: 4,
  word: 7,
};
/** Turns before a missed word comes back. */
const AFTER_MISS = 2;

export interface LearnItem {
  word: LearnWord;
  /** The steps it takes: no reading in context without a sentence to read. */
  steps: LearnStep[];
  /** How far up its steps it is; `steps.length` once learned. */
  at: number;
  /** The turn it may come back on. */
  dueAt: number;
  misses: number;
  /** Steps passed here, for the progress bar. */
  passed: number;
  /** Sentences it has been shown with, oldest first. */
  shown: number[];
}

/** The words, each where it was left on the ladder: one part way up is due at once. */
export function startItems(words: LearnWord[]): LearnItem[] {
  return words.map((w) => {
    const steps = LADDER.filter((s) => s !== "context" || w.sentences.length > 0);
    // The saved step, or the next one this word takes (a word that had no sentence to read then).
    const at = w.step === null ? 0 : steps.findIndex((s) => LADDER.indexOf(s) >= LADDER.indexOf(w.step!));
    return { word: w, steps, at: at < 0 ? 0 : at, dueAt: 0, misses: 0, passed: 0, shown: [] };
  });
}

export const isLearned = (it: LearnItem) => it.at >= it.steps.length;
export const stepOf = (it: LearnItem): LearnStep =>
  it.steps[Math.min(it.at, it.steps.length - 1)];

/**
 * The word to show on this turn: one due back, the earliest first; else a new
 * one to meet, while fewer than IN_PLAY are in play; else the one due back
 * soonest. Never the word just shown while another is waiting. Null when all
 * are learned.
 */
export function pickNext(
  items: LearnItem[],
  turn: number,
  last: number | null,
): number | null {
  const open = items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => !isLearned(it));
  if (!open.length) return null;
  const playing = open.filter(({ it }) => it.at > 0);
  const waiting = open.filter(({ it }) => it.at === 0);
  const others = playing.filter(({ i }) => i !== last);
  const soonest = (xs: typeof open) =>
    xs.reduce((a, b) => (b.it.dueAt < a.it.dueAt ? b : a));
  const due = others.filter(({ it }) => it.dueAt <= turn);
  if (due.length) return soonest(due).i;
  if (waiting.length && playing.length < IN_PLAY) return waiting[0].i;
  if (others.length) return soonest(others).i;
  if (waiting.length) return waiting[0].i;
  return playing[0].i;
}

/**
 * The sentences a step is shown with. Meeting the word: up to two with a
 * translation, every word known first. Reading in context: one not shown
 * yet, every word known first. Filling the gap: one with a gap and a
 * translation, not shown yet if there is one. The word alone: none.
 */
export function sentencesFor(it: LearnItem): LearnSentence[] {
  const all = it.word.sentences;
  // Not shown yet first (in their order, best first), then the one shown longest ago.
  const rank = (x: LearnSentence) => it.shown.indexOf(x.id);
  const unknown = (x: LearnSentence) => Number(Boolean(x.unknown));
  switch (stepOf(it)) {
    case "meet":
      return [...all]
        .sort(
          (a, b) => Number(!a.en) - Number(!b.en) || unknown(a) - unknown(b),
        )
        .slice(0, 2);
    case "context":
      return [...all]
        .sort((a, b) => rank(a) - rank(b) || unknown(a) - unknown(b))
        .slice(0, 1);
    case "cloze":
      return all
        .filter((x) => x.blanked && x.en)
        .sort((a, b) => rank(a) - rank(b))
        .slice(0, 1);
    case "word":
      return [];
  }
}

/**
 * After a step: met, passed or missed on `turn`, shown with `sentences`.
 * Passing climbs a step and comes back after a longer gap; missing goes back
 * a step (never to meeting it again) and comes back soon.
 */
export function afterStep(
  it: LearnItem,
  grade: "seen" | "good" | "forgot",
  turn: number,
  sentences: LearnSentence[],
): LearnItem {
  const step = stepOf(it);
  const shown = [
    ...it.shown.filter((id) => !sentences.some((s) => s.id === id)),
    ...sentences.map((s) => s.id),
  ];
  if (grade === "forgot") {
    return {
      ...it,
      at: Math.max(1, it.at - 1),
      dueAt: turn + AFTER_MISS,
      misses: it.misses + 1,
      shown,
    };
  }
  const at = it.at + 1;
  const next = it.steps[at];
  return { ...it, at, dueAt: turn + (next ? GAP[next] : 0), passed: it.passed + 1, shown };
}

/** The step just taken, to be saved: `before` and `after` are the word either side of it. */
export function stepDone(
  before: LearnItem,
  after: LearnItem,
  grade: "seen" | "good" | "forgot",
  sentences: LearnSentence[],
  id: string,
): LearnStepDone {
  return {
    id,
    card: before.word.card,
    word: before.word.word,
    step: stepOf(before),
    sentence: sentences[0]?.id ?? null,
    grade,
    next: isLearned(after) ? null : stepOf(after),
  };
}

/** Steps passed, and steps passed plus steps still to climb, for the progress bar. */
export function progressOf(items: LearnItem[]): {
  done: number;
  total: number;
} {
  const done = items.reduce((n, it) => n + it.passed, 0);
  const left = items.reduce(
    (n, it) => n + Math.max(0, it.steps.length - it.at),
    0,
  );
  return { done, total: done + left };
}
