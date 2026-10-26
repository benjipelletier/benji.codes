// Three-way merge of charts, bar by bar. Two people editing the same song
// rarely touch the same bars, so merging by bar id keeps both sets of edits;
// when they do touch the same bar, theirs (already saved) wins and the bar is
// reported back so the editor can say whose change it kept.

import { type Bar, type Chart, type SongMeta, canon, sameBar } from './chart';

export interface MergeResult<T> {
  value: T;
  /** Bars (or meta fields) both sides changed differently; theirs was kept. */
  conflicts: string[];
}

export function mergeCharts(base: Chart, mine: Chart, theirs: Chart): MergeResult<Chart> {
  const baseById = new Map(base.bars.map((b) => [b.id, b]));
  const mineById = new Map(mine.bars.map((b) => [b.id, b]));
  const theirsById = new Map(theirs.bars.map((b) => [b.id, b]));
  const conflicts: string[] = [];

  // Start from their order and content, then lay my changes over it.
  const out: Bar[] = [];
  for (const t of theirs.bars) {
    const b = baseById.get(t.id);
    const m = mineById.get(t.id);
    if (!b) {
      out.push(t); // they added it
      continue;
    }
    if (!m) {
      // I deleted it. If they changed it meanwhile, their edit wins.
      if (sameBar(t, b)) continue;
      conflicts.push(t.id);
      out.push(t);
      continue;
    }
    if (sameBar(m, b)) out.push(t);
    else if (sameBar(t, b) || sameBar(t, m)) out.push(m);
    else {
      conflicts.push(t.id);
      out.push(t);
    }
  }
  // Bars I deleted that they also changed are kept above; bars they deleted
  // that I changed are a conflict, and stay deleted.
  for (const m of mine.bars) {
    const b = baseById.get(m.id);
    if (b && !theirsById.has(m.id) && !sameBar(m, b)) conflicts.push(m.id);
  }
  // Bars I added go after the bar that precedes them in my chart.
  const pos = new Map(out.map((b, i) => [b.id, i]));
  mine.bars.forEach((m, i) => {
    if (baseById.has(m.id) || theirsById.has(m.id)) return;
    let after = -1;
    for (let k = i - 1; k >= 0; k--) {
      const p = pos.get(mine.bars[k].id);
      if (p != null) {
        after = p;
        break;
      }
    }
    out.splice(after + 1, 0, m);
    pos.clear();
    out.forEach((b, j) => pos.set(b.id, j));
  });
  return { value: { v: 1, bars: out }, conflicts };
}

export function mergeMeta(base: SongMeta, mine: SongMeta, theirs: SongMeta): MergeResult<SongMeta> {
  const out = { ...theirs } as Record<string, unknown>;
  const conflicts: string[] = [];
  for (const k of Object.keys(theirs) as (keyof SongMeta)[]) {
    const b = canon(base[k]);
    const m = canon(mine[k]);
    const t = canon(theirs[k]);
    if (m === b || m === t) continue;
    if (t === b) out[k] = mine[k];
    else conflicts.push(k);
  }
  return { value: out as unknown as SongMeta, conflicts };
}

export interface Doc {
  meta: SongMeta;
  chart: Chart;
}

export function mergeDocs(base: Doc, mine: Doc, theirs: Doc): MergeResult<Doc> {
  const c = mergeCharts(base.chart, mine.chart, theirs.chart);
  const m = mergeMeta(base.meta, mine.meta, theirs.meta);
  return { value: { meta: m.value, chart: c.value }, conflicts: [...c.conflicts, ...m.conflicts] };
}

export function sameDoc(a: Doc, b: Doc): boolean {
  return canon(a) === canon(b);
}
