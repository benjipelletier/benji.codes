// Checks for iFake Pro's libraries. Run: npx tsx ifakepro/scripts/test-lib.ts
//
// The main one reads every song in the jazz project's iReal file (1,460
// standards), writes each back out as an iReal link and reads it again: the
// two readings must be the same chart. It also cross-checks the chords read
// against ireal-reader, and runs the merge, diff and chord helpers on cases
// small enough to reason about.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { type Chart, blankBar, canon, layout } from '../lib/chart';
import { parseIReal, parseLink, parseMusic, scramble, serializeMusic, serializePlaylist, serializeSong, unscramble } from '../lib/ireal';
import { barToText, normalizeChord, parseBarText, transposeChord, transposeKey } from '../lib/chords';
import { mergeCharts } from '../lib/merge';
import { summarize } from '../lib/diff';
import { loadStandards } from '../lib/standards';

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL ${name}\n     ${e instanceof Error ? e.message.split('\n').slice(0, 6).join('\n     ') : e}`);
  }
}

const noIds = (c: Chart) => canon({ ...c, bars: c.bars.map(({ id: _id, ...b }) => b) });

const raw = readFileSync(join(__dirname, '../../jazz/charts_raw/jazz.ireal'), 'utf8');
const corpus = parseIReal(raw);

check('reads the whole corpus', () => {
  assert.equal(corpus.failed.length, 0, JSON.stringify(corpus.failed.slice(0, 3)));
  assert.equal(corpus.songs.length, 1460);
  assert.equal(corpus.name, 'Jazz 1460');
});

check('no characters skipped in any chart', () => {
  const body = decodeURIComponent(raw.trim().replace(/^irealb:\/\//, ''));
  const bad: string[] = [];
  for (const part of body.split('===')) {
    const f = part.split('=');
    if (f.length < 7) continue;
    const { unknown } = parseMusic(unscramble(f[6].replace(/^1r34LbKcu7/, '')));
    if (unknown) bad.push(`${f[0]}: ${JSON.stringify(unknown)}`);
  }
  assert.equal(bad.length, 0, bad.slice(0, 10).join('\n'));
});

check('scramble undoes itself', () => {
  for (const n of [0, 10, 50, 51, 52, 100, 101, 102, 333]) {
    const s = Array.from({ length: n }, (_, i) => String.fromCharCode(33 + (i % 90))).join('');
    assert.equal(unscramble(scramble(s)), s, `length ${n}`);
  }
});

check('every song survives write → read', () => {
  const bad: string[] = [];
  for (const song of corpus.songs) {
    const again = parseLink(serializeSong(song)).songs[0];
    if (!again || noIds(again.chart) !== noIds(song.chart) || canon(again.meta) !== canon(song.meta)) bad.push(song.meta.title);
  }
  assert.equal(bad.length, 0, `${bad.length} differ: ${bad.slice(0, 10).join(', ')}`);
});

check('the whole playlist survives write → read', () => {
  const again = parseIReal(serializePlaylist('Jazz 1460', corpus.songs));
  assert.equal(again.name, 'Jazz 1460');
  assert.equal(again.songs.length, 1460);
  assert.equal(noIds(again.songs[777].chart), noIds(corpus.songs[777].chart));
});

check('chords match ireal-reader', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const reader = require('ireal-reader') as (s: string) => { songs: { title: string; music: { raw: string } }[] };
  const theirs = reader(raw).songs;
  const bad: string[] = [];
  theirs.forEach((t, i) => {
    // Their raw string is the unscrambled chart; compare the chord sequences.
    const expected = (t.music.raw.replace(/Kcl/g, '| x').replace(/LZ/g, ' |').replace(/XyQ/g, '   ').replace(/<[^>]*>/g, '').replace(/\([^)]*\)/g, '').replace(/\*[A-Za-z]/g, '')
      .match(/[A-GW][b#]?(?:\*[^*|]{0,12}\*|(?:sus|add|alt|[0-9b#^\-ho+])*)(?:\/[A-G][b#]?)?/g) ?? []);
    const ours = corpus.songs[i].chart.bars.flatMap((b) => b.cells.flatMap((c) => (c.ch ? [c.ch] : [])));
    if (expected.join(' ') !== ours.join(' ')) bad.push(t.title);
  });
  assert.equal(bad.length, 0, `${bad.length} differ: ${bad.slice(0, 10).join(', ')}`);
});

check('known song reads right: Autumn Leaves', () => {
  const s = corpus.songs.find((x) => x.meta.title === 'Autumn Leaves')!;
  assert.equal(s.meta.composer, 'Joseph Kosma');
  assert.equal(s.meta.key, 'G-');
  const b = s.chart.bars;
  assert.equal(b[0].section, 'A');
  assert.equal(b[0].open, '{');
  assert.equal(b[0].time, '4/4');
  assert.equal(b[0].cells[0].ch, 'C-7');
  assert.equal(b[0].cells.length, 4);
  assert.equal(b[7].cells[1].sym, 'x');
  assert.equal(b[7].close, '}');
  assert.equal(b[8].section, 'B');
  assert.equal(b.at(-1)!.close, 'Z');
  assert.equal(b.length, 24);
  const rows = layout(s.chart);
  assert.equal(rows.length, 6);
});

check('known song reads right: 9.20 Special endings and spacer', () => {
  const s = corpus.songs.find((x) => x.meta.title === '9.20 Special')!;
  const n1 = s.chart.bars.find((b) => b.ending === 1)!;
  const n2 = s.chart.bars.find((b) => b.ending === 2)!;
  assert.ok(n1 && n2);
  assert.equal(n2.spacer, 8);
  const rows = layout(s.chart);
  const row = rows.find((r) => r.items.some((it) => it.kind === 'bar' && it.bar.id === n2.id))!;
  assert.equal(row.items[0].kind, 'spacer');
  const small = s.chart.bars[5].cells;
  assert.deepEqual(small.map((c) => c.small), [true, true, true, true]);
});

check('alternate chords on chords and on empty cells', () => {
  const s = corpus.songs.find((x) => x.meta.title === 'Stella By Starlight')!;
  const bar = s.chart.bars.find((b) => b.cells.some((c) => c.alt === 'G-7'))!;
  assert.equal(bar.cells[0].ch, 'Eh7');
  assert.equal(bar.cells[2].alt, 'C7');
  assert.equal(bar.cells.length, 4);
});

check('normalizes typed chords', () => {
  const cases: [string, string | null][] = [
    ['Cm7', 'C-7'], ['Cmaj7', 'C^7'], ['CM7', 'C^7'], ['C△7', 'C^7'], ['Cmin7', 'C-7'], ['Cm7b5', 'Ch7'],
    ['Cø7', 'Ch7'], ['Cdim7', 'Co7'], ['C°', 'Co'], ['Caug', 'C+'], ['c#7', 'C#7'], ['Bb7/d', 'Bb7/D'],
    ['C7sus4', 'C7sus4'], ['C6/9', 'C69'], ['F-^7', 'F-^7'], ['Ebm(maj7)', 'Eb-^7'], ['/E', 'W/E'],
    ['H7', null], ['C7/X', null], ['', null], ['Gm', 'G-'],
  ];
  for (const [i, o] of cases) assert.equal(normalizeChord(i), o, i);
});

check('transposes chords and keys', () => {
  assert.equal(transposeChord('C-7', 2, false), 'D-7');
  assert.equal(transposeChord('Bb7/D', 1, false), 'B7/D#');
  assert.equal(transposeChord('Bb7/D', 1, true), 'B7/Eb');
  assert.equal(transposeChord('W/C', 3, true), 'W/Eb');
  assert.equal(transposeKey('Eb', 2), 'F');
  assert.equal(transposeKey('G-', 3), 'Bb-');
  assert.equal(transposeKey('C', -1), 'B');
});

check('bar text round-trips', () => {
  const b = parseBarText('C-7 F7', blankBar().cells);
  assert.deepEqual(b.errors, []);
  assert.deepEqual(b.cells.map((c) => c.ch ?? null), ['C-7', null, 'F7', null]);
  assert.equal(barToText(b.cells), 'C-7 F7');
  const c = parseBarText('C . D7 E7', blankBar().cells);
  assert.equal(barToText(c.cells), 'C . D7 E7');
  const d = parseBarText('C7(Db7) %', blankBar().cells);
  assert.equal(d.cells[0].alt, 'Db7');
  assert.equal(d.cells[2].sym, 'x');
  const e = parseBarText('Q7 C', blankBar().cells);
  assert.deepEqual(e.errors, ['Q7']);
  const f = parseBarText('C D E F G A', blankBar().cells);
  assert.equal(f.cells.length, 6);
});

function chart(...ids: string[]): Chart {
  return { v: 1, bars: ids.map((id) => ({ id, cells: [{ ch: id.toUpperCase().replace(/\d/g, '') || 'C' }, {}, {}, {}] })) };
}
const edit = (c: Chart, id: string, ch: string): Chart => ({ ...c, bars: c.bars.map((b) => (b.id === id ? { ...b, cells: [{ ch }, {}, {}, {}] } : b)) });

check('merge: edits to different bars both land', () => {
  const base = chart('a', 'b', 'c');
  const r = mergeCharts(base, edit(base, 'a', 'D7'), edit(base, 'c', 'E7'));
  assert.deepEqual(r.value.bars.map((b) => b.cells[0].ch), ['D7', 'B', 'E7']);
  assert.deepEqual(r.conflicts, []);
});

check('merge: same bar, theirs wins and is reported', () => {
  const base = chart('a', 'b');
  const r = mergeCharts(base, edit(base, 'b', 'D7'), edit(base, 'b', 'E7'));
  assert.equal(r.value.bars[1].cells[0].ch, 'E7');
  assert.deepEqual(r.conflicts, ['b']);
});

check('merge: inserts land after their neighbour, deletes apply', () => {
  const base = chart('a', 'b', 'c');
  const mine: Chart = { v: 1, bars: [base.bars[0], { id: 'n', cells: [{ ch: 'G7' }] }, base.bars[1], base.bars[2]] };
  const theirs: Chart = { v: 1, bars: [base.bars[0], base.bars[2]] };
  const r = mergeCharts(base, mine, theirs);
  assert.deepEqual(r.value.bars.map((b) => b.id), ['a', 'n', 'c']);
});

check('merge: I delete a bar they edited — their edit stays', () => {
  const base = chart('a', 'b');
  const r = mergeCharts(base, { v: 1, bars: [base.bars[0]] }, edit(base, 'b', 'F7'));
  assert.deepEqual(r.value.bars.map((b) => b.id), ['a', 'b']);
  assert.deepEqual(r.conflicts, ['b']);
});

check('diff summary', () => {
  const s = corpus.songs[0];
  const after = { meta: { ...s.meta, key: 'D' }, chart: edit(s.chart, s.chart.bars[4].id, 'F7') };
  after.chart.bars.push(blankBar(), blankBar());
  assert.equal(summarize(s, after), 'Edited bar 5, added 2 bars, key C → D');
});

check('standards library loads', () => {
  const lib = loadStandards();
  assert.equal(lib.length, 1460);
  assert.ok(lib.find((s) => s.meta.title === 'Giant Steps'));
});

check('serialized music for a hand-made chart reads back', () => {
  const c: Chart = { v: 1, bars: [{ ...blankBar(), open: '[', time: '3/4', section: 'A', cells: [{ ch: 'C^7', text: 'Fine' }, {}, {}] }, { ...blankBar(), open: '|', close: 'Z', cells: [{ ch: 'G7', fermata: true }, {}, {}] }] };
  const again = parseMusic(serializeMusic(c)).chart;
  assert.equal(noIds(again), noIds(c));
});

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
