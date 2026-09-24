// A deliberately small spaced-repetition schedule.
//
// Every word has a due date, kept to whole local days: a word is due from the
// midnight that starts its day, so "due tomorrow" means tomorrow however late
// tonight you played it. The chain game only requires words that are due.
//
// The interval isn't stored. It is read off the word's strength, which is
// already the evidence-weighted measure of how well it's known: each recall
// raises strength and so lengthens the next gap, a hinted recall raises it less,
// and a miss lowers it. That keeps one number as the model instead of two that
// could disagree.

import type { BankEntry } from "./store";

const DAY = 86_400_000;

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

/** Whole days until due: 0 when due now (or overdue), 1 for tomorrow. */
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
