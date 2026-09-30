// A deliberately small spaced-repetition schedule.
//
// Every word has a due date. Once a word is known it's kept to whole local
// days: due from the midnight that starts its day, so "due tomorrow" means
// tomorrow however late tonight you played it. A word still being learned —
// just banked, or just missed — comes back the same day instead, at a time.
// The chain game only requires words that are due.
//
// The interval isn't stored. It's read off two things already kept: the
// word's strength, the evidence-weighted measure of how well it's known, and
// how long ago it was last in front of you. Strength sets the long-run
// ladder — each recall raises it and so lengthens the next gap, a hinted
// recall raises it less, and a miss lowers it. The gap caps it, so a word
// that has only shown it survives ten minutes isn't trusted with a day.

import type { BankEntry } from "./store";

const DAY = 86_400_000;
const MINUTE = 60_000;

/**
 * Days until next due, by strength after the outcome.
 *
 * Deliberately short: seeing a word a day early costs a few seconds, and
 * seeing it a week late means relearning it. Strength climbs 0.4 → 0.64 →
 * 0.78 → 0.87 → 0.92 → 0.95 → 0.97 over clean recalls a day or more apart, so
 * a word recalled every time it comes up is seen after 1, 2, 3, 5, 8, 13 and
 * then 21 days — roughly half the gaps of a textbook schedule.
 */
const LADDER: Array<[below: number, days: number]> = [
  [0.5, 1],
  [0.7, 2],
  [0.8, 3],
  [0.9, 5],
  [0.93, 8],
  [0.96, 13],
];
const MAX_DAYS = 21;

export function intervalDays(strength: number): number {
  for (const [below, days] of LADDER) if (strength < below) return days;
  return MAX_DAYS;
}

/** The first step for a word just banked, or just shown after a miss. */
export const FIRST_STEP = 10 * MINUTE;
/** Each step is at most this many times the gap the word just survived. */
const GROWTH = 4;

/**
 * When a word falls due after an outcome at `now`.
 *
 * Whichever comes first of two limits. One is the ladder, by strength. The
 * other is GROWTH times the gap the word just survived — `seen`, the last time
 * it was in front of you, or when it was banked if it never has been. A word
 * recalled a minute after you banked it has shown it lasts a minute, not a
 * day, so it's back in ten minutes, then forty, then under three hours, and
 * only reaches the ladder once the gaps it has survived are day-sized.
 *
 * For a word last seen days ago the ladder is always the nearer limit, so this
 * only ever pulls in words that are new, just missed, or played early.
 *
 * Only a step that lands later today keeps its time. One that runs past today
 * is due from the midnight that starts its day, as the ladder's are.
 */
export function scheduleRecall(now: number, strength: number, seen: number): number {
  const ladder = daysAfter(now, intervalDays(strength));
  const at = now + Math.max(FIRST_STEP, GROWTH * Math.max(0, now - seen));
  const step = dayStart(at) > dayStart(now) ? dayStart(at) : at;
  return Math.min(ladder, step);
}

/**
 * When a word falls due after being played only once it was shown.
 *
 * It wasn't recalled, so it has survived no gap at all: back to the first
 * step, while what you just read is still there to be retrieved.
 */
export function scheduleShown(now: number): number {
  return now + FIRST_STEP;
}

/** Local midnight at the start of the day holding `ms`. */
export function dayStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Local midnight `days` days after the day holding `from`. */
export function daysAfter(from: number, days: number): number {
  const d = new Date(dayStart(from));
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/**
 * When a word is due.
 *
 * Words scheduled since the SRS arrived carry `due`. Older ones are placed as
 * if the schedule had always existed: one interval, by their current strength,
 * after they were last recalled — or due now if they never have been.
 */
export function dueAt(e: BankEntry): number {
  if (e.due !== undefined) return e.due;
  if (!e.lastRecalled) return dayStart(e.added);
  return daysAfter(e.lastRecalled, intervalDays(e.strength ?? 0));
}

export function isDue(e: BankEntry, now = Date.now()): boolean {
  return dueAt(e) <= now;
}

/** Whole days until due: 0 when due now or later today, 1 for tomorrow. */
export function daysUntilDue(e: BankEntry, now = Date.now()): number {
  const due = dueAt(e);
  if (due <= now) return 0;
  return Math.round((dayStart(due) - dayStart(now)) / DAY);
}

/** Days overdue — 0 for a word due today or later. */
export function daysOverdue(e: BankEntry, now = Date.now()): number {
  const due = dueAt(e);
  if (due > now) return 0;
  return Math.max(0, Math.round((dayStart(now) - dayStart(due)) / DAY));
}

/** The soonest moment after `now` that any word falls due, or Infinity. */
export function nextDueAt(bank: Record<string, BankEntry>, now = Date.now()): number {
  let next = Infinity;
  for (const e of Object.values(bank)) {
    const due = dueAt(e);
    if (due > now && due < next) next = due;
  }
  return next;
}

/** "in 10 minutes", "in about 3 hours" — for a moment later today. */
export function inWords(ms: number): string {
  const min = Math.max(1, Math.ceil(ms / MINUTE));
  if (min < 60) return `in ${min} minute${min === 1 ? "" : "s"}`;
  const h = Math.round(min / 60);
  return `in about ${h} hour${h === 1 ? "" : "s"}`;
}
