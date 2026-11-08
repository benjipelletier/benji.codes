// Card state and answer stats. The schedule itself is the drill's
// (lib/drill.ts): a card is solid once it's right and fast several times in a
// row and in a ii–V–I. Everything here runs on the device, so reviews work
// with no connection.

import type { Attempt, Mode, Settings, SrsState } from './types';
import { srsKey } from './types';

/**
 * Time allowed per tap, always on a phone (the owner: "that's 2 seconds to
 * click all the notes … here I'm clicking them in sequence"; no calibration:
 * "we're always going to assume I'm typing it on a phone").
 */
export const TAP_MS: Record<Mode, number> = { play: 350, spell: 300, name: 300 };

/** Taps a card takes: Play a key a note (and the move), Spell a letter a note plus one per accidental, Name the chord type (its root is given). */
export function tapsFor(v: { notes: string[]; top_move: string | null }, mode: Mode): number {
  const notes = [...v.notes, ...(v.top_move ? [v.top_move] : [])];
  if (mode === 'play') return notes.length;
  if (mode === 'spell') return notes.reduce((n, s) => n + 1 + (s.slice(1).match(/[b#]/g)?.length ?? 0), 0);
  return 1;
}

/**
 * A card's target: its own, if set on its sheet; else the mode's thinking
 * time (Settings) plus its taps at TAP_MS — so a 5-note voicing, or one spelled
 * with flats, gets the time its typing takes, and slow means not knowing it.
 */
/**
 * A MIDI keyboard (lib/midi.ts) plays a chord at once (the owner: "when connected to a midi
 * keyboard I'll be able to play the voicings a lot faster"): a Play card answered on one is
 * allowed the thinking time plus `MIDI_CHORD_MS` for the whole chord, and `MIDI_MOVE_MS` more
 * for a move, rather than `TAP_MS` a key. Am7 drop-2 at a 2 s thinking time: 2.5 s, not 3.4 s.
 */
export const MIDI_CHORD_MS = 500;
export const MIDI_MOVE_MS = 300;

/** How much less typing a Play card takes on a MIDI keyboard than tapped on a phone (0 for Spell and Name). */
export function midiShift(v: { notes: string[]; top_move: string | null }, mode: Mode): number {
  if (mode !== 'play') return 0;
  return tapsFor(v, 'play') * TAP_MS.play - (MIDI_CHORD_MS + (v.top_move ? MIDI_MOVE_MS : 0));
}

/**
 * A card's target for an answer on a MIDI keyboard: its usual target less the typing it
 * saves. A card's own target keeps its thinking time the same way.
 */
export function midiTarget(target: number, v: { notes: string[]; top_move: string | null }, mode: Mode): number {
  return Math.max(MIDI_CHORD_MS, target - midiShift(v, mode));
}

export function targetFor(state: SrsState | undefined, mode: Mode, settings: Settings, v?: { notes: string[]; top_move: string | null }): number {
  if (state?.target_ms != null) return state.target_ms;
  return settings.target_ms[mode] + (v ? tapsFor(v, mode) * TAP_MS[mode] : 0);
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

/** Attempts grouped by card (voicing + mode), oldest first. Listen's answers aren't a card's: left out. */
/**
 * Answers by card, oldest first. An answer played on a MIDI keyboard is put on the phone's
 * clock — its time plus the typing it saved (`midiShift`) — so fast and slow, fluency, medians
 * and the context gap all judge it against its own target with the card's one target. Its
 * time as played stays in `played_ms`.
 */
export function groupAttempts(attempts: Attempt[], byId?: Map<string, { notes: string[]; top_move: string | null }>): Map<string, Attempt[]> {
  const out = new Map<string, Attempt[]>();
  const sorted = [...attempts].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const raw of sorted) {
    if (raw.mode === 'listen') continue;
    const v = raw.input === 'midi' ? byId?.get(raw.voicing_id) : undefined;
    const a = v ? { ...raw, response_ms: raw.response_ms + midiShift(v, raw.mode as Mode), played_ms: raw.response_ms } : raw;
    const k = srsKey(raw.voicing_id, raw.mode);
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

/** Fisher–Yates, in place. */
export function shuffle<T>(xs: T[]): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
}
