// Review as drilling (the owner: "seeing one voicing, getting it wrong then
// not seeing it for another day … seems not that useful"). A voicing is a
// motor skill more than a fact, so a session is a small set of cards drilled
// until each is right and fast several times in a row, then played in a
// ii–V–I, and only then spaced out.
//
//  1. The set: the shakiest cards first (in the deck, answered before, not
//     solid — lowest fluency first), then solid cards due a check; if that's
//     not enough, solid cards ahead of their check, soonest first. New cards
//     roll in (the owner: "only show new cards once those are fast enough"):
//     NEW_AT_ONCE in play at a time, the next joining when one gets fast,
//     NEW_PER_SET in a session, in the order added.
//  2. The drill: the set's cards, mixed. A miss or a slow answer comes back
//     two cards later; a fast one a little later each time. A card leaves the
//     set after FLUENT_STREAK right-and-fast answers in a row — a solid
//     card's check after one, unless it misses — or after MAX_ASKS, still
//     shaky.
//  3. In context: each card that came out fluent is played once in a ii–V–I
//     that has its chord. Slow or wrong there, it isn't solid yet.
//  4. The schedule: solid cards come back for a check after 1 day, 3, then
//     ×2.5; anything that isn't solid is due now and leads the next set.
//
// Practice runs feed it too: a deck card missed or slow in a run is no longer
// solid. Pure functions; the Review page keeps the state.

import { isIii, parseChordLabel } from './theory';
import { candidatesFor, voiceLead } from './practice';
import { srsKey, type Attempt, type Context, type Mode, type SrsState, type Voicing } from './types';

const DAY = 86_400_000;
/** Right and fast this many times in a row: fluent. */
export const FLUENT_STREAK = 3;
/** Asked this often without getting fluent: let it go for today, still shaky. */
export const MAX_ASKS = 10;
export const MAX_INTERVAL = 120;
/** Answers that make a card's fluency score. */
const RECENT = 6;
/** New cards being learned at once; the next joins when one of them leaves the set. */
export const NEW_AT_ONCE = 2;
/** New cards a session brings in at most. */
export const NEW_PER_SET = 5;
/** The family the drill never takes into a ii–V–I: heard in the wild, its own thing. */
const NO_CONTEXT_FAMILIES = new Set(['found']);

export type Why = 'shaky' | 'check' | 'new' | 'early';
export const WHY_LABEL: Record<Why, string> = { shaky: 'shaky', check: 'check', new: 'new', early: 'early check' };

export interface SetCard {
  voicing: Voicing;
  mode: Mode;
  why: Why;
  /** 0–1, from recent answers; null with none. */
  score: number | null;
}

/**
 * How fluent a card is: over its last answers (alone or in context), each
 * right one scores its target over its time (1 if in time), a miss 0.
 */
export function fluencyScore(list: Attempt[] | undefined, target: number): number | null {
  const recent = (list ?? []).slice(-RECENT);
  if (!recent.length) return null;
  return recent.reduce((s, a) => s + (a.correct ? Math.min(1, target / Math.max(1, a.response_ms)) : 0), 0) / recent.length;
}

export interface SetCounts {
  shaky: number;
  check: number;
  new: number;
  solid: number;
}

/** Today's set, and what's waiting. `pool`: the voicings the set-up allows. */
export function chooseSet(o: {
  pool: Voicing[];
  srs: Map<string, SrsState>;
  grouped: Map<string, Attempt[]>;
  gapKeys: Set<string>;
  modes: Mode[];
  targetOf: (v: Voicing, mode: Mode) => number;
  size: number;
  fresh: boolean;
  now: Date;
}): { set: SetCard[]; incoming: SetCard[]; counts: SetCounts; waiting: SetCard[] } {
  const { pool, srs, grouped, gapKeys, modes, targetOf, size, fresh, now } = o;
  const byId = new Map(pool.map(v => [v.id, v]));
  const t = now.getTime();
  const shaky: SetCard[] = [];
  const check: { c: SetCard; at: number }[] = [];
  const ahead: { c: SetCard; at: number }[] = [];
  const news: SrsState[] = [];
  let solid = 0;
  for (const s of srs.values()) {
    const v = byId.get(s.voicing_id);
    if (!v || !modes.includes(s.mode)) continue;
    const key = srsKey(v.id, s.mode);
    if (s.reps === 0) {
      news.push(s);
      continue;
    }
    const score = fluencyScore(grouped.get(key), targetOf(v, s.mode));
    const card = (why: Why): SetCard => ({ voicing: v, mode: s.mode, why, score });
    const at = new Date(s.due_at).getTime();
    // Fast in a progression but slow on its own (the context gap) counts as shaky.
    if (!s.learned || gapKeys.has(key)) shaky.push(card('shaky'));
    else {
      solid++;
      if (at <= t) check.push({ c: card('check'), at });
      else ahead.push({ c: card('early'), at });
    }
  }
  shaky.sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
  check.sort((a, b) => a.at - b.at);
  ahead.sort((a, b) => a.at - b.at);

  // New: in the order added; round by round each voicing's next mode, so one
  // voicing's three cards don't all land in the same set.
  const added = new Map<string, { v: Voicing; at: string; modes: Mode[] }>();
  for (const s of news) {
    const e = added.get(s.voicing_id);
    if (e) {
      e.modes.push(s.mode);
      if (s.created_at < e.at) e.at = s.created_at;
    } else added.set(s.voicing_id, { v: byId.get(s.voicing_id)!, at: s.created_at, modes: [s.mode] });
  }
  const order = [...added.values()].sort((a, b) => a.at.localeCompare(b.at) || a.v.sort_order - b.v.sort_order);
  const rounds: SetCard[][] = [[], [], []];
  order.forEach((e, i) => {
    const rot = [...modes.slice(i % modes.length), ...modes.slice(0, i % modes.length)].filter(m => e.modes.includes(m));
    rot.forEach((m, r) => rounds[r].push({ voicing: e.v, mode: m, why: 'new', score: null }));
  });
  const newCards = rounds.flat();

  const waiting = [...shaky, ...check.map(x => x.c), ...(fresh ? newCards : [])];
  // Shaky and checks take the set; new cards roll in behind (startDrill, refill),
  // with room kept for the first of them; early checks only fill what's left.
  const set = [...shaky, ...check.map(x => x.c)].slice(0, size);
  const incoming = fresh ? newCards.slice(0, NEW_PER_SET) : [];
  const room = size - set.length - Math.min(NEW_AT_ONCE, incoming.length);
  if (room > 0) set.push(...ahead.slice(0, room).map(x => x.c));
  return { set, incoming, counts: { shaky: shaky.length, check: check.length, new: newCards.length, solid }, waiting };
}

// ── the drill ───────────────────────────────────────────────────────────

export type Answer = 'fast' | 'slow' | 'miss';
export type SlotStatus = 'active' | 'fluent' | 'checked' | 'stuck';

export interface Slot {
  key: string;
  card: SetCard;
  /** Right-and-fast answers in a row it needs: 1 for a solid card's check, until it slips. */
  need: number;
  streak: number;
  asked: number;
  misses: number;
  slows: number;
  /** Not asked again before this turn, if anything else can be. */
  nextTurn: number;
  status: SlotStatus;
  first: Answer | null;
  /** In context, once played there. */
  context: Answer | null;
}

export interface Drill {
  slots: Slot[];
  turn: number;
  last: string | null;
  /** New cards still to join, in order. */
  incoming: SetCard[];
  /** Most cards in play at once. */
  size: number;
}

const slotOf = (card: SetCard, nextTurn: number): Slot => ({
  key: srsKey(card.voicing.id, card.mode),
  card,
  need: card.why === 'check' || card.why === 'early' ? 1 : FLUENT_STREAK,
  streak: 0,
  asked: 0,
  misses: 0,
  slows: 0,
  nextTurn,
  status: 'active',
  first: null,
  context: null,
});

/** New cards join while there's room and fewer than NEW_AT_ONCE are still being learned. */
function refill(d: Drill): Drill {
  const slots = [...d.slots];
  const incoming = [...d.incoming];
  const active = () => slots.filter(s => s.status === 'active');
  while (incoming.length && active().length < d.size && active().filter(s => s.card.why === 'new').length < NEW_AT_ONCE) {
    slots.push(slotOf(incoming.shift()!, d.turn));
  }
  return { ...d, slots, incoming };
}

export function startDrill(set: SetCard[], incoming: SetCard[] = [], size = set.length + Math.min(NEW_AT_ONCE, incoming.length)): Drill {
  return refill({ slots: set.map((card, i) => slotOf(card, i)), turn: 0, last: null, incoming, size });
}

/** The card to ask next: the one waiting longest, never the same twice running if another is left. */
export function nextSlot(d: Drill): Slot | null {
  const active = d.slots.filter(s => s.status === 'active');
  if (!active.length) return null;
  const pickFrom = active.length > 1 ? active.filter(s => s.key !== d.last) : active;
  return [...pickFrom].sort((a, b) => a.nextTurn - b.nextTurn || a.streak - b.streak)[0];
}

export function answerOf(correct: boolean, ms: number, target: number): Answer {
  return !correct ? 'miss' : ms > target ? 'slow' : 'fast';
}

/** The drill after one answer to slot `key` (a new object; the slot's status says if it left). */
export function answerDrill(d: Drill, key: string, a: Answer): Drill {
  const turn = d.turn + 1;
  const slots = d.slots.map(s => {
    if (s.key !== key) return s;
    const n: Slot = { ...s, asked: s.asked + 1, first: s.first ?? a };
    if (a === 'fast') {
      n.streak = s.streak + 1;
      n.nextTurn = turn + 1 + n.streak;
    } else {
      n.streak = 0;
      n.nextTurn = turn + 2;
      n.need = FLUENT_STREAK;
      if (a === 'miss') n.misses++;
      else n.slows++;
    }
    if (n.streak >= n.need) n.status = n.need === 1 ? 'checked' : 'fluent';
    else if (n.asked >= MAX_ASKS) n.status = 'stuck';
    return n;
  });
  return refill({ ...d, slots, turn, last: key });
}

// ── in context ──────────────────────────────────────────────────────────

export interface ContextStep {
  voicing: Voicing;
  mode: Mode;
  context_id: string;
  symbol: string;
  group: string;
  /** The set's card this step checks, if it's one. */
  probe: string | null;
}

/**
 * A ii–V–I for each card that came out of the drill solid: the first
 * progression with its chord (the same root, quality and spelling), the card's
 * own voicing on that chord and the library's of the same family, voice-led,
 * on the others. Cards of one progression and mode share it; a second
 * inversion of a chord takes the next progression with it (or a repeat). A iii voicing, a
 * found one, or a chord no progression has stays out.
 */
export function contextSteps(slots: Slot[], contexts: Context[], library: Voicing[]): ContextStep[] {
  const progs = contexts.filter(c => c.type === 'progression').sort((a, b) => a.sort_order - b.sort_order);
  const rootName = (label: string) => parseChordLabel(label)?.rootName;
  const symbolRoot = (symbol: string) => symbol.match(/^[A-G][b#]?/)?.[0];
  const groups = new Map<string, { c: Context; mode: Mode; probes: Slot[]; chords: Set<string> }>();
  for (const s of slots) {
    if (s.status !== 'fluent' && s.status !== 'checked') continue;
    const v = s.card.voicing;
    if (isIii(v) || NO_CONTEXT_FAMILIES.has(v.family)) continue;
    const matches = progs.filter(p => p.steps.some(st => st.root === v.root && st.quality === v.quality && symbolRoot(st.symbol) === rootName(v.chord_label)));
    if (!matches.length) continue;
    // One probe per chord in a progression: another inversion of the same chord
    // takes the next progression with it, or the same one played again.
    const chord = `${v.root}|${v.quality}|${rootName(v.chord_label)}`;
    placed: for (let n = 0; ; n++) {
      for (const c of matches) {
        const k = `${c.id}|${s.card.mode}|${n}`;
        const g = groups.get(k) ?? { c, mode: s.card.mode, probes: [], chords: new Set<string>() };
        if (g.chords.has(chord)) continue;
        g.probes.push(s);
        g.chords.add(chord);
        groups.set(k, g);
        break placed;
      }
    }
  }
  const out: ContextStep[] = [];
  for (const { c, mode, probes } of groups.values()) {
    const family = probes[0].card.voicing.family;
    const tags = family === 'found' ? [] : probes[0].card.voicing.tags.filter(t => t === 'two-handed');
    let prev: Voicing | null = null;
    const steps: ContextStep[] = [];
    for (const st of c.steps) {
      const probe = probes.find(p => p.card.voicing.root === st.root && p.card.voicing.quality === st.quality && rootName(p.card.voicing.chord_label) === symbolRoot(st.symbol));
      let v: Voicing | undefined = probe?.card.voicing;
      if (!v) {
        const cands = candidatesFor(library, st.root, [st.quality], tags, symbolRoot(st.symbol));
        const same = cands.filter(x => x.family === family);
        v = (same.length || cands.length) ? voiceLead(same.length ? same : cands, prev) : undefined;
      }
      if (!v) continue; // the library has no voicing for this chord: play the rest
      steps.push({ voicing: v, mode, context_id: c.id, symbol: st.symbol, group: c.name, probe: probe?.key ?? null });
      prev = v;
    }
    if (steps.some(s => s.probe)) out.push(...steps);
  }
  return out;
}

// ── the schedule ────────────────────────────────────────────────────────

const iso = (t: number) => new Date(t).toISOString();

/** Not solid: due now, at the front of the next set. */
export function demote(prev: SrsState, now: Date): SrsState {
  return { ...prev, learned: false, interval_days: 0, due_at: now.toISOString(), updated_at: now.toISOString(), dirty: true };
}

/** One answer in the drill or in context: counted; a solid card that slips is no longer solid. */
export function afterAnswer(prev: SrsState, a: Answer, now: Date): SrsState {
  const n: SrsState = { ...prev, reps: prev.reps + 1, lapses: prev.lapses + (a === 'miss' && prev.learned ? 1 : 0), updated_at: now.toISOString(), dirty: true };
  return a !== 'fast' && prev.learned ? demote(n, now) : n;
}

/** A card leaving the drill: fluent (back for a check tomorrow), its check passed (spaced further), or stuck. */
export function afterSlot(prev: SrsState, status: SlotStatus, now: Date): SrsState {
  const t = now.getTime();
  if (status === 'stuck') return demote(prev, now);
  let interval = 1;
  if (status === 'checked') {
    const i = prev.interval_days;
    interval = Math.min(MAX_INTERVAL, i < 1 ? 1 : i < 3 ? 3 : i * 2.5);
  }
  return { ...prev, learned: true, interval_days: interval, due_at: iso(t + interval * DAY), updated_at: now.toISOString(), dirty: true };
}

// ── how a card stands (the Voicings page) ───────────────────────────────

export type CardStatus = 'out' | 'new' | 'shaky' | 'solid';

/** Out of the deck, new, shaky (not solid, or flagged for the context gap) or solid. */
export function cardStatus(st: SrsState | undefined, gap: boolean): CardStatus {
  if (!st) return 'out';
  if (st.reps === 0) return 'new';
  return !st.learned || gap ? 'shaky' : 'solid';
}

/** Right and fast answers at the end of a card's history, from any source. */
export function fastStreak(list: Attempt[] | undefined): number {
  const all = list ?? [];
  let n = 0;
  for (let i = all.length - 1; i >= 0 && all[i].correct && !all[i].slow; i--) n++;
  return n;
}

export type Source = 'R' | 'C' | 'P' | 'T';
export const SOURCE_NAME: Record<Source, string> = { R: 'Review', C: 'Review’s ii–V–I', P: 'Practice', T: 'a tune' };

/**
 * Where an answer came from: Review's drill (no run, on its own), Review's
 * ii–V–I step (no run, in a progression), a Practice run, or a tune (Practice,
 * a tune or one of the owner's charts). `what`: the set or progression.
 */
export function sourceOf(a: Attempt, runs: Map<string, { set_label: string; context_type: string }>, progressions: Map<string, { name: string }>): { src: Source; what: string | null } {
  if (a.run_id) {
    const r = runs.get(a.run_id);
    return { src: a.context_type === 'tune' ? 'T' : 'P', what: r?.set_label ?? null };
  }
  if (a.context_type === 'isolated') return { src: 'R', what: null };
  return { src: 'C', what: (a.context_id && progressions.get(a.context_id)?.name) || null };
}
