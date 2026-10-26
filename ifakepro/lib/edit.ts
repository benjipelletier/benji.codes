// Edits the editor makes to a chart, as pure functions over bar ranges.

import { type Bar, type Cell, type Chart, DEFAULT_BAR_CELLS, blankBar, isBlank, newId } from './chart';
import { barToText, parseBarText, spread, transposeCells } from './chords';

type Patch = Partial<Omit<Bar, 'id' | 'cells'>>;

const withBars = (c: Chart, bars: Bar[]): Chart => ({ ...c, bars });

export function mapRange(c: Chart, from: number, to: number, fn: (b: Bar, i: number) => Bar): Chart {
  return withBars(c, c.bars.map((b, i) => (i >= from && i <= to ? fn(b, i) : b)));
}

/** Set (or with undefined, clear) bar fields. */
export function patchBar(c: Chart, i: number, patch: Patch): Chart {
  return mapRange(c, i, i, (b) => {
    const out = { ...b, ...patch } as Bar & Record<string, unknown>;
    for (const k of Object.keys(patch)) if (out[k] === undefined) delete out[k];
    return out;
  });
}

export function setCells(c: Chart, i: number, cells: Cell[]): Chart {
  return mapRange(c, i, i, (b) => ({ ...b, cells }));
}

export function patchCell(c: Chart, i: number, cell: number, patch: Partial<Cell>): Chart {
  return mapRange(c, i, i, (b) => ({
    ...b,
    cells: b.cells.map((x, j) => {
      if (j !== cell) return x;
      const out = { ...x, ...patch } as Cell & Record<string, unknown>;
      for (const k of Object.keys(patch)) if (out[k] === undefined || out[k] === false) delete out[k];
      return out;
    }),
  }));
}

export function insertBars(c: Chart, at: number, n = 1, cells = DEFAULT_BAR_CELLS): Chart {
  const bars = c.bars.slice();
  bars.splice(at, 0, ...Array.from({ length: n }, () => blankBar(cells)));
  // A final barline belongs on the last bar.
  if (at === c.bars.length && at > 0 && bars[at - 1].close === 'Z') {
    bars[at - 1] = { ...bars[at - 1] };
    delete bars[at - 1].close;
    bars[bars.length - 1] = { ...bars[bars.length - 1], close: 'Z' };
  }
  return withBars(c, bars);
}

/** Copies of bars with new ids, so comments and merges keep the originals apart. */
export function cloneBars(bars: Bar[]): Bar[] {
  return bars.map((b) => ({ ...structuredClone(b), id: newId() }));
}

export function insertCopies(c: Chart, at: number, copies: Bar[]): Chart {
  const bars = c.bars.slice();
  bars.splice(at, 0, ...cloneBars(copies));
  return withBars(c, bars);
}

export function deleteBars(c: Chart, from: number, to: number): Chart {
  const bars = c.bars.filter((_, i) => i < from || i > to);
  return withBars(c, bars.length ? bars : [blankBar()]);
}

export function clearChords(c: Chart, from: number, to: number): Chart {
  return mapRange(c, from, to, (b) => ({ ...b, cells: b.cells.map((x) => ({ ...(x.text ? { text: x.text } : {}) })) }));
}

/** Put a repeat (or double bar) around a range, or take it off if it's already there. */
export function toggleWrap(c: Chart, from: number, to: number, open: '{' | '[', close: '}' | ']'): Chart {
  const on = c.bars[from].open === open && c.bars[to].close === close;
  let out = patchBar(c, from, { open: on ? undefined : open });
  out = patchBar(out, to, { close: on ? undefined : close });
  return out;
}

export function clearBarlines(c: Chart, from: number, to: number): Chart {
  return mapRange(c, from, to, (b) => {
    const out = { ...b };
    delete out.open;
    delete out.close;
    return out;
  });
}

/** Change how many cells the bars have, keeping their chords spread the same way. */
export function setCellCount(c: Chart, from: number, to: number, n: number): Chart {
  return mapRange(c, from, to, (b) => {
    if (b.cells.length === n) return b;
    const filled = b.cells.filter((x) => !isBlank(x) || x.alt || x.text);
    if (filled.length > n) return b;
    const cells: Cell[] = Array.from({ length: n }, () => ({}));
    spread(filled.length, n).forEach((p, k) => (cells[p] = filled[k]));
    return { ...b, cells };
  });
}

export function transposeChart(c: Chart, semis: number, flats: boolean): Chart {
  return withBars(c, c.bars.map((b) => ({ ...b, cells: transposeCells(b.cells, semis, flats) })));
}

/** Bars as text, for the system clipboard: "C-7 F7 | Bb^7 | …". */
export function barsToText(bars: Bar[]): string {
  return bars.map((b) => barToText(b.cells) || '.').join(' | ');
}

/** Text pasted from elsewhere, one bar per | (or per line). Null if it isn't chords. */
export function textToBars(text: string): Bar[] | null {
  const parts = text.split(/\||\n/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length || parts.length > 400) return null;
  const bars: Bar[] = [];
  for (const p of parts) {
    const { cells, errors } = parseBarText(p, blankBar().cells);
    if (errors.length) return null;
    bars.push({ id: newId(), cells });
  }
  return bars;
}
