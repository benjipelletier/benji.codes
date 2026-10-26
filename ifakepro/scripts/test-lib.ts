// Checks for iFake Pro's libraries. Run: npx tsx ifakepro/scripts/test-lib.ts
//
// The main one reads every song in the jazz project's iReal file (1,460
// standards), writes each back out as an iReal link and reads it again: the
// two readings must be the same chart. It also cross-checks the chords read
// against ireal-reader, checks that charts stored in the old cell format
// upgrade to timelines, and runs the editor's operations — timeline edits,
// bar edits, typed progressions, undo through merges — on small cases.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { type Bar, type Chart, type Ev, EMPTY_META, blankBar, blankChart, canon, layout, meter, metersOf, normalizeChart, sanitizeChart } from '../lib/chart';
import { cellChartToChart, chartToCellChart } from '../lib/convert';
import { parseCells, parseIReal, parseLink, parseMusic, scramble, serializeMusic, serializePlaylist, serializeSong, unscramble } from '../lib/ireal';
import { chordText, joinChord, normalizeChord, splitChord, transposeChord, transposeKey, tritoneSub, twoOf } from '../lib/chords';
import {
  deleteBars, duplicateBars, insertAt, insertBars, mergeWithNext, moveBars, moveBoundary, removeEvent, replaceEvents, setChord, setDuration,
  setKind, shiftEvent, splitEvent, splitOnGrid, transposeBars, patchBar, sectionRange,
} from '../lib/edit';
import { barText, parseBar, parseProgression } from '../lib/progression';
import { formChart } from '../lib/forms';
import { mergeCharts, mergeDocs } from '../lib/merge';
import { summarize } from '../lib/diff';
import { loadStandards } from '../lib/standards';
import { agentBars, applyOps, changes, chartText, type Doc } from '../lib/script';

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL ${name}\n     ${e instanceof Error ? e.message.split('\n').slice(0, 8).join('\n     ') : e}`);
  }
}

/** A chart without ids, for comparing two readings of the same music. */
const noIds = (c: Chart) => canon({ ...c, bars: c.bars.map(({ id: _id, ...b }) => ({ ...b, events: b.events.map(({ id: _e, ...e }) => e) })) });
/** "Dm7@0:48 r@48:24" — a bar's timeline, for asserting on. */
const tl = (b: { events: Ev[] }) => b.events.map((e) => `${e.kind === 'chord' ? e.ch : e.kind}@${e.at}:${e.dur}`).join(' ');
const valid = (c: Chart) => {
  const ms = metersOf(c);
  c.bars.forEach((b, i) => {
    let at = 0;
    for (const e of b.events) {
      assert.equal(e.at, at, `bar ${i + 1}: event starts where the last one ended`);
      assert.ok(e.dur > 0, `bar ${i + 1}: positive length`);
      at += e.dur;
    }
    assert.equal(at, ms[i].length, `bar ${i + 1}: events fill the bar`);
  });
};

const raw = readFileSync(join(__dirname, '../../jazz/charts_raw/jazz.ireal'), 'utf8');
const corpus = parseIReal(raw);
const song = (t: string) => corpus.songs.find((x) => x.meta.title === t)!;

// ---------------------------------------------------------------- iReal

check('reads the whole corpus', () => {
  assert.equal(corpus.failed.length, 0, JSON.stringify(corpus.failed.slice(0, 3)));
  assert.equal(corpus.songs.length, 1460);
  assert.equal(corpus.name, 'Jazz 1460');
});

check('every chart is a valid timeline', () => {
  for (const s of corpus.songs) valid(s.chart);
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
  for (const s of corpus.songs) {
    const again = parseLink(serializeSong(s)).songs[0];
    if (!again || noIds(again.chart) !== noIds(s.chart) || canon(again.meta) !== canon(s.meta)) bad.push(s.meta.title);
  }
  assert.equal(bad.length, 0, `${bad.length} differ: ${bad.slice(0, 10).join(', ')}`);
});

check('the iReal cells come back exactly (timelines lose nothing iReal had)', () => {
  const body = decodeURIComponent(raw.trim().replace(/^irealb:\/\//, ''));
  const bad: string[] = [];
  for (const part of body.split('===')) {
    const f = part.split('=');
    if (f.length < 7) continue;
    const cells = parseCells(unscramble(f[6].replace(/^1r34LbKcu7/, ''))).chart;
    const back = chartToCellChart(cellChartToChart(cells));
    const strip = (c: typeof cells) => canon(c.bars.map(({ id: _id, ...b }) => b));
    if (strip(back) !== strip(cells)) bad.push(f[0]);
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
    const expected = (t.music.raw.replace(/Kcl/g, '| x').replace(/LZ/g, ' |').replace(/XyQ/g, '   ').replace(/<[^>]*>/g, '').replace(/\([^)]*\)/g, '').replace(/\*[A-Za-z]/g, '')
      .match(/[A-GW][b#]?(?:\*[^*|]{0,12}\*|(?:sus|add|alt|[0-9b#^\-ho+])*)(?:\/[A-G][b#]?)?/g) ?? []);
    const ours = corpus.songs[i].chart.bars.flatMap((b) => b.events.flatMap((e) => (e.ch ? [e.ch] : [])));
    if (expected.join(' ') !== ours.join(' ')) bad.push(t.title);
  });
  assert.equal(bad.length, 0, `${bad.length} differ: ${bad.slice(0, 10).join(', ')}`);
});

check('Autumn Leaves reads right', () => {
  const s = song('Autumn Leaves');
  assert.equal(s.meta.composer, 'Joseph Kosma');
  assert.equal(s.meta.key, 'G-');
  const b = s.chart.bars;
  assert.equal(b[0].section, 'A');
  assert.equal(b[0].open, '{');
  assert.equal(b[0].time, '4/4');
  assert.equal(tl(b[0]), 'C-7@0:96');
  assert.equal(b[7].simile, 1);
  assert.equal(b[7].close, '}');
  assert.equal(b[8].section, 'B');
  assert.equal(b.at(-1)!.close, 'Z');
  assert.equal(b.length, 24);
  assert.equal(tl(b[18]), 'G-7@0:48 Gb7@48:48');
  assert.equal(layout(s.chart).length, 6);
});

check('9.20 Special: endings, layout spacer, four small chords', () => {
  const s = song('9.20 Special');
  const n2 = s.chart.bars.find((b) => b.ending === 2)!;
  assert.equal(n2.spacer, 8);
  const row = layout(s.chart).find((r) => r.items.some((it) => it.kind === 'bar' && it.bar.id === n2.id))!;
  assert.equal(row.items[0].kind, 'spacer');
  assert.equal(tl(s.chart.bars[5]), 'C7@0:24 B7@24:24 Bb7@48:24 A7@72:24');
  assert.ok(s.chart.bars[5].events.every((e) => e.small));
});

check('alternate chords on chords and on empty cells (Stella)', () => {
  const s = song('Stella By Starlight');
  const bar = s.chart.bars.find((b) => b.events.some((e) => e.alt === 'G-7'))!;
  assert.equal(bar.events[0].ch, 'Eh7');
  const hold = bar.events.find((e) => e.alt === 'C7')!;
  assert.equal(hold.kind, 'hold', 'an alternate over an empty cell is a hold, not a new chord');
});

check('odd meters: chords land on beats (waltz 2+1, Take Five 3+2)', () => {
  const waltz = parseMusic('[T34C   D |E   Z').chart;
  assert.equal(tl(waltz.bars[0]), 'C@0:48 D@48:24');
  const five = parseMusic('[T54Eb-7 Bb-7 Z').chart;
  assert.equal(tl(five.bars[0]), 'Eb-7@0:72 Bb-7@72:48');
  const back = serializeMusic(five);
  assert.equal(tl(parseMusic(back).chart.bars[0]), 'Eb-7@0:72 Bb-7@72:48');
});

check('acceptance 9 · charts stored in the old cell format load as timelines', () => {
  const v1 = { v: 1, bars: [{ id: 'b1', open: '[', time: '4/4', cells: [{ ch: 'D-7' }, {}, { ch: 'G7' }, {}] }, { id: 'b2', close: 'Z', cells: [{}, { sym: 'x' }, {}, {}] }] };
  const c = sanitizeChart(v1)!;
  assert.equal(c.v, 2);
  assert.equal(tl(c.bars[0]), 'D-7@0:48 G7@48:48');
  assert.equal(c.bars[0].events[0].id, 'b1.0', 'upgrade ids are deterministic');
  assert.equal(c.bars[1].simile, 1);
  assert.equal(canon(sanitizeChart(v1)), canon(c));
  assert.equal(canon(sanitizeChart(c)), canon(c), 'sanitizing a v2 chart changes nothing');
  valid(c);
});

// ---------------------------------------------------------------- chords

check('normalizes typed chords', () => {
  const cases: [string, string | null][] = [
    ['Cm7', 'C-7'], ['Cmaj7', 'C^7'], ['CM7', 'C^7'], ['C△7', 'C^7'], ['Cmin7', 'C-7'], ['Cm7b5', 'Ch7'],
    ['Cø7', 'Ch7'], ['Cdim7', 'Co7'], ['C°', 'Co'], ['Caug', 'C+'], ['c#7', 'C#7'], ['Bb7/d', 'Bb7/D'],
    ['C7sus4', 'C7sus4'], ['C6/9', 'C69'], ['F-^7', 'F-^7'], ['Ebm(maj7)', 'Eb-^7'], ['/E', 'W/E'],
    ['H7', null], ['C7/X', null], ['', null], ['Gm', 'G-'], ['C7(b9)', 'C7b9'], ['CmMaj7', 'C-^7'],
  ];
  for (const [i, o] of cases) assert.equal(normalizeChord(i), o, i);
});

check('chord text round-trips through the text field', () => {
  for (const ch of ['C-7', 'C^7', 'Ch7', 'Co7', 'C7b9', 'Bb-^7', 'F#7#11/A', 'C+', 'Eb69', 'G7alt', 'D7sus']) {
    assert.equal(normalizeChord(chordText(ch)), ch, `${ch} → ${chordText(ch)}`);
  }
});

check('acceptance 8 · transposing keeps quality, extensions, alterations and bass', () => {
  assert.equal(transposeChord('C-7', 2, false), 'D-7');
  assert.equal(transposeChord('Bb7b9#11/D', 1, false), 'B7b9#11/D#');
  assert.equal(transposeChord('Bb7b9#11/D', 1, true), 'B7b9#11/Eb');
  assert.equal(transposeChord('W/C', 3, true), 'W/Eb');
  assert.equal(transposeKey('Eb', 2), 'F');
  assert.equal(transposeKey('G-', 3), 'Bb-');
  const c: Chart = { v: 2, bars: [{ id: 'a', events: [{ id: 'e1', at: 0, dur: 96, kind: 'chord', ch: 'G7alt/Db', alt: 'Db7' }] }] };
  const t = transposeBars(c, 0, 0, -7, false);
  assert.equal(t.bars[0].events[0].ch, 'C7alt/F#');
  assert.equal(t.bars[0].events[0].alt, 'F#7');
  assert.equal(tritoneSub('G7b9', true), 'Db7b9');
  assert.equal(twoOf('G7', false), 'D-7');
  const p = splitChord('F#-7b5/C')!;
  assert.equal(joinChord({ ...p, root: 'Bb' }), 'Bb-7b5/C', 'changing the root keeps quality and bass');
  assert.equal(joinChord({ ...p, quality: '7' }), 'F#7/C', 'changing the quality keeps root and bass');
});

// ---------------------------------------------------------------- timeline edits

const one = (...bars: Ev[][]): Chart => ({ v: 2, bars: bars.map((events, k) => ({ id: `b${k}`, events })) });
const ev = (id: string, at: number, dur: number, kind: Ev['kind'] = 'chord', ch?: string): Ev => ({ id, at, dur, kind, ...(ch ? { ch } : {}) });

check('acceptance 1 · changing one chord leaves its neighbours alone', () => {
  const c = one([ev('a', 0, 48, 'chord', 'D-7'), ev('b', 48, 48, 'chord', 'G7')], [ev('c', 0, 96, 'chord', 'C^7')]);
  const d = setChord(c, 0, 'b', 'Db7');
  assert.equal(tl(d.bars[0]), 'D-7@0:48 Db7@48:48');
  assert.equal(canon(d.bars[0].events[0]), canon(c.bars[0].events[0]));
  assert.equal(canon(d.bars[1]), canon(c.bars[1]));
  assert.deepEqual(d.bars[0].events.map((e) => e.id), ['a', 'b'], 'ids stay put');
});

check('acceptance 2 · a bar holds chords of different lengths', () => {
  let c = one([ev('a', 0, 96, 'chord', 'D-7')]);
  c = splitEvent(c, 0, 'a', 2);
  c = setChord(c, 0, c.bars[0].events[1].id, 'G7');
  c = setDuration(c, 0, 'a', 72);
  assert.equal(tl(c.bars[0]), 'D-7@0:72 G7@72:24');
  valid(c);
});

check('acceptance 3 · a rest is its own event, not a hold', () => {
  let c = one([ev('a', 0, 96, 'chord', 'D-7')]);
  c = splitOnGrid(c, 0, 'a', 24);
  const [, b2, b3, b4] = c.bars[0].events.map((e) => e.id);
  assert.equal(tl(c.bars[0]), 'D-7@0:24 hold@24:24 hold@48:24 hold@72:24', 'splitting alone changes nothing you hear');
  c = mergeWithNext(c, 0, 'a');
  c = setKind(c, 0, b3, 'rest');
  c = setChord(c, 0, b4, 'G7');
  assert.equal(tl(c.bars[0]), 'D-7@0:48 rest@48:24 G7@72:24');
  assert.ok(!c.bars[0].events.some((e) => e.id === b2));
  assert.equal(barText(c.bars[0], meter('4/4')), 'Dm7:2 r:1 G7:1');
  assert.equal(chartToCellChart(c).bars[0].cells.map((x) => x.ch ?? x.sym ?? '.').join(' '), 'D-7 . n G7', 'iReal gets the rest as N.C.');
});

check('acceptance 4 · splitting into valid subdivisions (beats, eighths, triplets, 16ths)', () => {
  const m = meter('4/4');
  const base = one([ev('a', 0, 24, 'chord', 'C'), ev('b', 24, 72, 'chord', 'F')]);
  assert.equal(tl(splitEvent(base, 0, 'a', 2).bars[0]), 'C@0:12 hold@12:12 F@24:72');
  assert.equal(tl(splitOnGrid(base, 0, 'a', m.beat / 2).bars[0]), 'C@0:12 hold@12:12 F@24:72');
  assert.equal(tl(splitOnGrid(base, 0, 'a', m.beat / 3).bars[0]), 'C@0:8 hold@8:8 hold@16:8 F@24:72');
  assert.equal(tl(splitOnGrid(base, 0, 'a', m.beat / 4).bars[0]), 'C@0:6 hold@6:6 hold@12:6 hold@18:6 F@24:72');
  assert.equal(tl(splitOnGrid(base, 0, 'b', m.beat).bars[0]), 'C@0:24 F@24:24 hold@48:24 hold@72:24');
  const r = splitEvent(one([ev('r', 0, 96, 'rest')]), 0, 'r', 2);
  assert.equal(tl(r.bars[0]), 'rest@0:48 rest@48:48', 'a split rest stays rests');
  const six: Chart = { v: 2, bars: [{ id: 'x', time: '6/8', events: [ev('a', 0, 72, 'chord', 'C')] }] };
  assert.equal(splitOnGrid(six, 0, 'a', meter('6/8').beat).bars[0].events.length, 6, 'in 6/8 a beat is an eighth');
});

check('acceptance 5 · moving boundaries never makes invalid timing', () => {
  const c = one([ev('a', 0, 48, 'chord', 'C'), ev('b', 48, 24, 'chord', 'D'), ev('c', 72, 24, 'chord', 'E')]);
  assert.equal(tl(moveBoundary(c, 0, 1, 24).bars[0]), 'C@0:24 D@24:48 E@72:24');
  assert.equal(tl(moveBoundary(c, 0, 1, 500).bars[0]), 'C@0:71 D@71:1 E@72:24', 'clamped short of the next boundary');
  assert.equal(tl(moveBoundary(c, 0, 1, -40, 6).bars[0]), 'C@0:6 D@6:66 E@72:24');
  assert.equal(tl(shiftEvent(c, 0, 'b', 12).bars[0]), 'C@0:60 D@60:24 E@84:12');
  assert.equal(tl(shiftEvent(c, 0, 'b', 99, 6).bars[0]), 'C@0:66 D@66:24 E@90:6');
  assert.equal(tl(shiftEvent(c, 0, 'a', 12).bars[0]), tl(c.bars[0]), 'the first event can’t move');
  assert.equal(tl(setDuration(c, 0, 'a', 96).bars[0]), 'C@0:96', 'longer swallows what it covers');
  assert.equal(tl(setDuration(c, 0, 'a', 60).bars[0]), 'C@0:60 D@60:12 E@72:24');
  assert.equal(tl(setDuration(c, 0, 'c', 12).bars[0]), 'C@0:48 D@48:24 E@72:12 rest@84:12', 'shortening the last leaves a rest');
  assert.equal(tl(removeEvent(c, 0, 'b').bars[0]), 'C@0:72 E@72:24');
  assert.equal(tl(removeEvent(c, 0, 'a').bars[0]), 'hold@0:48 D@48:24 E@72:24');
  for (const d of [moveBoundary(c, 0, 2, 10), shiftEvent(c, 0, 'c', -60), setDuration(c, 0, 'b', -5), setDuration(c, 0, 'b', 1e9)]) valid(d);
});

check('insert a chord at a beat', () => {
  const c = one([ev('a', 0, 96, 'chord', 'C^7')]);
  const r = insertAt(c, 0, 72, 'chord', 'G7');
  assert.equal(tl(r.chart.bars[0]), 'C^7@0:72 G7@72:24');
  assert.ok(r.id);
});

// ---------------------------------------------------------------- bars

check('acceptance 6 · inserting, duplicating and deleting bars keeps structure', () => {
  const c = formChart('aaba', 'C');
  assert.equal(c.bars.length, 32);
  const ins = insertBars(c, 8, 2);
  assert.equal(ins.bars.length, 34);
  assert.equal(ins.bars[10].section, 'A', 'the second A starts after the inserted bars');
  const dup = duplicateBars(c, 16, 23);
  assert.equal(dup.bars.length, 40);
  assert.equal(dup.bars[24].section, 'B');
  assert.notEqual(dup.bars[24].id, dup.bars[16].id);
  assert.notEqual(dup.bars[24].events[0].id, dup.bars[16].events[0].id);
  const del = deleteBars(c, 16, 16);
  assert.equal(del.bars[16].section, 'B', 'deleting the first bar of B keeps the B');
  assert.equal(del.bars[16].open, '[');
  const waltz = normalizeChart({ v: 2, bars: [blankBar(meter('4/4')), { ...blankBar(meter('3/4')), time: '3/4' }, blankBar(meter('3/4'))] });
  const w = deleteBars(waltz, 1, 1);
  assert.equal(w.bars[1].time, '3/4', 'deleting the bar that changed meter keeps the meter');
  valid(w);
  const tail = deleteBars(c, 31, 31);
  assert.equal(tail.bars[30].close, 'Z', 'the final barline moves back');
  const mv = moveBars(c, 0, 1, 3);
  assert.equal(mv.from, 3);
  assert.equal(mv.chart.bars[3].id, c.bars[0].id);
  assert.deepEqual(sectionRange(c, 20), [16, 23]);
});

check('changing the meter re-fits the bars that follow', () => {
  const c = one([ev('a', 0, 48, 'chord', 'C'), ev('b', 48, 48, 'chord', 'G7')], [ev('c', 0, 96, 'chord', 'F')]);
  const w = patchBar(c, 0, { time: '3/4' });
  assert.equal(tl(w.bars[0]), 'C@0:48 G7@48:24');
  assert.equal(tl(w.bars[1]), 'F@0:72');
  valid(w);
});

check('acceptance 7 · undo and redo reverse musical and structural edits (and keep a collaborator’s)', () => {
  const M = { title: 't', composer: '', style: '', key: 'F', bpm: 0, transpose: 0, comp: '', repeats: 0 };
  const start = formChart('blues', 'F');
  const mine = deleteBars(setChord(start, 3, start.bars[3].events[0].id, 'C-7'), 0, 0);
  // Undo replays one's own step as a three-way merge: base = after, mine = before, theirs = now.
  const undo = (before: Chart, after: Chart, now: Chart) => mergeDocs({ meta: M, chart: after }, { meta: M, chart: before }, { meta: M, chart: now }).value.chart;
  assert.equal(noIds(undo(start, mine, mine)), noIds(start), 'undo restores everything');
  const theirs = setChord(mine, 5, mine.bars[5].events[0].id, 'Bo7');
  const back = undo(start, mine, theirs);
  assert.equal(back.bars.length, 12);
  assert.equal(back.bars[3].events[0].ch, 'F7');
  assert.equal(back.bars[6].events[0].ch, 'Bo7', 'a collaborator’s edit survives my undo');
  const redo = mergeDocs({ meta: M, chart: start }, { meta: M, chart: mine }, { meta: M, chart: start }).value.chart;
  assert.equal(noIds(redo), noIds(mine));
});

// ---------------------------------------------------------------- typed progressions

check('typed progression: bars, chord spellings, slash chords, several chords a bar', () => {
  const bars = parseProgression('| Cm7 | F7 | Bbmaj7 Eb7/G | Am7b5 D7(b9) |', () => meter('4/4'));
  assert.equal(bars.length, 4);
  assert.deepEqual(bars.map((b) => tl(b)), ['C-7@0:96', 'F7@0:96', 'Bb^7@0:48 Eb7/G@48:48', 'Ah7@0:48 D7b9@48:48']);
  assert.ok(bars.every((b) => !b.flags.length));
  assert.equal(tl(parseBar('Dm7:2 r G7', meter('4/4'))), 'D-7@0:48 rest@48:24 G7@72:24');
  assert.equal(tl(parseBar('Dm7 / G7 /', meter('4/4'))), 'D-7@0:48 G7@48:48');
  const eighths = parseBar('C D E F G A B C', meter('4/4'));
  assert.equal(eighths.events.length, 8);
  assert.equal(eighths.events[1].at, 12);
  assert.equal(tl(parseBar('C D E', meter('3/4'))), 'C@0:24 D@24:24 E@48:24');
  assert.equal(parseBar('%', meter('4/4')).simile, 1);
  assert.equal(parseBar('C7(Db7)', meter('4/4')).events[0].alt, 'Db7');
});

check('acceptance 12 · ambiguous or invalid input is flagged, never silently corrupts', () => {
  const three = parseBar('C Am F', meter('4/4'));
  assert.equal(three.flags.length, 1, 'three chords in 4/4 is flagged');
  assert.equal(tl(three), 'C@0:48 A-@48:24 F@72:24');
  assert.match(parseBar('Cm7 Q9', meter('4/4')).flags[0], /Q9/);
  const over = parseBar('C:3 D:3', meter('4/4'));
  assert.match(over.flags[0], /add up/);
  assert.equal(over.events.reduce((s, e) => s + e.dur, 0), 96, 'still a valid bar');
  for (const t of ['Dm7:2 r:1 G7:1', 'Cmaj7', 'Dm7 G7', 'C:1.5 D:2.5', '%', 'C:2/3 D:2/3 E:2/3 F:2']) {
    const b = parseBar(t, meter('4/4'));
    assert.equal(barText({ events: b.events, simile: b.simile }, meter('4/4')), t, t);
  }
  const junk = sanitizeChart({ v: 2, bars: [{ id: 'x', events: [{ kind: 'chord', dur: -5 }, { kind: 'wat', dur: 'a' }, { kind: 'chord', ch: 'G7', dur: 999 }] }] })!;
  valid(junk);
});

check('acceptance 11 · the rhythm view and the text view describe the same music', () => {
  const c = parseBar('Dm7:2 r:1 G7:1', meter('4/4'));
  const again = parseBar(barText({ events: c.events }, meter('4/4')), meter('4/4'));
  assert.equal(tl(again), tl(c));
});

check('replacing a bar from text keeps marks at the same time', () => {
  const c = one([{ ...ev('a', 0, 96, 'chord', 'C'), fermata: true }]);
  const r = replaceEvents(c, 0, parseBar('C G7', meter('4/4')).events);
  assert.ok(r.bars[0].events[0].fermata);
});

check('forms: blues in a key, AABA sections', () => {
  const b = formChart('jazzblues', 'Bb');
  assert.equal(b.bars.length, 12);
  assert.equal(b.bars[0].events[0].ch, 'Bb7');
  assert.equal(tl(b.bars[3]), 'F-7@0:48 Bb7@48:48');
  assert.equal(formChart('blues', 'C-').bars[0].events[0].ch, 'C-7');
  const a = formChart('aaba');
  assert.deepEqual(a.bars.filter((x) => x.section).map((x) => x.section), ['A', 'A', 'B', 'A']);
  valid(a);
  valid(blankChart());
});

// ---------------------------------------------------------------- merge & diff

function chart(...ids: string[]): Chart {
  return { v: 2, bars: ids.map((id) => ({ id, events: [ev(`${id}.0`, 0, 96, 'chord', id.toUpperCase().replace(/\d/g, '') || 'C')] })) };
}
const edit = (c: Chart, id: string, ch: string): Chart => ({ ...c, bars: c.bars.map((b) => (b.id === id ? { ...b, events: [{ ...b.events[0], ch }] } : b)) });

check('merge: edits to different bars both land', () => {
  const base = chart('a', 'b', 'c');
  const r = mergeCharts(base, edit(base, 'a', 'D7'), edit(base, 'c', 'E7'));
  assert.deepEqual(r.value.bars.map((b) => b.events[0].ch), ['D7', 'B', 'E7']);
  assert.deepEqual(r.conflicts, []);
});

check('merge: same bar, theirs wins and is reported', () => {
  const base = chart('a', 'b');
  const r = mergeCharts(base, edit(base, 'b', 'D7'), edit(base, 'b', 'E7'));
  assert.equal(r.value.bars[1].events[0].ch, 'E7');
  assert.deepEqual(r.conflicts, ['b']);
});

check('merge: inserts land after their neighbour, deletes apply', () => {
  const base = chart('a', 'b', 'c');
  const mine: Chart = { v: 2, bars: [base.bars[0], { id: 'n', events: [ev('n.0', 0, 96, 'chord', 'G7')] }, base.bars[1], base.bars[2]] };
  const theirs: Chart = { v: 2, bars: [base.bars[0], base.bars[2]] };
  assert.deepEqual(mergeCharts(base, mine, theirs).value.bars.map((b) => b.id), ['a', 'n', 'c']);
});

check('diff summary', () => {
  const s = song('9.20 Special');
  const after = { meta: { ...s.meta, key: 'D' }, chart: edit(s.chart, s.chart.bars[4].id, 'F7') };
  after.chart.bars.push(blankBar(), blankBar());
  assert.equal(summarize(s, after), 'Edited bar 5, added 2 bars, key C → D');
});

// ---- The agent's edit language (lib/script.ts) ----

const docOf = (...bars: string[]): Doc => {
  const ps = parseProgression(bars.join(' | '), () => meter('4/4'));
  const chart = normalizeChart({ v: 2, bars: ps.map((p, k) => ({ id: `b${k + 1}`, events: p.events.map((e, j) => ({ ...e, id: `b${k + 1}.${j}` })), ...(p.simile ? { simile: p.simile } : {}) })) });
  chart.bars[0].open = '[';
  chart.bars[chart.bars.length - 1].close = 'Z';
  return { meta: { ...EMPTY_META, key: 'C' }, chart };
};
const run = (d: Doc, ops: unknown[]): Doc => {
  const r = applyOps(d, ops);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.doc;
};
const errs = (d: Doc, ops: unknown[]): string[] => {
  const r = applyOps(d, ops);
  assert.ok(!r.ok, 'expected the request to be refused');
  return r.errors;
};
const texts = (d: Doc) => d.chart.bars.map((b, i) => barText(b, metersOf(d.chart)[i]) || '/');

check('agent · the chart reads as numbered rows, as on screen', () => {
  const lines = chartText(song('Autumn Leaves')).split('\n');
  assert.equal(lines[0], 'Autumn Leaves · key Gm · 4/4 · Medium Swing · 24 bars');
  assert.equal(lines[1], ' 1 [A] |: Cm7 | F7 | Bbmaj7 | Ebmaj7 |');
  assert.equal(lines[2], ' 5 | Am7b5 | D7b13 | Gm6 | % :|');
  assert.equal(lines[6], '21 | Am7b5 | D7b13 | Gm6 | % ‖end');
});

check('agent · every bar of every standard reads back as played from its chords text', () => {
  // C^ and C^7 are both a major seventh (Ch and Ch7 both half-diminished); the text spells them out, and they read back with the 7.
  const maj = (ch?: string) => (ch ?? '').replace(/([\^h])(?!\d)/, '$17');
  let bad = 0;
  for (const { chart } of corpus.songs) {
    const ms = metersOf(chart);
    const rows = agentBars(chart);
    chart.bars.forEach((b, i) => {
      // A repeat sign with alternate chords over it reads as the sign alone (the text has no way to write both).
      if (b.simile && b.events.some((e) => e.alt)) return;
      const p = parseBar(rows[i].chords === '/' ? '' : rows[i].chords, ms[i]);
      // As played: a hold after an event is that event carrying on (iReal's empty cells).
      const key = (evs: Ev[]) =>
        evs
          .reduce<Ev[]>((out, e) => (e.kind === 'hold' && !e.alt && out.length ? (out[out.length - 1] = { ...out[out.length - 1], dur: out[out.length - 1].dur + e.dur }, out) : [...out, e]), [])
          .map((e) => `${e.kind}:${maj(e.ch)}:${maj(e.alt)}@${e.at}+${e.dur}`)
          .join(' ');
      if (p.flags.length || key(p.events) !== key(b.events) || (p.simile ?? 0) !== (b.simile ?? 0)) bad++;
    });
  }
  assert.equal(bad, 0);
});

check('agent · bars and beats by number: put a chord on bar 2 beat 3 for one beat', () => {
  const d = run(docOf('C', 'C', 'G7'), [{ op: 'put', at: '2:3', what: 'Dm7', beats: 1 }]);
  assert.equal(tl(d.chart.bars[1]), 'C@0:48 D-7@48:24 C@72:24');
  assert.equal(tl(d.chart.bars[0]), 'C@0:96');
  const e = run(docOf('C', 'C'), [{ op: 'put', at: '1:3', what: 'G7' }, { op: 'put', at: '2:2+', what: 'rest', beats: 0.5 }]);
  assert.equal(tl(e.chart.bars[0]), 'C@0:48 G7@48:48');
  assert.equal(tl(e.chart.bars[1]), 'C@0:36 rest@36:12 C@48:48');
});

check('agent · beats follow the bar’s meter (3/4, 6/8)', () => {
  const d = run(docOf('C', 'F'), [{ op: 'format', bars: 1, time: '6/8' }, { op: 'put', at: '1:4', what: 'G7' }]);
  assert.equal(d.chart.bars[0].time, '6/8');
  assert.equal(d.chart.bars[1].time, '4/4', 'only bar 1 changes meter');
  assert.equal(tl(d.chart.bars[0]), 'C@0:36 G7@36:36');
  assert.match(errs(docOf('C'), [{ op: 'put', at: '1:5', what: 'G7' }])[0], /beats run 1 to 4/);
});

check('agent · all or nothing: one bad op refuses the request, the chart is untouched', () => {
  const d = docOf('C', 'F');
  const before = canon(d);
  const e = errs(d, [{ op: 'chords', bars: 1, text: 'Dm7' }, { op: 'chords', bars: 3, text: 'G7' }, { op: 'chords', bars: 2, text: 'C D E' }]);
  assert.equal(e.length, 2);
  assert.match(e[0], /op 2 \(chords\): bar 3 doesn’t exist \(the chart has 2 bars\)/);
  assert.match(e[1], /op 3 \(chords\): bar 2 \(“C D E”\): 3 chords/);
  assert.equal(canon(d), before);
  assert.deepEqual(errs(d, [{ op: 'chords', bars: 1, text: 'C' }]), ['these ops change nothing']);
  assert.match(errs(d, [{ op: 'remove', at: '1:3' }])[0], /nothing starts on beat 3 of bar 1 \(its events start on beat 1\)/);
});

check('agent · numbers mean the chart as read, even after an insert in the same request', () => {
  const d = run(docOf('C', 'F', 'G7', 'C'), [
    { op: 'insert', before: 1, text: '| Dm7 | G7 |', section: 'intro' },
    { op: 'insert', after: 2, text: 'Ab7' },
    { op: 'insert', after: 2, text: 'Db7' },
    { op: 'chords', bars: 3, text: 'G7alt' },
  ]);
  assert.deepEqual(texts(d), ['Dm7', 'G7', 'C', 'F', 'Ab7', 'Db7', 'G7alt', 'C']);
  assert.equal(d.chart.bars[0].section, 'i');
  assert.equal(d.chart.bars[7].close, 'Z');
});

check('agent · delete, clear, copy and move keep the structure in place', () => {
  const base = docOf('C', 'F', 'G7', 'C');
  base.chart.bars[1].section = 'B';
  const del = run(base, [{ op: 'delete', bars: '2-3' }]);
  assert.deepEqual(texts(del), ['C', 'C']);
  assert.equal(del.chart.bars[1].section, 'B', 'the section letter moves to the bar after');
  assert.deepEqual(texts(run(base, [{ op: 'clear', bars: 2 }])), ['C', '/', 'G7', 'C']);
  const cp = run(base, [{ op: 'copy', bars: '1-2', after: 'last' }]);
  assert.deepEqual(texts(cp), ['C', 'F', 'G7', 'C', 'C', 'F']);
  assert.deepEqual(cp.chart.bars.map((b) => b.close ?? ''), ['', '', '', '', '', 'Z'], 'the final barline stays at the end');
  assert.equal(new Set(cp.chart.bars.map((b) => b.id)).size, 6, 'copies get new ids');
  const mv = run(base, [{ op: 'move', bars: 4, before: 1 }]);
  assert.deepEqual(texts(mv), ['C', 'C', 'F', 'G7']);
  assert.equal(mv.chart.bars[3].close, 'Z');
  assert.match(errs(base, [{ op: 'move', bars: '1-3', after: 2 }])[0], /one of them/);
});

check('agent · transposing: some bars, the whole chart, or the key', () => {
  const d = docOf('Dm7 G7', 'Cmaj7');
  const some = run(d, [{ op: 'transpose', bars: 1, semitones: 2 }]);
  assert.deepEqual(texts(some), ['Em7 A7', 'Cmaj7']);
  assert.equal(some.meta.key, 'C');
  const all = run(d, [{ op: 'transpose', semitones: 3 }]);
  assert.deepEqual(texts(all), ['Fm7 Bb7', 'Ebmaj7']);
  assert.equal(all.meta.key, 'Eb');
  const key = run(d, [{ op: 'key', key: 'B♭' }]);
  assert.deepEqual(texts(key), ['Cm7 F7', 'Bbmaj7']);
  const relabel = run(d, [{ op: 'key', key: 'A minor', move: false }]);
  assert.deepEqual(texts(relabel), ['Dm7 G7', 'Cmaj7']);
  assert.equal(relabel.meta.key, 'A-');
});

check('agent · format and info', () => {
  const d = run(docOf('C', 'F', 'G7', 'C'), [
    { op: 'format', bars: '2-3', repeat: 'both', section: 'B', text: 'Solos' },
    { op: 'format', bars: 4, fermata: '4:1', ending: 2 },
    { op: 'info', title: 'Blues for the Band', bpm: 160 },
  ]);
  assert.equal(d.chart.bars[1].open, '{');
  assert.equal(d.chart.bars[2].close, '}');
  assert.equal(d.chart.bars[1].section, 'B');
  assert.equal(d.chart.bars[1].events[0].text, 'Solos');
  assert.equal(d.chart.bars[3].events[0].fermata, true);
  assert.equal(d.chart.bars[3].ending, 2);
  assert.equal(d.meta.title, 'Blues for the Band');
  assert.equal(d.meta.bpm, 160);
  assert.match(errs(d, [{ op: 'format', bars: 1, colour: 'red' }])[0], /doesn’t take “colour”/);
});

check('agent · changes read back with old and new bar numbers', () => {
  const d = docOf('C', 'F');
  const after = run(d, [{ op: 'insert', before: 1, text: 'G7' }, { op: 'chords', bars: 2, text: 'Bb7' }]);
  assert.deepEqual(changes(d, after), {
    bars: [{ n: 1, was: null, before: null, after: 'G7' }, { n: 3, was: 2, before: 'F', after: 'Bb7' }],
    removed: [],
  });
});

check('standards library loads', () => {
  const lib = loadStandards();
  assert.equal(lib.length, 1460);
  assert.ok(lib.find((s) => s.meta.title === 'Giant Steps'));
});

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
