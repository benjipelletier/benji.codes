// What changed between two versions of a song, bar by bar: for highlighting a
// version against the current chart, and for the one-line summaries in the
// version history and the edit log ("Edited bars 5–8, added 4 bars").

import { type Chart, type SongMeta, canon, sameBar } from './chart';

export interface ChartDiff {
  /** Ids of bars in `after` that are new or changed. */
  changed: Set<string>;
  added: number;
  removed: number;
  edited: number;
}

export function diffCharts(before: Chart, after: Chart): ChartDiff {
  const old = new Map(before.bars.map((b) => [b.id, b]));
  const now = new Set(after.bars.map((b) => b.id));
  const changed = new Set<string>();
  let added = 0;
  let edited = 0;
  for (const b of after.bars) {
    const o = old.get(b.id);
    if (!o) {
      added++;
      changed.add(b.id);
    } else if (!sameBar(o, b)) {
      edited++;
      changed.add(b.id);
    }
  }
  const removed = before.bars.filter((b) => !now.has(b.id)).length;
  return { changed, added, removed, edited };
}

/** "5–8, 12" from bar numbers. */
export function ranges(nums: number[]): string {
  const sorted = [...new Set(nums)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out.push(i === j ? `${sorted[i]}` : `${sorted[i]}–${sorted[j]}`);
    i = j;
  }
  return out.join(', ');
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function summarize(
  before: { meta: SongMeta; chart: Chart } | null,
  after: { meta: SongMeta; chart: Chart },
): string {
  if (!before) return `${after.chart.bars.length} bars`;
  const parts: string[] = [];
  const d = diffCharts(before.chart, after.chart);
  if (d.edited) {
    const nums = after.chart.bars.flatMap((b, i) => (d.changed.has(b.id) && before.chart.bars.some((o) => o.id === b.id) ? [i + 1] : []));
    parts.push(`edited bar${nums.length === 1 ? '' : 's'} ${ranges(nums)}`);
  }
  if (d.added) parts.push(`added ${plural(d.added, 'bar')}`);
  if (d.removed) parts.push(`removed ${plural(d.removed, 'bar')}`);
  const m0 = before.meta;
  const m1 = after.meta;
  if (m0.title !== m1.title) parts.push(`renamed to “${m1.title}”`);
  if (m0.key !== m1.key) parts.push(`key ${m0.key.replace('-', 'm')} → ${m1.key.replace('-', 'm')}`);
  if (m0.composer !== m1.composer) parts.push(m1.composer ? `composer ${m1.composer}` : 'composer cleared');
  if (m0.style !== m1.style) parts.push(`style ${m1.style || 'cleared'}`);
  if (m0.bpm !== m1.bpm) parts.push(m1.bpm ? `tempo ${m1.bpm}` : 'tempo cleared');
  if (!parts.length) return canon(before) === canon(after) ? 'no changes' : 'layout';
  const s = parts.join(', ');
  return s[0].toUpperCase() + s.slice(1);
}
