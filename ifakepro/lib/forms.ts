// Starting points for a new chart: empty bars, or a common form laid out with
// its sections (and, for the blues, its changes) in the song's key.

import { type Bar, type Chart, blankChart, meter } from './chart';
import { keyRoot, noteIndex, prefersFlats, transposeChord } from './chords';
import { parseBar } from './progression';

export const FORMS = [
  { id: 'empty', label: 'Empty — 16 bars' },
  { id: 'blues', label: '12-bar blues' },
  { id: 'jazzblues', label: 'Jazz blues (12)' },
  { id: 'aaba', label: '32-bar AABA' },
  { id: 'abac', label: '32-bar ABAC' },
] as const;

export type FormId = (typeof FORMS)[number]['id'];

const BLUES = ['C7', 'F7', 'C7', 'C7', 'F7', 'F7', 'C7', 'C7', 'G7', 'F7', 'C7', 'G7'];
const JAZZ_BLUES = ['C7', 'F7', 'C7', 'G-7 C7', 'F7', 'F#o7', 'C7', 'A7', 'D-7', 'G7', 'C7 A7', 'D-7 G7'];
const MINOR_BLUES = ['C-7', 'F-7', 'C-7', 'C-7', 'F-7', 'F-7', 'C-7', 'C-7', 'Ab7', 'G7', 'C-7', 'G7'];

function sections(bars: Bar[], letters: string): Bar[] {
  [...letters].forEach((l, k) => {
    const b = bars[k * 8];
    b.section = l;
    b.open = '[';
    if (k > 0) bars[k * 8 - 1].close = ']';
  });
  return bars;
}

export function formChart(id: FormId, key = 'C', time = '4/4'): Chart {
  if (id === 'blues' || id === 'jazzblues') {
    const { root, minor } = keyRoot(key);
    const semis = noteIndex(root) ?? 0;
    const flats = prefersFlats(key);
    const changes = minor ? MINOR_BLUES : id === 'blues' ? BLUES : JAZZ_BLUES;
    const m = meter(time);
    const c = blankChart(12, time);
    c.bars.forEach((b, k) => {
      const text = changes[k].split(' ').map((ch) => transposeChord(ch, semis, flats)).join(' ');
      b.events = parseBar(text, m).events;
    });
    c.bars[0].section = 'A';
    c.bars[0].open = '{';
    c.bars[11].close = '}';
    return c;
  }
  if (id === 'aaba' || id === 'abac') {
    const c = blankChart(32, time);
    c.bars[31].close = 'Z';
    sections(c.bars, id === 'aaba' ? 'AABA' : 'ABAC');
    c.bars[0].time = time;
    return c;
  }
  return blankChart(16, time);
}
