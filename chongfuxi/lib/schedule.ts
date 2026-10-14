// When a card comes back. FSRS, through ts-fsrs, with two buttons.
//
// "Got it" is FSRS's Good and "Forgot" is its Again. There are no same-day
// steps: every answer sends the card at least a day away, which fits the rule
// that cards of one word never meet on the same day. Intervals are fuzzed a
// little so cards seeded together don't come back together, and the fuzz is
// seeded by the answer itself, so replaying the review log gives the same
// dates.
//
// A schedule is plain numbers (times in ms) so it stores as a row and as JSON.

import { fsrs, generatorParameters, Rating, State, type Card } from "ts-fsrs";
import type { PlecoSeed } from "./pleco";

/** Recorded with every review: change it whenever the result for the same inputs would change. */
export const SCHEDULER = "ts-fsrs-5.4/r0.90/long/fuzz";

export type Grade = "forgot" | "good";
export type CardKind = "read" | "produce" | "sentence";

export interface Schedule {
  /** 0 new, 2 review (ts-fsrs's State). */
  state: number;
  due: number;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  scheduledDays: number;
  lastReview: number | null;
}

const DAY = 86_400_000;

const scheduler = fsrs(
  generatorParameters({ request_retention: 0.9, maximum_interval: 36500, enable_fuzz: true, enable_short_term: false }),
);

function toCard(s: Schedule): Card {
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: 0,
    scheduled_days: s.scheduledDays,
    learning_steps: 0,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state as State,
    last_review: s.lastReview === null ? undefined : new Date(s.lastReview),
  };
}

function fromCard(c: Card): Schedule {
  return {
    state: c.state,
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    reps: c.reps,
    lapses: c.lapses,
    scheduledDays: c.scheduled_days,
    lastReview: c.last_review ? c.last_review.getTime() : null,
  };
}

/** Never seen anywhere: due now. */
export function newSchedule(at: number): Schedule {
  return { state: State.New, due: at, stability: 0, difficulty: 0, reps: 0, lapses: 0, scheduledDays: 0, lastReview: null };
}

/**
 * The most a card can start with, in days. Pleco's top score stands for 512
 * days, and FSRS would take that at its word: one right answer here and the
 * word is gone for three years. Capped, a word known for years comes back in
 * about six months after its first right answer, and earns the rest here.
 */
export const SEED_CAP_DAYS = 60;

/**
 * Where a card starts, given what Pleco knew.
 *
 * Pleco's score is its interval in hundredths of a day (100 is a day, 51200 —
 * its ceiling — 512 days), which is what FSRS calls stability at 90%
 * retention, so it carries over, up to the cap. Difficulty comes from how
 * often the card was got wrong.
 *
 * Every seeded card is due the moment it is made, and is treated as exactly
 * due: its last review is set one stability back, whatever Pleco's own date
 * was. The owner sees everything once and the schedule is earned from there;
 * the real gap since Pleco last showed a card (often years) would otherwise be
 * read as proof of a very strong memory. Pleco's own dates stay on the word.
 *
 * Recalling a word is harder than recognising it, so a Produce card starts a
 * step lower: half the stability. A card Pleco never tested starts new.
 */
export function seedSchedule(pleco: PlecoSeed | null, kind: CardKind, at: number): Schedule {
  if (!pleco || !pleco.last || !pleco.score) return newSchedule(at);
  const stability = Math.min(Math.max(pleco.score / 100, 0.5), SEED_CAP_DAYS) * (kind === "produce" ? 0.5 : 1);
  const total = pleco.correct + pleco.incorrect;
  const difficulty = total ? Math.min(Math.max(3 + (12 * pleco.incorrect) / total, 1), 10) : 5;
  return {
    state: State.Review,
    due: at,
    stability,
    difficulty,
    reps: pleco.reviewed,
    lapses: pleco.incorrect,
    scheduledDays: Math.max(1, Math.round(stability)),
    lastReview: Math.round(at - stability * DAY),
  };
}

export function answer(s: Schedule, grade: Grade, at: number): Schedule {
  return fromCard(scheduler.next(toCard(s), new Date(at), grade === "good" ? Rating.Good : Rating.Again).card);
}

/** Days until the card would come back for each button — shown on the buttons. */
export function intervals(s: Schedule, at: number): Record<Grade, number> {
  const days = (g: Grade) => Math.max(1, Math.round((answer(s, g, at).due - at) / DAY));
  return { good: days("good"), forgot: days("forgot") };
}
