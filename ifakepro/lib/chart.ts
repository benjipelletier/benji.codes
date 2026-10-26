// The chart model. iReal Pro lays a chart out on a grid of 16 cells per row;
// a bar owns a run of cells (four, usually), and each cell holds one chord or
// nothing. Everything is kept per bar and per cell so an imported chart can be
// written back out as the same iReal link, and every bar has a stable id so
// comments, merges and version diffs can point at it across edits.

export const ROW_CELLS = 16;
export const DEFAULT_BAR_CELLS = 4;

/** The barline a bar opens with. Unset: none drawn (start of chart, or after a ] } Z). */
export type OpenBar = '|' | '[' | '{';
/** The barline a bar closes with when it's more than a plain |. */
export type CloseBar = ']' | '}' | 'Z';
/** x: repeat last bar · r: repeat last two bars · p: slash · n: N.C. */
export type CellSym = 'x' | 'r' | 'p' | 'n';

export interface Cell {
  /** A chord in iReal spelling: C-7, Bb^7, F#h7, Eb7b9/G, W/C. */
  ch?: string;
  sym?: CellSym;
  /** An alternate chord, written small above. */
  alt?: string;
  small?: boolean;
  /** A text annotation, e.g. "D.C. al Coda". iReal may prefix *NN (its height). */
  text?: string;
  fermata?: boolean;
  segno?: boolean;
  coda?: boolean;
  /** iReal's U: where playback ends. Kept so export loses nothing. */
  end?: boolean;
}

export interface Bar {
  id: string;
  cells: Cell[];
  open?: OpenBar;
  close?: CloseBar;
  /** Rehearsal mark: A B C D, i (intro), V (verse). */
  section?: string;
  /** Time signature change, "4/4", "3/4", "12/8". */
  time?: string;
  /** Ending number (N1, N2, N3). */
  ending?: number;
  /** Empty cells before the bar, from iReal's layout (e.g. a 2nd ending indented under the 1st). */
  spacer?: number;
  /** Extra vertical space before the bar's row (iReal's Y). */
  vspace?: number;
  /** Start a new row here. Set in the editor; iReal itself has no such mark. */
  br?: boolean;
}

export interface Chart {
  v: 1;
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

export function blankBar(cells = DEFAULT_BAR_CELLS): Bar {
  return { id: newId(), cells: Array.from({ length: cells }, () => ({})) };
}

export function blankChart(bars = 16): Chart {
  const out: Bar[] = [];
  for (let i = 0; i < bars; i++) out.push(blankBar());
  out[0].open = '[';
  out[0].time = '4/4';
  out[out.length - 1].close = 'Z';
  return { v: 1, bars: out };
}

export function isBlank(c: Cell): boolean {
  return !c.ch && !c.sym;
}

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

/** The time signature in force at each bar. */
export function timeAt(chart: Chart): string[] {
  let t = '4/4';
  return chart.bars.map((b) => (t = b.time ?? t));
}

export type LayoutItem =
  | { kind: 'spacer'; span: number }
  | { kind: 'bar'; bar: Bar; index: number; span: number; start: number };

export interface LayoutRow {
  items: LayoutItem[];
  vspace: number;
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
    const span = Math.max(1, Math.min(ROW_CELLS, bar.cells.length));
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

/** Clamp untrusted chart JSON to the shape above. Returns null if it isn't a chart. */
export function sanitizeChart(input: unknown): Chart | null {
  if (!input || typeof input !== 'object') return null;
  const bars = (input as { bars?: unknown }).bars;
  if (!Array.isArray(bars) || bars.length > 2000) return null;
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : undefined);
  const out: Bar[] = [];
  const seen = new Set<string>();
  for (const raw of bars) {
    if (!raw || typeof raw !== 'object') return null;
    const b = raw as Record<string, unknown>;
    let id = str(b.id, 32) ?? newId();
    if (seen.has(id)) id = newId();
    seen.add(id);
    const cellsIn = Array.isArray(b.cells) ? b.cells.slice(0, 32) : [];
    const cells: Cell[] = cellsIn.map((rc) => {
      const c = (rc && typeof rc === 'object' ? rc : {}) as Record<string, unknown>;
      const cell: Cell = {};
      const ch = str(c.ch, 24);
      if (ch) cell.ch = ch;
      if (c.sym === 'x' || c.sym === 'r' || c.sym === 'p' || c.sym === 'n') cell.sym = c.sym;
      const alt = str(c.alt, 24);
      if (alt) cell.alt = alt;
      const text = str(c.text, 120);
      if (text) cell.text = text.replace(/[<>]/g, '');
      for (const k of ['small', 'fermata', 'segno', 'coda', 'end'] as const) if (c[k] === true) cell[k] = true;
      return cell;
    });
    if (cells.length === 0) cells.push({});
    const bar: Bar = { id, cells };
    if (b.open === '|' || b.open === '[' || b.open === '{') bar.open = b.open;
    if (b.close === ']' || b.close === '}' || b.close === 'Z') bar.close = b.close;
    const section = str(b.section, 1);
    if (section && /[A-Za-z]/.test(section)) bar.section = section;
    if (typeof b.time === 'string' && /^\d{1,2}\/\d{1,2}$/.test(b.time)) bar.time = b.time;
    if (typeof b.ending === 'number' && b.ending >= 0 && b.ending <= 9) bar.ending = Math.floor(b.ending);
    if (typeof b.spacer === 'number' && b.spacer > 0) bar.spacer = Math.min(15, Math.floor(b.spacer));
    if (typeof b.vspace === 'number' && b.vspace > 0) bar.vspace = Math.min(3, Math.floor(b.vspace));
    if (b.br === true) bar.br = true;
    out.push(bar);
  }
  return { v: 1, bars: out };
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
