// When a word next needs to come up, and what today's session is made of.
//
// Nothing new is recorded to make this work. `strength` is already an
// exponential moving average over outcomes and `lastSeen` is already the last
// time a word was put under a prompt, so an interval is a pure function of
// what the bank holds — no scheduler state to keep in sync with the evidence,
// and no way for the two to disagree.
//
// This replaces "a sweep is the whole bank" as the thing that ends a session.
// That rule made a session exactly as long as the corpus you had built, so the
// app charged you at play time for every word you had ever added. What's due
// is bounded by what you've forgotten instead, which settles at a few dozen
// words a day however large the bank grows.

import type { BankEntry } from "./store";

export const DAY_MS = 86_400_000;

/**
 * Interval for a word whose strength is zero — a new word, or one just missed.
 *
 * Ten hours rather than minutes: a word missed this morning is worth another
 * look tomorrow, not three more looks before lunch. The spacing damping in the
 * store makes those extra looks nearly worthless anyway.
 */
const BASE_DAYS = 0.42;

/**
 * How sharply the interval stretches as strength approaches 1.
 *
 * Strength saturates — the moving average reaches 0.4, 0.64, 0.78, 0.87, 0.92
 * over five clean recalls — so an exponential in strength flattens out exactly
 * where the intervals should be growing fastest. Stretching 1/(1−s) instead
 * keeps the ratio roughly constant per recall, which is what a review schedule
 * wants: those five recalls come out at about 1, 2.4, 6, 15 and 35 days.
 */
const STRETCH = 1.75;

/** Nothing waits longer than this, however well known. */
const MAX_DAYS = 180;

/** Most words one session will ask for, however many have come due. */
export const DAILY_CAP = 20;

/** How long a word should rest, in days, at the given strength. */
export function intervalDays(strength: number): number {
  // Clamped below 1 so the reciprocal stays finite; the cap catches the rest.
  const s = Math.min(Math.max(strength, 0), 0.985);
  return Math.min(MAX_DAYS, BASE_DAYS * Math.pow(1 / (1 - s), STRETCH));
}

/**
 * When a word comes due, in epoch ms.
 *
 * A word that has never been under a prompt is due now whatever its strength:
 * adding it to the bank says you mean to learn it, and nothing has tested that
 * yet. Everything else rests from when it was last *seen* rather than last
 * recalled, so a miss — which lowers strength and stamps lastSeen — shortens
 * the wait instead of leaving the word parked on its old schedule.
 */
export function dueAt(e: BankEntry): number {
  if (!e.lastSeen) return 0;
  return e.lastSeen + intervalDays(e.strength ?? 0) * DAY_MS;
}

export function isDue(e: BankEntry, now: number): boolean {
  return dueAt(e) <= now;
}

/** How long a word is past due, in ms. Negative when it is still resting. */
export function overdueBy(e: BankEntry, now: number): number {
  return now - dueAt(e);
}

export function dueWords(bank: BankEntry[], now: number): BankEntry[] {
  return bank.filter((e) => isDue(e, now));
}

/** When the next word comes due, or null if none ever will (empty bank). */
export function nextDueAt(bank: BankEntry[], now: number): number | null {
  let soonest: number | null = null;
  for (const e of bank) {
    const at = dueAt(e);
    if (at <= now) return now;
    if (soonest === null || at < soonest) soonest = at;
  }
  return soonest;
}

/** Rough, friendly gap — "in 3 hours", "tomorrow". */
export function untilText(at: number, now: number): string {
  const ms = at - now;
  if (ms <= 0) return "now";
  const hours = ms / 3_600_000;
  if (hours < 1) return `in ${Math.max(1, Math.round(ms / 60_000))} min`;
  if (hours < 24) return `in ${Math.round(hours)}h`;
  const days = hours / 24;
  if (days < 2) return "tomorrow";
  if (days < 30) return `in ${Math.round(days)} days`;
  return `in ${Math.round(days / 30)} months`;
}

export interface Bucket {
  syl: string;
  words: BankEntry[];
}

export interface SessionPlan {
  /** Buckets in the order they'll be drilled. */
  buckets: Bucket[];
  /** Every word in the session, in the order it will be asked for. */
  words: string[];
  /** Due words left out because the cap was reached. */
  heldBack: number;
  /** True when nothing was due and the plan was built from the weakest words. */
  forced: boolean;
}

/**
 * Build a session: the due words, grouped into buckets and capped.
 *
 * Buckets are drained whole — every due word for one syllable before the next
 * — so the cap is applied in whole buckets rather than cutting one in half.
 * At least one bucket always comes back, even if it is larger than the cap: a
 * session that asks for nothing is worse than one that runs a little long.
 *
 * `force` builds a plan from the weakest words when nothing is due, so opening
 * the app out of schedule still gives you something to do.
 */
export function planSession(
  bank: BankEntry[],
  now: number,
  cap: number = DAILY_CAP,
  force = false,
): SessionPlan {
  const due = dueWords(bank, now);
  const forced = due.length === 0 && force;
  const pool = forced
    ? [...bank].sort((a, b) => (a.strength ?? 0) - (b.strength ?? 0)).slice(0, cap * 2)
    : due;

  if (pool.length === 0) {
    return { buckets: [], words: [], heldBack: 0, forced: false };
  }

  const byFs = new Map<string, BankEntry[]>();
  for (const e of pool) {
    const list = byFs.get(e.fs) ?? [];
    list.push(e);
    byFs.set(e.fs, list);
  }
  // Within a bucket, the most overdue word first — that ordering is what the
  // word list already calls "weakest first", arrived at from the other side.
  for (const list of byFs.values()) {
    list.sort((a, b) => overdueBy(b, now) - overdueBy(a, now) || a.w.localeCompare(b.w));
  }

  /** A bucket is as urgent as the word in it that has waited longest. */
  const urgency = (syl: string) =>
    Math.max(...byFs.get(syl)!.map((e) => overdueBy(e, now)));

  const buckets: Bucket[] = [];
  let taken = 0;
  /** Syllables anything drilled so far ends on — where a chain could go next. */
  const reachable = new Set<string>();

  while (byFs.size > 0) {
    // Prefer a bucket something already drilled can chain into. It's the same
    // set of words either way — they were all due — but consecutive buckets
    // that link make the log's forest come out with some depth in it, which is
    // the whole point of drawing a forest. Urgency decides when nothing links,
    // and among several links, the most urgent of those.
    const linked = [...byFs.keys()].filter((s) => reachable.has(s));
    const candidates = linked.length > 0 ? linked : [...byFs.keys()];
    const syl = candidates.sort(
      (a, b) => urgency(b) - urgency(a) || a.localeCompare(b),
    )[0];

    const words = byFs.get(syl)!;
    byFs.delete(syl);
    // Always take the first bucket; after that, stop rather than overshoot.
    if (buckets.length > 0 && taken + words.length > cap) break;
    buckets.push({ syl, words });
    taken += words.length;
    for (const e of words) if (e.ls) reachable.add(e.ls);
    if (taken >= cap) break;
  }

  const chosen = new Set(buckets.flatMap((b) => b.words.map((e) => e.w)));
  return {
    buckets,
    words: buckets.flatMap((b) => b.words.map((e) => e.w)),
    heldBack: due.filter((e) => !chosen.has(e.w)).length,
    forced,
  };
}
