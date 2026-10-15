// Learn's drill, as pure functions: which word comes next, which sentence a
// step uses, and what passing or missing a step does. Used by
// components/Learn.tsx; nothing here touches a schedule.
//
// Each word climbs its steps: meet it (pinyin, meaning, sentences; not a
// test), read it in a sentence, fill it into a gap, the word alone. A few
// words are in play at once and take turns, so a word comes back only after
// others, and the gap grows as it climbs. A miss puts it back a step and
// brings it back soon, with a sentence it hasn't been shown. Every step takes
// a sentence the word hasn't been shown with, while there is one.

import type { LearnResult, LearnSentence, LearnStep, LearnWord } from "./api";

/** Words being learned at once; the rest wait their turn to be met. */
export const IN_PLAY = 4;
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
  /** Sentences it has been shown with, oldest first. */
  shown: number[];
  log: LearnResult["steps"];
}

export function startItems(words: LearnWord[]): LearnItem[] {
  return words.map((w) => ({
    word: w,
    steps: [
      "meet",
      ...(w.sentences.length ? (["context"] as const) : []),
      "cloze",
      "word",
    ],
    at: 0,
    dueAt: 0,
    misses: 0,
    shown: [],
    log: [],
  }));
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
  const log = [...it.log, { step, sentence: sentences[0]?.id ?? null, grade }];
  if (grade === "forgot") {
    return {
      ...it,
      at: Math.max(1, it.at - 1),
      dueAt: turn + AFTER_MISS,
      misses: it.misses + 1,
      shown,
      log,
    };
  }
  const at = it.at + 1;
  const next = it.steps[at];
  return { ...it, at, dueAt: turn + (next ? GAP[next] : 0), shown, log };
}

/** What is logged for a learned word. */
export const resultOf = (it: LearnItem): LearnResult => ({
  card: it.word.card,
  word: it.word.word,
  misses: it.misses,
  steps: it.log,
});

/** Steps passed, and steps passed plus steps still to climb, for the progress bar. */
export function progressOf(items: LearnItem[]): {
  done: number;
  total: number;
} {
  const done = items.reduce(
    (n, it) => n + it.log.filter((l) => l.grade !== "forgot").length,
    0,
  );
  const left = items.reduce(
    (n, it) => n + Math.max(0, it.steps.length - it.at),
    0,
  );
  return { done, total: done + left };
}
