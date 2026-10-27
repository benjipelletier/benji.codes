// Between iReal Pro's cell grid (and charts stored as v1) and timed events.
//
// iReal doesn't say when a chord starts; a bar has n cells and a chord sits
// in one of them. Where n is a whole number of beats per cell (4 cells of
// 4/4, 8 cells of 4/4, 2 cells of 6/8…) a cell is an exact time. Otherwise —
// 4 cells of 3/4, 4 of 5/4, 2 of 3/4 — the chord goes on the nearest beat,
// halves rounding later, which is how those charts are read: two chords in a
// waltz bar are 2+1, Take Five's are 3+2. Writing back finds the cells those
// times came from, so a chart read from iReal is written back unchanged.

import { type Bar, type Chart, type Ev, type EventKind, type Meter, DEFAULT_WIDTH, metersOf } from './chart';
import { type Cell, type CellBar, type CellChart, isBlankCell } from './legacy';

function snappedTimes(n: number, m: Meter): number[] {
  return Array.from({ length: n }, (_, k) => {
    const beats = (k * m.num) / n;
    const frac = beats - Math.floor(beats);
    const b = Math.abs(frac - 0.5) < 1e-9 ? Math.ceil(beats) : Math.round(beats);
    return Math.min(m.num - 1, b) * m.beat;
  });
}

function proportionalTimes(n: number, m: Meter): number[] {
  return Array.from({ length: n }, (_, k) => Math.round((k * m.length) / n));
}

/**
 * When cell k of n starts. `filled` are the cells that hold something: if
 * two of them would land on the same beat, the bar falls back to
 * proportional times (empty cells don't matter).
 */
function cellTimes(n: number, m: Meter, filled: number[]): number[] {
  if (n % m.num === 0 || n > m.num * 4) return proportionalTimes(n, m);
  const snapped = snappedTimes(n, m);
  const distinct = new Set(filled.map((k) => snapped[k])).size === filled.length;
  return distinct ? snapped : proportionalTimes(n, m);
}

/** The cells (in order) that give these events' start times in a bar of n cells, if there are any. */
function cellsFor(evs: { at: number; cell?: number }[], n: number, m: Meter): number[] | null {
  const starts = evs.map((e) => e.at);
  for (const times of [snappedTimes(n, m), proportionalTimes(n, m)]) {
    const ks: number[] = [];
    let from = 0;
    for (const { at, cell } of evs) {
      // Where two cells mean the same beat, the one it came from.
      let k = cell != null && cell >= from && cell < n && times[cell] === at ? cell : from;
      while (k < n && times[k] !== at) k++;
      if (k >= n) break;
      ks.push(k);
      from = k + 1;
    }
    if (ks.length !== starts.length) continue;
    const back = cellTimes(n, m, ks);
    if (ks.every((k, i) => back[k] === starts[i])) return ks;
  }
  return null;
}

const hasMarks = (c: Cell) => !!(c.alt || c.text || c.fermata || c.segno || c.coda || c.end);

function marks(c: Cell): Partial<Ev> {
  const out: Partial<Ev> = {};
  if (c.alt) out.alt = c.alt;
  if (c.text) out.text = c.text;
  if (c.fermata) out.fermata = true;
  if (c.segno) out.segno = true;
  if (c.coda) out.coda = true;
  if (c.end) out.end = true;
  return out;
}

export function cellBarToBar(cb: CellBar, m: Meter): Bar {
  const { cells, ...frame } = cb;
  const n = cells.length || 1;
  const filled = cells.flatMap((c, k) => ((c.ch || c.sym === 'p' || c.sym === 'n' || hasMarks(c)) ? [k] : []));
  const times = cellTimes(n, m, filled);
  const bar: Bar = { ...frame, events: [] };
  if (n !== DEFAULT_WIDTH) bar.width = n;
  const starts: { k: number; ev: Ev }[] = [];
  cells.forEach((c, k) => {
    let cell = c;
    if (c.sym === 'x' || c.sym === 'r') {
      bar.simile = c.sym === 'x' ? 1 : 2;
      bar.simileAt = k;
      cell = { ...c, sym: undefined };
    }
    if (isBlankCell(cell) && !hasMarks(cell)) return;
    let kind: EventKind = 'hold';
    if (cell.ch) kind = 'chord';
    else if (cell.sym === 'p') kind = 'slash';
    else if (cell.sym === 'n') kind = 'nc';
    const ev: Ev = { id: `${cb.id}.${k}`, at: times[k], dur: 0, kind, ...marks(cell) };
    if (times.filter((t) => t === times[k]).length > 1) ev.cell = k;
    if (cell.ch) ev.ch = cell.ch;
    if (cell.small && (kind === 'chord' || kind === 'slash')) ev.small = true;
    starts.push({ k, ev });
  });
  const events = starts.map((s) => s.ev);
  if (!events.length || events[0].at > 0) events.unshift({ id: `${cb.id}.h`, at: 0, dur: 0, kind: 'hold' });
  events.forEach((e, i) => (e.dur = (i + 1 < events.length ? events[i + 1].at : m.length) - e.at));
  bar.events = events;
  return bar;
}

export function cellChartToChart(c: CellChart): Chart {
  const ms = metersOf(c);
  return { v: 2, bars: c.bars.map((b, i) => cellBarToBar(b, ms[i])) };
}

// ---- Back to cells ----

function cellOf(ev: Ev): Cell {
  const c: Cell = {};
  if (ev.kind === 'chord' || ev.kind === 'hit') c.ch = ev.ch;
  else if (ev.kind === 'slash') c.sym = 'p';
  // iReal has no rest: N.C. is the nearest thing it can show.
  else if (ev.kind === 'nc' || ev.kind === 'rest') c.sym = 'n';
  if (ev.small && (c.ch || c.sym === 'p')) c.small = true;
  for (const k of ['alt', 'text', 'fermata', 'segno', 'coda', 'end'] as const) if (ev[k]) (c as Record<string, unknown>)[k] = ev[k];
  return c;
}

/** The cells for a bar: its own width if every event lands on a cell, else the first finer grid that fits. */
export function barToCellBar(bar: Bar, m: Meter): CellBar {
  const { events, width, simile, simileAt, ...frame } = bar;
  const shown = events.filter((e, i) => !(i === 0 && e.kind === 'hold' && !hasMarks(cellOf(e))));
  const own = width ?? DEFAULT_WIDTH;
  const tries = [own, m.num, m.num * 2, m.num * 4, 16].filter((n, i, a) => n >= 1 && n <= 16 && a.indexOf(n) === i);
  let n = own;
  let slots: number[] | null = null;
  for (const t of tries) {
    const ks = cellsFor(shown, t, m);
    if (ks) {
      n = t;
      slots = ks;
      break;
    }
  }
  if (!slots) {
    // No grid fits: nearest free cell, in order.
    slots = [];
    let next = 0;
    for (const e of shown) {
      const k = Math.max(next, Math.min(n - 1, Math.round((e.at * n) / m.length)));
      slots.push(Math.min(k, n - 1));
      next = k + 1;
    }
  }
  const cells: Cell[] = Array.from({ length: n }, () => ({}));
  shown.forEach((e, i) => (cells[slots![i]] = cellOf(e)));
  if (simile) {
    const k = Math.min(n - 1, n === own ? (simileAt ?? (simile === 1 ? 1 : 0)) : 0);
    cells[k] = { ...cells[k], sym: simile === 1 ? 'x' : 'r' };
  }
  return { ...frame, cells };
}

export function chartToCellChart(c: Chart): CellChart {
  const ms = metersOf(c);
  return { v: 1, bars: c.bars.map((b, i) => barToCellBar(b, ms[i])) };
}
