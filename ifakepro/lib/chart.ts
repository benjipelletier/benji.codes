// The chart model (v2). A chart is a list of bars; a bar is a timeline of
// musical events — a chord, a rest, N.C., a hold, a slash, a hit — each with
// an explicit start and duration in ticks. The events of a bar always fill it
// exactly, one after another, so there are no gaps or overlaps to get wrong:
// changing one event's length moves its neighbour's boundary, never past it.
//
// Bars and events have stable ids, so comments, merges, version diffs and
// collaborators can point at them across edits. Charts stored before
// timelines (v1, iReal's cell grid) are upgraded on the way in by
// `sanitizeChart` (convert.ts), deterministically, so every reader agrees.

import { type BarFrame, type CellChart, type Cell, type CellBar } from './legacy';
import { cellChartToChart } from './convert';

export type { OpenBar, CloseBar } from './legacy';

/** iReal's row: 16 cells. Bars take `width` cells of it (4 by default). */
export const ROW_CELLS = 16;
export const DEFAULT_WIDTH = 4;
/** Ticks per whole note. A quarter is 24: 32nds, triplets and 16th triplets all land on whole ticks. */
export const WHOLE = 96;

/**
 * chord · a chord symbol · rest · explicit silence · nc · no chord (N.C.)
 * hold · no change: the harmony before carries on (an empty bar is one hold)
 * slash · a rhythmic slash on the current harmony · hit · an ensemble accent, on a chord
 */
export type EventKind = 'chord' | 'rest' | 'nc' | 'hold' | 'slash' | 'hit';
export const EVENT_KINDS: EventKind[] = ['chord', 'rest', 'nc', 'hold', 'slash', 'hit'];

export interface Marks {
  /** A text annotation, e.g. "D.C. al Coda". iReal may prefix *NN (its height). */
  text?: string;
  fermata?: boolean;
  segno?: boolean;
  coda?: boolean;
  /** iReal's U: where playback ends. Kept so export loses nothing. */
  end?: boolean;
}

export interface Ev extends Marks {
  id: string;
  /** Start, in ticks from the start of the bar. */
  at: number;
  /** Length, in ticks. */
  dur: number;
  kind: EventKind;
  /** The chord, in iReal spelling (C-7, Bb^7, F#h7, Eb7b9/G), for chords and hits. */
  ch?: string;
  /** An alternate chord, written small above. */
  alt?: string;
  small?: boolean;
  /**
   * Which iReal cell this came from, kept only where two cells mean the same
   * beat (4 cells of 3/4), so export writes it back where it was. Layout only:
   * ignored once the event's time no longer matches that cell.
   */
  cell?: number;
}

export interface Bar extends BarFrame {
  events: Ev[];
  /** Cells of iReal's 16-cell row the bar takes (layout only). */
  width?: number;
  /** A repeat sign standing for the bar: 1 = the last bar again, 2 = the last two bars. */
  simile?: 1 | 2;
  /** Which iReal cell the repeat sign sat in, so export puts it back. */
  simileAt?: number;
}

export interface Chart {
  v: 2;
  bars: Bar[];
}

export interface SongMeta {
  title: string;
  composer: string;
  style: string;
  /** iReal spelling: "Eb", "G-" (minor). */
  key: string;
  /** 0 when unset. */
  bpm: number;
  /** iReal's own transpose setting, kept for export. */
  transpose: number;
  /** iReal's accompaniment style, kept for export. */
  comp: string;
  repeats: number;
}

export const EMPTY_META: SongMeta = {
  title: 'Untitled',
  composer: '',
  style: 'Medium Swing',
  key: 'C',
  bpm: 0,
  transpose: 0,
  comp: '',
  repeats: 0,
};

export function newId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 10);
}

// ---- Meter ----

export interface Meter {
  num: number;
  den: number;
  /** Ticks per beat (the denominator's note). */
  beat: number;
  /** Ticks in the bar. */
  length: number;
  /** Beats felt together: 3 in 6/8, 9/8, 12/8. */
  group: number;
}

export function meter(time = '4/4'): Meter {
  const m = time.match(/^(\d{1,2})\/(\d{1,2})$/);
  const num = m ? Math.max(1, Number(m[1])) : 4;
  const den = m && [1, 2, 4, 8, 16].includes(Number(m[2])) ? Number(m[2]) : 4;
  const beat = WHOLE / den;
  return { num, den, beat, length: num * beat, group: den === 8 && num % 3 === 0 && num > 3 ? 3 : 1 };
}

/** The time signature in force at each bar. */
export function timeAt(chart: { bars: { time?: string }[] }): string[] {
  let t = '4/4';
  return chart.bars.map((b) => (t = b.time ?? t));
}

export function metersOf(chart: { bars: { time?: string }[] }): Meter[] {
  return timeAt(chart).map((t) => meter(t));
}

// ---- Events ----

export function holdEvent(length: number, id = newId()): Ev {
  return { id, at: 0, dur: length, kind: 'hold' };
}

/** Make a bar's events contiguous and exactly `length` long: starts recomputed, the last one stretched or the tail cut. */
export function fitEvents(events: Ev[], length: number): Ev[] {
  const out: Ev[] = [];
  let at = 0;
  for (const e of events) {
    if (at >= length) break;
    const dur = Math.max(0, Math.round(e.dur));
    if (dur <= 0) continue;
    out.push({ ...e, at, dur: Math.min(dur, length - at) });
    at += dur;
  }
  if (!out.length) return [holdEvent(length, events[0]?.id)];
  const last = out[out.length - 1];
  if (last.at + last.dur < length) out[out.length - 1] = { ...last, dur: length - last.at };
  return out;
}

export function eventAt(bar: Bar, tick: number): Ev {
  return bar.events.find((e) => tick >= e.at && tick < e.at + e.dur) ?? bar.events[bar.events.length - 1];
}

/** Nothing to play or show: a bar of one hold with no marks. */
export function isEmptyBar(bar: Bar): boolean {
  return !bar.simile && bar.events.every((e) => e.kind === 'hold' && !e.alt && !e.text && !e.fermata && !e.segno && !e.coda && !e.end);
}

export function blankBar(m: Meter = meter(), width = DEFAULT_WIDTH): Bar {
  return { id: newId(), events: [holdEvent(m.length)], ...(width !== DEFAULT_WIDTH ? { width } : {}) };
}

export function blankChart(bars = 16, time = '4/4'): Chart {
  const m = meter(time);
  const out: Bar[] = [];
  for (let i = 0; i < bars; i++) out.push(blankBar(m));
  out[0].open = '[';
  out[0].time = time;
  out[out.length - 1].close = 'Z';
  return { v: 2, bars: out };
}

/** Re-fit every bar to its meter (after a time signature change, an insert or a delete). */
export function normalizeChart(chart: Chart): Chart {
  const ms = metersOf(chart);
  let changed = false;
  const bars = chart.bars.map((b, i) => {
    const total = b.events.reduce((s, e) => s + e.dur, 0);
    const ok = total === ms[i].length && b.events.every((e, k) => e.at === (k ? b.events[k - 1].at + b.events[k - 1].dur : 0) && e.dur > 0);
    if (ok) return b;
    changed = true;
    return { ...b, events: fitEvents(b.events, ms[i].length) };
  });
  return changed ? { ...chart, bars } : chart;
}

// ---- Comparing ----

/** JSON with sorted keys and undefined/false/empty dropped, so equal content compares equal. */
export function canon(v: unknown): string {
  return JSON.stringify(v, (_k, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(val).sort()) {
        const x = (val as Record<string, unknown>)[k];
        if (x === undefined || x === false || x === '') continue;
        out[k] = x;
      }
      return out;
    }
    return val;
  });
}

export function sameBar(a: Bar | undefined, b: Bar | undefined): boolean {
  if (!a || !b) return a === b;
  return canon(a) === canon(b);
}

export function cloneChart(c: Chart): Chart {
  return JSON.parse(JSON.stringify(c));
}

// ---- Layout ----

export type LayoutItem =
  | { kind: 'spacer'; span: number }
  | { kind: 'bar'; bar: Bar; index: number; span: number; start: number };

export interface LayoutRow {
  items: LayoutItem[];
  vspace: number;
}

export function barWidth(bar: Bar): number {
  return Math.max(1, Math.min(ROW_CELLS, bar.width ?? DEFAULT_WIDTH));
}

/**
 * Flow bars into rows of 16 cells, the way iReal does: a bar that doesn't fit
 * in what's left of the row starts the next one, and a bar wider than a row
 * gets a row to itself.
 */
export function layout(chart: Chart): LayoutRow[] {
  const rows: LayoutRow[] = [];
  let row: LayoutRow = { items: [], vspace: 0 };
  let pos = 0;
  const flush = () => {
    if (row.items.length) rows.push(row);
    row = { items: [], vspace: 0 };
    pos = 0;
  };
  chart.bars.forEach((bar, index) => {
    const span = barWidth(bar);
    if (bar.br && pos > 0) flush();
    let spacer = bar.spacer ?? 0;
    if (pos + spacer >= ROW_CELLS) {
      spacer = (pos + spacer) % ROW_CELLS;
      flush();
    }
    if (pos + spacer + span > ROW_CELLS && pos > 0) {
      flush();
      spacer = 0;
    }
    if (pos === 0 && bar.vspace) row.vspace = bar.vspace;
    if (spacer > 0 && pos + spacer + span <= ROW_CELLS) {
      row.items.push({ kind: 'spacer', span: spacer });
      pos += spacer;
    }
    row.items.push({ kind: 'bar', bar, index, span, start: pos });
    pos += span;
    if (pos >= ROW_CELLS) flush();
  });
  flush();
  return rows;
}

/** Display form of a section letter. */
export function sectionLabel(s: string): string {
  if (s === 'i') return 'In';
  if (s === 'V' || s === 'v') return 'V';
  return s;
}

/** Text annotation without iReal's *NN height prefix. */
export function cellText(t: string): string {
  return t.replace(/^\*\d\d/, '');
}

// ---- Untrusted input ----

const str = (v: unknown, max: number) => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : undefined);

function frameOf(b: Record<string, unknown>, seen: Set<string>): BarFrame {
  let id = str(b.id, 32) ?? newId();
  if (seen.has(id)) id = newId();
  seen.add(id);
  const f: BarFrame = { id };
  if (b.open === '|' || b.open === '[' || b.open === '{') f.open = b.open;
  if (b.close === ']' || b.close === '}' || b.close === 'Z') f.close = b.close;
  const section = str(b.section, 1);
  if (section && /[A-Za-z]/.test(section)) f.section = section;
  if (typeof b.time === 'string' && /^\d{1,2}\/(1|2|4|8|16)$/.test(b.time)) f.time = b.time;
  if (typeof b.ending === 'number' && b.ending >= 0 && b.ending <= 9) f.ending = Math.floor(b.ending);
  if (typeof b.spacer === 'number' && b.spacer > 0) f.spacer = Math.min(15, Math.floor(b.spacer));
  if (typeof b.vspace === 'number' && b.vspace > 0) f.vspace = Math.min(3, Math.floor(b.vspace));
  if (b.br === true) f.br = true;
  return f;
}

function marksOf(c: Record<string, unknown>): Marks & { alt?: string; small?: boolean } {
  const out: Marks & { alt?: string; small?: boolean } = {};
  const alt = str(c.alt, 24);
  if (alt) out.alt = alt;
  const text = str(c.text, 120);
  if (text) out.text = text.replace(/[<>]/g, '');
  for (const k of ['small', 'fermata', 'segno', 'coda', 'end'] as const) if (c[k] === true) out[k] = true;
  return out;
}

function sanitizeCellChart(bars: unknown[]): CellChart {
  const seen = new Set<string>();
  return {
    v: 1,
    bars: bars.map((raw) => {
      const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const cellsIn = Array.isArray(b.cells) ? b.cells.slice(0, 32) : [];
      const cells: Cell[] = cellsIn.map((rc) => {
        const c = (rc && typeof rc === 'object' ? rc : {}) as Record<string, unknown>;
        const cell: Cell = marksOf(c);
        const ch = str(c.ch, 24);
        if (ch) cell.ch = ch;
        if (c.sym === 'x' || c.sym === 'r' || c.sym === 'p' || c.sym === 'n') cell.sym = c.sym;
        return cell;
      });
      if (!cells.length) cells.push({});
      return { ...frameOf(b, seen), cells } as CellBar;
    }),
  };
}

/**
 * Clamp untrusted chart JSON to the model, upgrading a v1 (cell) chart to
 * timelines on the way. Returns null if it isn't a chart at all.
 */
export function sanitizeChart(input: unknown): Chart | null {
  if (!input || typeof input !== 'object') return null;
  const bars = (input as { bars?: unknown }).bars;
  if (!Array.isArray(bars) || bars.length > 2000) return null;
  const legacy = (input as { v?: unknown }).v !== 2 || bars.some((b) => b && typeof b === 'object' && Array.isArray((b as { cells?: unknown }).cells));
  if (legacy) return cellChartToChart(sanitizeCellChart(bars));

  const seen = new Set<string>();
  const out: Bar[] = bars.map((raw) => {
    const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const frame = frameOf(b, seen);
    const evSeen = new Set<string>();
    const evsIn = Array.isArray(b.events) ? b.events.slice(0, 96) : [];
    const events: Ev[] = evsIn.map((re) => {
      const e = (re && typeof re === 'object' ? re : {}) as Record<string, unknown>;
      let id = str(e.id, 40) ?? newId();
      if (evSeen.has(id)) id = newId();
      evSeen.add(id);
      const kind = EVENT_KINDS.includes(e.kind as EventKind) ? (e.kind as EventKind) : 'hold';
      const ev: Ev = { id, at: 0, dur: typeof e.dur === 'number' && Number.isFinite(e.dur) ? Math.max(1, Math.round(e.dur)) : 1, kind, ...marksOf(e) };
      const ch = str(e.ch, 24);
      if (ch && (kind === 'chord' || kind === 'hit')) ev.ch = ch;
      if (typeof e.cell === 'number' && e.cell >= 0 && e.cell < 16) ev.cell = Math.floor(e.cell);
      if ((kind === 'chord' || kind === 'hit') && !ev.ch) ev.kind = 'hold';
      return ev;
    });
    const bar: Bar = { ...frame, events };
    if (typeof b.width === 'number' && b.width >= 1 && b.width <= 16 && b.width !== DEFAULT_WIDTH) bar.width = Math.floor(b.width);
    if (b.simile === 1 || b.simile === 2) {
      bar.simile = b.simile;
      if (typeof b.simileAt === 'number' && b.simileAt >= 0 && b.simileAt < 16) bar.simileAt = Math.floor(b.simileAt);
    }
    return bar;
  });
  // Fit every bar to its meter; a bar with no events becomes a hold.
  const ms = metersOf({ bars: out });
  return { v: 2, bars: out.map((b, i) => ({ ...b, events: fitEvents(b.events, ms[i].length) })) };
}

export function sanitizeMeta(input: unknown, fallback: SongMeta = EMPTY_META): SongMeta {
  const m = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const s = (v: unknown, d: string, max = 120) => (typeof v === 'string' ? v.slice(0, max).replace(/=/g, '') : d);
  const n = (v: unknown, d: number, lo: number, hi: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d;
  return {
    title: s(m.title, fallback.title).trim() || 'Untitled',
    composer: s(m.composer, fallback.composer),
    style: s(m.style, fallback.style, 60),
    key: typeof m.key === 'string' && /^[A-G][b#]?-?$/.test(m.key) ? m.key : fallback.key,
    bpm: n(m.bpm, fallback.bpm, 0, 400),
    transpose: n(m.transpose, fallback.transpose, -11, 11),
    comp: s(m.comp, fallback.comp, 60),
    repeats: n(m.repeats, fallback.repeats, 0, 99),
  };
}
