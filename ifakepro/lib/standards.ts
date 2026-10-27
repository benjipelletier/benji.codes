// The standards library: the 1,460 charts in the jazz project's iReal file,
// read once per server instance. Read-only — picking one copies its chart into
// a playlist as an ordinary song, which is then the playlist's to edit.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ParsedSong, parseIReal } from './ireal';

export const STANDARDS_FILE = 'jazz/charts_raw/jazz.ireal';

export interface Standard extends ParsedSong {
  index: number;
}

let cache: Standard[] | null = null;

export function loadStandards(): Standard[] {
  if (!cache) {
    const raw = readFileSync(join(process.cwd(), STANDARDS_FILE), 'utf8');
    cache = parseIReal(raw).songs.map((s, index) => ({ ...s, index }));
  }
  return cache;
}

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function searchStandards(q: string, limit = 50): Standard[] {
  const all = loadStandards();
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return all.slice(0, limit);
  const scored: [number, Standard][] = [];
  for (const s of all) {
    const title = fold(s.meta.title);
    const hay = `${title} ${fold(s.meta.composer)} ${fold(s.meta.style)}`;
    if (!words.every((w) => hay.includes(w))) continue;
    const score = title.startsWith(words.join(' ')) ? 0 : words.every((w) => title.includes(w)) ? 1 : 2;
    scored.push([score, s]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].meta.title.localeCompare(b[1].meta.title));
  return scored.slice(0, limit).map(([, s]) => s);
}
