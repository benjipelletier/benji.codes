// Edits the editor makes, as pure functions: (chart, …) → chart.
//
// Timeline edits work on one bar's events. Because a bar's events always fill
// it end to end, every timing edit is a boundary moving between two
// neighbours: lengthening one shortens the next, and nothing can overlap, go
// negative or run past the barline. Structural edits work on ranges of bars
// and carry rehearsal marks, time signatures and repeats with the music.

import { type Bar, type Chart, type Ev, type EventKind, type Meter, blankBar, metersOf, newId, normalizeChart } from './chart';
import { transposeEvent } from './chords';

const withBars = (c: Chart, bars: Bar[]): Chart => normalizeChart({ ...c, bars });

export function mapBars(c: Chart, from: number, to: number, fn: (b: Bar, i: number) => Bar): Chart {
  return withBars(c, c.bars.map((b, i) => (i >= from && i <= to ? fn(b, i) : b)));
}

/** Rewrite one bar's events; the result is re-timed (contiguous, filling the bar). */
export function editEvents(c: Chart, i: number, fn: (evs: Ev[], m: Meter) => Ev[]): Chart {
  const m = metersOf(c)[i];
  return mapBars(c, i, i, (b) => ({ ...b, events: retime(fn(b.events.map((e) => ({ ...e })), m)) }));
}

/** Starts follow from lengths. */
function retime(evs: Ev[]): Ev[] {
  let at = 0;
  return evs.filter((e) => e.dur > 0).map((e) => {
    const out = { ...e, at };
    at += e.dur;
    return out;
  });
}

// ---- Grid ----

/** Subdivisions of the beat the editor snaps to. */
export const GRIDS = [
  { div: 1, label: 'Beat' },
  { div: 2, label: '½' },
  { div: 3, label: 'Triplet' },
  { div: 4, label: '¼' },
] as const;

export function gridStep(m: Meter, div: number): number {
  return Math.max(1, Math.round(m.beat / div));
}

export function snap(tick: number, step: number): number {
  return Math.round(tick / step) * step;
}

// ---- One event ----

const idx = (evs: Ev[], id: string) => evs.findIndex((e) => e.id === id);

/** The chord sounding just before bar i, event k (for filling in a sensible chord). */
export function chordBefore(c: Chart, i: number, id?: string): string | null {
  for (let b = i; b >= 0; b--) {
    const evs = c.bars[b].events;
    let k = b === i && id ? idx(evs, id) - 1 : evs.length - 1;
    for (; k >= 0; k--) if (evs[k].ch) return evs[k].ch!;
  }
  return null;
}

/** Set an event's chord. A hit keeps being a hit; anything else becomes a chord. */
export function setChord(c: Chart, i: number, id: string, ch: string): Chart {
  return editEvents(c, i, (evs) => evs.map((e) => (e.id === id ? { ...e, ch, kind: e.kind === 'hit' ? 'hit' : 'chord' } : e)));
}

/** Change what an event is. Chords and hits need a chord: the one given, or the one sounding before. */
export function setKind(c: Chart, i: number, id: string, kind: EventKind, ch?: string): Chart {
  const fallback = ch ?? chordBefore(c, i, id) ?? 'C';
  return editEvents(c, i, (evs) =>
    evs.map((e) => {
      if (e.id !== id) return e;
      const out: Ev = { ...e, kind };
      if (kind === 'chord' || kind === 'hit') out.ch = e.ch ?? fallback;
      else {
        delete out.ch;
        if (kind !== 'hold') delete out.alt;
      }
      if (kind !== 'chord' && kind !== 'slash') delete out.small;
      return out;
    }),
  );
}

export function patchEvent(c: Chart, i: number, id: string, patch: Partial<Ev>): Chart {
  return editEvents(c, i, (evs) =>
    evs.map((e) => {
      if (e.id !== id) return e;
      const out = { ...e, ...patch, id: e.id, at: e.at, dur: e.dur } as Ev & Record<string, unknown>;
      for (const k of Object.keys(patch)) if (out[k] === undefined || out[k] === false || out[k] === '') delete out[k];
      return out;
    }),
  );
}

/** Pieces after the first take over silently: a split alone never changes the music. */
function continuation(e: Ev): Ev {
  const kind: EventKind = e.kind === 'rest' || e.kind === 'nc' || e.kind === 'slash' ? e.kind : 'hold';
  return { id: newId(), at: 0, dur: 0, kind };
}

/** Split an event into `parts` equal pieces (as near as whole ticks allow). */
export function splitEvent(c: Chart, i: number, id: string, parts = 2): Chart {
  return editEvents(c, i, (evs) => {
    const k = idx(evs, id);
    if (k < 0 || parts < 2 || evs[k].dur < parts) return evs;
    const e = evs[k];
    const sizes = Array.from({ length: parts }, (_, p) => Math.round(((p + 1) * e.dur) / parts) - Math.round((p * e.dur) / parts));
    const pieces = sizes.map((dur, p) => (p === 0 ? { ...e, dur } : { ...continuation(e), dur }));
    return [...evs.slice(0, k), ...pieces, ...evs.slice(k + 1)];
  });
}

/** Split an event at every grid line inside it (into beats, eighths, triplets…). */
export function splitOnGrid(c: Chart, i: number, id: string, step: number): Chart {
  return editEvents(c, i, (evs) => {
    const k = idx(evs, id);
    if (k < 0) return evs;
    const e = evs[k];
    const cuts: number[] = [];
    for (let t = Math.floor(e.at / step) * step + step; t < e.at + e.dur; t += step) if (t > e.at) cuts.push(t);
    if (!cuts.length) return evs;
    const bounds = [e.at, ...cuts, e.at + e.dur];
    const pieces = bounds.slice(0, -1).map((t, p) => (p === 0 ? { ...e, dur: bounds[1] - t } : { ...continuation(e), dur: bounds[p + 1] - t }));
    return [...evs.slice(0, k), ...pieces, ...evs.slice(k + 1)];
  });
}

/** Start a new event at `tick` (splitting whatever is there), as `kind`. */
export function insertAt(c: Chart, i: number, tick: number, kind: EventKind, ch?: string): { chart: Chart; id: string | null } {
  const bar = c.bars[i];
  const k = bar.events.findIndex((e) => tick > e.at && tick < e.at + e.dur);
  const id = newId();
  if (k < 0) {
    // On an existing boundary: change that event instead.
    const at = bar.events.find((e) => e.at === tick);
    if (!at) return { chart: c, id: null };
    return { chart: kind === 'chord' || kind === 'hit' ? setKind(setChord(c, i, at.id, ch ?? chordBefore(c, i, at.id) ?? 'C'), i, at.id, kind) : setKind(c, i, at.id, kind), id: at.id };
  }
  const chart = editEvents(c, i, (evs) => {
    const e = evs[k];
    const fresh: Ev = { id, at: tick, dur: e.at + e.dur - tick, kind };
    if (kind === 'chord' || kind === 'hit') fresh.ch = ch ?? chordBefore(c, i, e.id) ?? e.ch ?? 'C';
    return [...evs.slice(0, k), { ...e, dur: tick - e.at }, fresh, ...evs.slice(k + 1)];
  });
  return { chart, id };
}

/**
 * Make an event `dur` ticks long. Longer: it takes time from the events after
 * it (any it covers entirely go). Shorter: the event after it starts earlier,
 * or, if it was last, a rest fills the rest of the bar.
 */
export function setDuration(c: Chart, i: number, id: string, dur: number): Chart {
  const m = metersOf(c)[i];
  return editEvents(c, i, (evs) => {
    const k = idx(evs, id);
    if (k < 0) return evs;
    const e = evs[k];
    const end = Math.max(e.at + 1, Math.min(m.length, e.at + Math.round(dur)));
    const oldEnd = e.at + e.dur;
    if (end === oldEnd) return evs;
    const out = evs.slice(0, k);
    out.push({ ...e, dur: end - e.at });
    if (end > oldEnd) {
      for (const n of evs.slice(k + 1)) {
        const nEnd = n.at + n.dur;
        if (nEnd <= end) continue;
        out.push({ ...n, dur: nEnd - Math.max(end, n.at) });
      }
    } else if (k + 1 < evs.length) {
      const n = evs[k + 1];
      out.push({ ...n, dur: n.dur + (oldEnd - end) }, ...evs.slice(k + 2));
    } else {
      out.push({ id: newId(), at: end, dur: m.length - end, kind: 'rest' });
    }
    return out;
  });
}

/** Move the boundary before event `b` (b ≥ 1) to `tick`, keeping every event at least `min` long. */
export function moveBoundary(c: Chart, i: number, b: number, tick: number, min = 1): Chart {
  return editEvents(c, i, (evs) => {
    if (b < 1 || b >= evs.length) return evs;
    const prev = evs[b - 1];
    const cur = evs[b];
    const t = Math.max(prev.at + min, Math.min(cur.at + cur.dur - min, Math.round(tick)));
    if (t === cur.at) return evs;
    const out = evs.slice();
    out[b - 1] = { ...prev, dur: t - prev.at };
    out[b] = { ...cur, dur: cur.at + cur.dur - t };
    return out;
  });
}

/** Move an event earlier or later by `delta`, its length kept (the last event's end stays at the barline). */
export function shiftEvent(c: Chart, i: number, id: string, delta: number, min = 1): Chart {
  const k = idx(c.bars[i].events, id);
  if (k < 1) return c;
  const evs = c.bars[i].events;
  const e = evs[k];
  const prev = evs[k - 1];
  const next = evs[k + 1];
  // Clamp so the neighbours stay at least `min` long.
  let d = Math.max(delta, prev.at + min - e.at);
  if (next) d = Math.min(d, next.at + next.dur - min - (e.at + e.dur));
  else d = Math.min(d, e.dur - min);
  if (!d) return c;
  let out = moveBoundary(c, i, k, e.at + d, min);
  if (next) out = moveBoundary(out, i, k + 1, e.at + e.dur + d, min);
  return out;
}

export function mergeWithNext(c: Chart, i: number, id: string): Chart {
  return editEvents(c, i, (evs) => {
    const k = idx(evs, id);
    if (k < 0 || k + 1 >= evs.length) return evs;
    return [...evs.slice(0, k), { ...evs[k], dur: evs[k].dur + evs[k + 1].dur }, ...evs.slice(k + 2)];
  });
}

/**
 * Take an event out: the one before it carries on through its time. The
 * first event can't hand its time back, so it becomes a hold instead (the
 * harmony from before carries on).
 */
export function removeEvent(c: Chart, i: number, id: string): Chart {
  const k = idx(c.bars[i].events, id);
  if (k < 0) return c;
  if (k === 0) return setKind(c, i, id, 'hold');
  return editEvents(c, i, (evs) => [...evs.slice(0, k - 1), { ...evs[k - 1], dur: evs[k - 1].dur + evs[k].dur }, ...evs.slice(k + 1)]);
}

/** Replace a bar's events wholesale (from typed text), keeping marks that sat at the same times. */
export function replaceEvents(c: Chart, i: number, events: Ev[], simile?: 1 | 2): Chart {
  return mapBars(c, i, i, (b) => {
    const kept = events.map((e) => {
      const old = b.events.find((o) => o.at === e.at);
      if (!old) return e;
      const marks: Partial<Ev> = {};
      for (const k of ['text', 'fermata', 'segno', 'coda', 'end'] as const) if (old[k]) (marks as Record<string, unknown>)[k] = old[k];
      return { ...marks, ...e };
    });
    const out: Bar = { ...b, events: kept };
    if (simile) out.simile = simile;
    else {
      delete out.simile;
      delete out.simileAt;
    }
    return out;
  });
}

// ---- Bars ----

type Patch = Partial<Omit<Bar, 'id' | 'events'>>;

/** Set (or with undefined, clear) bar fields. */
export function patchBar(c: Chart, i: number, patch: Patch): Chart {
  return mapBars(c, i, i, (b) => {
    const out = { ...b, ...patch } as Bar & Record<string, unknown>;
    for (const k of Object.keys(patch)) if (out[k] === undefined) delete out[k];
    return out;
  });
}

export function insertBars(c: Chart, at: number, n = 1): Chart {
  const ms = metersOf(c);
  const m = ms[Math.max(0, Math.min(at, c.bars.length) - 1)] ?? ms[0];
  const bars = c.bars.slice();
  const width = c.bars[Math.max(0, at - 1)]?.width;
  bars.splice(at, 0, ...Array.from({ length: n }, () => blankBar(m, width)));
  // A final barline stays on the last bar.
  if (at === c.bars.length && at > 0 && bars[at - 1].close === 'Z') {
    bars[at - 1] = { ...bars[at - 1] };
    delete bars[at - 1].close;
    bars[bars.length - 1] = { ...bars[bars.length - 1], close: 'Z' };
  }
  return withBars(c, bars);
}

/** Copies of bars with new ids (bars and events), so comments and merges keep the originals apart. */
export function cloneBars(bars: Bar[]): Bar[] {
  return bars.map((b) => {
    const copy = structuredClone(b);
    return { ...copy, id: newId(), events: copy.events.map((e) => ({ ...e, id: newId() })) };
  });
}

export function insertCopies(c: Chart, at: number, copies: Bar[]): Chart {
  const bars = c.bars.slice();
  bars.splice(at, 0, ...cloneBars(copies));
  return withBars(c, bars);
}

/** Duplicate bars from…to right after themselves. A final barline moves to the end of the copy. */
export function duplicateBars(c: Chart, from: number, to: number): Chart {
  const src = c.bars.slice(from, to + 1).map((b, k, a) => (k === a.length - 1 && b.close === 'Z' ? { ...b } : b));
  const copies = cloneBars(src);
  const bars = c.bars.slice();
  if (bars[to].close === 'Z') {
    bars[to] = { ...bars[to] };
    delete bars[to].close;
  }
  bars.splice(to + 1, 0, ...copies);
  return withBars(c, bars);
}

/**
 * Delete bars from…to. What belongs to the structure rather than the bars —
 * a section letter, a time signature, an opening barline or repeat, a line
 * break — moves to the bar after; a closing barline or repeat to the bar
 * before. So deleting the first bar of section B keeps a section B, and
 * deleting the bar that changed to 3/4 doesn't turn the waltz into 4/4.
 */
export function deleteBars(c: Chart, from: number, to: number): Chart {
  const gone = c.bars.slice(from, to + 1);
  const bars = c.bars.filter((_, i) => i < from || i > to);
  if (!bars.length) return withBars(c, [blankBar(metersOf(c)[0])].map((b) => ({ ...b, open: '[' as const, close: 'Z' as const, time: c.bars[0].time })));
  const first = gone[0];
  const last = gone[gone.length - 1];
  const after = bars[from];
  if (after) {
    const carry: Patch = {};
    for (const k of ['section', 'time', 'open', 'ending', 'vspace', 'br'] as const) if (first[k] !== undefined && after[k] === undefined) (carry as Record<string, unknown>)[k] = first[k];
    // A time signature from inside the deleted run still governs what follows.
    const lastTime = [...gone].reverse().find((b) => b.time)?.time;
    if (lastTime && after.time === undefined) carry.time = lastTime;
    bars[from] = { ...after, ...carry };
  }
  const before = bars[from - 1];
  if (before && last.close && !before.close) bars[from - 1] = { ...before, close: last.close };
  return withBars(c, bars);
}

/** Move bars from…to by `delta` bars (negative: earlier). Returns the new range. */
export function moveBars(c: Chart, from: number, to: number, delta: number): { chart: Chart; from: number; to: number } {
  const n = to - from + 1;
  const target = Math.max(0, Math.min(c.bars.length - n, from + delta));
  if (target === from) return { chart: c, from, to };
  const bars = c.bars.slice();
  const moved = bars.splice(from, n);
  bars.splice(target, 0, ...moved);
  return { chart: withBars(c, bars), from: target, to: target + n - 1 };
}

export function clearBars(c: Chart, from: number, to: number): Chart {
  const ms = metersOf(c);
  return mapBars(c, from, to, (b, i) => {
    const out: Bar = { ...b, events: [{ id: newId(), at: 0, dur: ms[i].length, kind: 'hold' }] };
    delete out.simile;
    delete out.simileAt;
    return out;
  });
}

export function transposeBars(c: Chart, from: number, to: number, semis: number, flats: boolean): Chart {
  return mapBars(c, from, to, (b) => ({ ...b, events: b.events.map((e) => transposeEvent(e, semis, flats)) }));
}

export function transposeChart(c: Chart, semis: number, flats: boolean): Chart {
  return transposeBars(c, 0, c.bars.length - 1, semis, flats);
}

/** Put a repeat (or double bar) around a range, or take it off if it's already there. */
export function toggleWrap(c: Chart, from: number, to: number, open: '{' | '[', close: '}' | ']'): Chart {
  const on = c.bars[from].open === open && c.bars[to].close === close;
  let out = patchBar(c, from, { open: on ? undefined : open });
  out = patchBar(out, to, { close: on ? undefined : close });
  return out;
}

export function clearBarlines(c: Chart, from: number, to: number): Chart {
  return mapBars(c, from, to, (b) => {
    const out = { ...b };
    delete out.open;
    delete out.close;
    return out;
  });
}

/** The bars of the section bar i is in: from its section letter to the bar before the next one. */
export function sectionRange(c: Chart, i: number): [number, number] {
  let from = i;
  while (from > 0 && !c.bars[from].section) from--;
  let to = i + 1;
  while (to < c.bars.length && !c.bars[to].section) to++;
  return [from, to - 1];
}
