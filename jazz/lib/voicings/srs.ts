// Scheduling, scored by speed as much as by accuracy: a card counts as
// learned only when it is answered right and under its target time. Right
// but slow is a weak pass and comes back sooner. Everything here runs on
// the device, so reviews work with no connection.

import type { Attempt, Mode, Settings, SrsState, Voicing } from './types';
import { srsKey } from './types';

const DAY = 86_400_000;
const MIN_EASE = 1.3;
const MAX_EASE = 3.0;
const MAX_INTERVAL = 180;

export type Outcome = 'good' | 'weak' | 'fail';

export function targetFor(state: SrsState | undefined, mode: Mode, settings: Settings): number {
  return state?.target_ms ?? settings.target_ms[mode];
}

export function outcomeOf(correct: boolean, ms: number, target: number): Outcome {
  if (!correct) return 'fail';
  return ms <= target ? 'good' : 'weak';
}

export function newState(voicingId: string, mode: Mode, now: Date): SrsState {
  const t = now.toISOString();
  return {
    voicing_id: voicingId,
    mode,
    ease: 2.5,
    interval_days: 0,
    due_at: t,
    target_ms: null,
    learned: false,
    reps: 0,
    lapses: 0,
    created_at: t,
    updated_at: t,
  };
}

/**
 * The next schedule after one review answer.
 * - fail: back in 10 minutes, ease down, no longer learned.
 * - weak (right, slow): a shorter step than a good pass — 6 hours while
 *   learning, else 1.2× the interval.
 * - good (right, in time): 1 day, 3 days, then interval × ease; a very fast
 *   answer (under 60% of the target) raises the ease.
 * A card flagged for its context gap (fast in a progression, slow on its
 * own) takes half the step, so it comes back more often in isolation.
 */
export function schedule(prev: SrsState, outcome: Outcome, ms: number, target: number, now: Date, flagged = false): SrsState {
  let { ease, interval_days: interval, lapses } = prev;
  let learned = prev.learned;
  let dueMs: number;
  if (outcome === 'fail') {
    ease = Math.max(MIN_EASE, ease - 0.2);
    interval = 0;
    lapses += 1;
    learned = false;
    dueMs = 10 * 60_000;
  } else {
    if (outcome === 'weak') {
      ease = Math.max(MIN_EASE, ease - 0.05);
      interval = interval < 1 ? 0.25 : Math.max(1, interval * 1.2);
    } else {
      interval = interval < 1 ? 1 : interval < 3 ? 3 : interval * ease;
      if (ms < target * 0.6) ease = Math.min(MAX_EASE, ease + 0.05);
      learned = true;
    }
    if (flagged) interval = Math.max(outcome === 'weak' ? 0.125 : 0.5, interval / 2);
    interval = Math.min(MAX_INTERVAL, interval);
    dueMs = interval * DAY;
  }
  return {
    ...prev,
    ease: Math.round(ease * 100) / 100,
    interval_days: Math.round(interval * 1000) / 1000,
    due_at: new Date(now.getTime() + dueMs).toISOString(),
    learned,
    reps: prev.reps + 1,
    lapses,
    updated_at: now.toISOString(),
    dirty: true,
  };
}

/** Bring a card into the next review now (a slow or missed answer in a practice run). */
export function dueNow(prev: SrsState, now: Date): SrsState {
  if (new Date(prev.due_at).getTime() <= now.getTime()) return prev;
  return { ...prev, due_at: now.toISOString(), updated_at: now.toISOString(), dirty: true };
}

// ── stats ───────────────────────────────────────────────────────────────

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export interface ModeStats {
  attempts: number;
  correct: number;
  /** Mean time of right answers, ms. */
  avgMs: number | null;
  /** Medians of the last 10 right answers, on its own and in a progression or tune. */
  isolatedMs: number | null;
  contextMs: number | null;
  isolatedN: number;
  contextN: number;
}

const RECENT = 10;
const MIN_FOR_GAP = 3;

/** Attempts grouped by card (voicing + mode), oldest first. */
export function groupAttempts(attempts: Attempt[]): Map<string, Attempt[]> {
  const out = new Map<string, Attempt[]>();
  const sorted = [...attempts].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const a of sorted) {
    const k = srsKey(a.voicing_id, a.mode);
    let list = out.get(k);
    if (!list) out.set(k, (list = []));
    list.push(a);
  }
  return out;
}

export function modeStats(list: Attempt[] | undefined): ModeStats {
  const all = list ?? [];
  const right = all.filter(a => a.correct);
  const iso = right.filter(a => a.context_type === 'isolated').slice(-RECENT).map(a => a.response_ms);
  const ctx = right.filter(a => a.context_type !== 'isolated').slice(-RECENT).map(a => a.response_ms);
  return {
    attempts: all.length,
    correct: right.length,
    avgMs: right.length ? Math.round(right.reduce((s, a) => s + a.response_ms, 0) / right.length) : null,
    isolatedMs: median(iso),
    contextMs: median(ctx),
    isolatedN: iso.length,
    contextN: ctx.length,
  };
}

/**
 * The context gap: fast in context but slow on its own. Flagged when both
 * have at least three recent right answers, the isolated median is over the
 * target, and it is at least 25% slower than in context.
 */
export function hasContextGap(stats: ModeStats, target: number): boolean {
  if (stats.isolatedN < MIN_FOR_GAP || stats.contextN < MIN_FOR_GAP) return false;
  const iso = stats.isolatedMs!;
  const ctx = stats.contextMs!;
  return iso > target && iso >= ctx * 1.25;
}

// ── the review queue ────────────────────────────────────────────────────

export interface Card {
  voicing: Voicing;
  mode: Mode;
}

/** Start of the device's day. */
function startOfDay(now: Date): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export interface Queue {
  due: Card[];
  fresh: Card[];
  /** Flagged for the context gap and pulled in early. */
  gap: Card[];
  newToday: number;
}

/**
 * Today's review: every card due now (soonest first), the context-gap cards
 * due within two days (pulled in early), then new cards up to the day's
 * limit, in the library's order — one mode of a voicing a day, so a new
 * voicing isn't met three times in a row.
 */
export function buildQueue(o: {
  voicings: Voicing[];
  srs: Map<string, SrsState>;
  gapKeys: Set<string>;
  settings: Settings;
  now: Date;
}): Queue {
  const { voicings, srs, gapKeys, settings, now } = o;
  const byId = new Map(voicings.map(v => [v.id, v]));
  const modes = new Set(settings.review_modes);
  const t = now.getTime();
  const soon = t + 2 * 86_400_000;
  const due: { card: Card; at: number }[] = [];
  const gap: Card[] = [];
  let newToday = 0;
  const today = startOfDay(now);
  for (const s of srs.values()) {
    if (new Date(s.created_at).getTime() >= today && s.reps > 0) newToday++;
    const v = byId.get(s.voicing_id);
    if (!v || !modes.has(s.mode)) continue;
    const at = new Date(s.due_at).getTime();
    if (at <= t) due.push({ card: { voicing: v, mode: s.mode }, at });
    else if (at <= soon && gapKeys.has(srsKey(v.id, s.mode))) gap.push({ voicing: v, mode: s.mode });
  }
  due.sort((a, b) => a.at - b.at);

  const fresh: Card[] = [];
  const room = Math.max(0, settings.new_per_day - newToday);
  if (room > 0) {
    const sorted = [...voicings].sort((a, b) => a.sort_order - b.sort_order || a.chord_label.localeCompare(b.chord_label));
    const order = settings.review_modes;
    // First the voicings already started (their next mode), then new ones.
    // A voicing that met a mode for the first time today waits for tomorrow.
    const partial: Card[] = [];
    const untouched: Card[] = [];
    sorted.forEach((v, i) => {
      const seen = order.map(m => srs.get(srsKey(v.id, m))).filter((s): s is SrsState => !!s);
      // Each voicing starts on a different mode, so new cards come mixed.
      const unseen = [...order.slice(i % order.length), ...order.slice(0, i % order.length)].filter(m => !srs.has(srsKey(v.id, m)));
      if (!unseen.length) return;
      if (!seen.length) untouched.push({ voicing: v, mode: unseen[0] });
      else if (seen.every(s => new Date(s.created_at).getTime() < today)) partial.push({ voicing: v, mode: unseen[0] });
    });
    fresh.push(...[...partial, ...untouched].slice(0, room));
  }
  return { due: due.map(d => d.card), fresh, gap, newToday };
}

/** Fisher–Yates, in place. */
export function shuffle<T>(xs: T[]): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
}
