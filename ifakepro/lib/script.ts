// The edit language the owner's agent (Muse) speaks: a chart shown as
// numbered bars, and a list of ops that address bars by number and beats by
// number. Muse turns what's asked in English into ops; this file applies
// them, exactly or not at all.
//
// Every bar number and beat in a request means the chart as it was read (its
// revision). They're all resolved to bar ids before anything changes, so an
// insert early in a request doesn't shift what a later op means. Anything
// that can't be done for certain — a bar that isn't there, a beat outside
// the bar, three chords in a 4/4 bar with no lengths — rejects the whole
// request with a message naming the op, the bar and the beat. Nothing is
// ever half applied or guessed at.

import {
  type Bar, type Chart, type Ev, type EventKind, type Meter, type SongMeta,
  canon, cellText, layout, metersOf, newId, normalizeChart, sanitizeMeta, sectionLabel, timeAt,
} from './chart';
import { chordText, keyDistance, parseKey, prefersFlats, transposeKey } from './chords';
import { diffCharts } from './diff';
import { clearBarlines, clearBars, cloneBars, deleteBars, editEvents, insertBars, patchBar, patchEvent, removeEvent, replaceEvents, transposeBars, transposeChart } from './edit';
import { barText, parseBar, readToken, splitBars } from './progression';

export interface Doc {
  meta: SongMeta;
  chart: Chart;
}

export const MAX_OPS = 100;

// ---- Reading: a chart as Muse sees it ----

export interface AgentEvent {
  /** Where it starts: 1 is the downbeat, 2.5 the and-of-2 (in the bar's own beats: eighths in 6/8). */
  beat: number;
  /** How long, in beats. */
  beats: number;
  kind: EventKind;
  chord?: string;
  alt?: string;
  text?: string;
  fermata?: true;
  segno?: true;
  coda?: true;
}

export interface AgentBar {
  n: number;
  section?: string;
  /** The time signature in force. */
  time: string;
  /** Set where the time signature changes. */
  timeChange?: true;
  repeat?: 'start' | 'end' | 'both';
  barline?: 'double-start' | 'double' | 'double-both' | 'final';
  ending?: number;
  /** The bar in the Type panel's syntax: what an op's `text` takes. */
  chords: string;
  events: AgentEvent[];
}

const num = (x: number) => +x.toFixed(3);

function sectionName(s: string): string {
  if (s === 'i') return 'Intro';
  if (s === 'V' || s === 'v') return 'Verse';
  return sectionLabel(s);
}

export function agentBars(chart: Chart): AgentBar[] {
  const times = timeAt(chart);
  const ms = metersOf(chart);
  return chart.bars.map((b, i) => {
    const m = ms[i];
    const out: AgentBar = { n: i + 1, time: times[i], chords: barText(b, m) || '/', events: [] };
    if (b.section) out.section = sectionName(b.section);
    if (b.time && (i === 0 || times[i - 1] !== b.time)) out.timeChange = true;
    if (b.open === '{' || b.close === '}') out.repeat = b.open === '{' && b.close === '}' ? 'both' : b.open === '{' ? 'start' : 'end';
    if (b.close === 'Z') out.barline = 'final';
    else if (b.open === '[' && b.close === ']') out.barline = 'double-both';
    else if (b.open === '[') out.barline = 'double-start';
    else if (b.close === ']') out.barline = 'double';
    if (b.ending) out.ending = b.ending;
    out.events = b.events.map((e) => {
      const a: AgentEvent = { beat: num(e.at / m.beat + 1), beats: num(e.dur / m.beat), kind: e.kind };
      if (e.ch) a.chord = chordText(e.ch);
      if (e.alt) a.alt = chordText(e.alt);
      if (e.text) a.text = cellText(e.text);
      if (e.fermata) a.fermata = true;
      if (e.segno) a.segno = true;
      if (e.coda) a.coda = true;
      return a;
    });
    return out;
  });
}

/**
 * The chart as numbered rows, laid out as on screen, each starting with the
 * number of its first bar:
 *    1 [A] |: Cm7 | F7 | Bbmaj7 | Ebmaj7 |
 *    5 | Am7b5 | D7b13 | Gm6 | % :|
 * [A] a section, |: :| repeats, ‖ a double barline, ‖end the final one,
 * 1. 2. endings, (3/4) a time change, {segno} {coda} {"Fine"} {fermata on 3}
 * marks, % a repeat-the-last-bar sign, / an empty bar.
 */
export function chartText(doc: Doc): string {
  const { meta, chart } = doc;
  const ms = metersOf(chart);
  const times = timeAt(chart);
  const head = [
    meta.title,
    `key ${meta.key.replace(/-$/, 'm')}`,
    times[0],
    meta.style,
    meta.bpm ? `♩=${meta.bpm}` : '',
    `${chart.bars.length} bar${chart.bars.length === 1 ? '' : 's'}`,
  ].filter(Boolean).join(' · ');
  const width = String(chart.bars.length).length;
  const rows = layout(chart).map((row) => {
    const bars = row.items.flatMap((it) => (it.kind === 'bar' ? [it] : []));
    if (!bars.length) return '';
    let line = '';
    let closed = false;
    for (const { bar: b, index: i } of bars) {
      const pre: string[] = [];
      if (b.section) pre.push(`[${sectionName(b.section)}]`);
      if (b.ending) pre.push(`${b.ending}.`);
      if (i > 0 && b.time && times[i - 1] !== b.time) pre.push(`(${b.time})`);
      const open = b.open === '{' ? '|:' : b.open === '[' ? '‖' : closed ? '' : '|';
      const marks = b.events.flatMap((e) => [
        ...(e.segno ? ['{segno}'] : []),
        ...(e.coda ? ['{coda}'] : []),
        ...(e.text ? [`{"${cellText(e.text)}"}`] : []),
        ...(e.fermata ? [`{fermata on ${num(e.at / ms[i].beat + 1)}}`] : []),
      ]);
      const close = b.close === '}' ? ':|' : b.close === ']' ? '‖' : b.close === 'Z' ? '‖end' : '';
      line += ` ${[...pre, open, ...marks, barText(b, ms[i]) || '/', close].filter(Boolean).join(' ')}`;
      closed = !!close;
    }
    return `${String(bars[0].index + 1).padStart(width)}${line}${closed ? '' : ' |'}`;
  });
  return [head, ...rows.filter(Boolean)].join('\n');
}

// ---- Addressing ----

class OpError extends Error {}
const fail = (msg: string): never => {
  throw new OpError(msg);
};

/** "5", 5, "5-8", "5–8", "5 to 8", [5, 8], "all", "last" → 0-based [from, to]. */
function rangeOf(v: unknown, n: number, what = 'bars'): [number, number] {
  if (v == null) fail(`${what} is missing (a bar number like 5, a range like "5-8", "all" or "last")`);
  const no = (x: string | number) => (x === 'last' ? n : Number(x));
  let a: number;
  let b: number;
  if (typeof v === 'number') a = b = v;
  else if (Array.isArray(v) && v.length === 2) [a, b] = [no(v[0]), no(v[1])];
  else if (typeof v === 'string') {
    const s = v.trim().toLowerCase().replace(/^bars?\s*/, '');
    if (s === 'all') return [0, n - 1];
    const m = s.match(/^(\d+|last)(?:\s*(?:-|–|—|\.\.|to)\s*(\d+|last))?$/);
    if (!m) return fail(`can’t read ${what} “${v}” (use 5, "5-8", "all" or "last")`);
    a = no(m[1]);
    b = m[2] ? no(m[2]) : a;
  } else return fail(`can’t read ${what} ${JSON.stringify(v)}`);
  for (const x of [a, b]) {
    if (!Number.isInteger(x)) fail(`${what}: ${x} isn’t a bar number`);
    if (x < 1 || x > n) fail(`bar ${x} doesn’t exist (the chart has ${n} bar${n === 1 ? '' : 's'})`);
  }
  if (b < a) fail(`${what} “${v}” runs backwards`);
  return [a - 1, b - 1];
}

/** A bar number for `after` / `before`. */
function barOf(v: unknown, n: number, what: string): number {
  const [a, b] = rangeOf(v, n, what);
  if (a !== b) fail(`${what} takes one bar, not a range`);
  return a;
}

/** "12:3", "12:2.5", "12:2+", "bar 12 beat 3", {bar: 12, beat: 3} → bar index and beat (checked against the bar later, in tickOf). */
function placeOf(v: unknown, n: number): { i: number; beat: number } {
  let bar: number;
  let beat: number;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as { bar?: unknown; beat?: unknown };
    bar = Number(o.bar);
    beat = typeof o.beat === 'string' ? parseBeat(o.beat) : Number(o.beat ?? 1);
  } else if (typeof v === 'string') {
    const m = v.trim().toLowerCase().match(/^(?:bar\s*)?(\d+)\s*(?::|,|\s+beat\s+|\s*beat\s*)\s*([\d.]+\s*(?:\+|&|and)?)$/);
    if (!m) return fail(`can’t read “${v}” as a place (use "12:3" for bar 12, beat 3, or "12:2+" for the and-of-2)`);
    bar = Number(m[1]);
    beat = parseBeat(m[2]);
  } else return fail(`a place is needed, like "12:3" (bar 12, beat 3)`);
  if (!Number.isInteger(bar) || bar < 1 || bar > n) fail(`bar ${bar} doesn’t exist (the chart has ${n} bars)`);
  if (!Number.isFinite(beat) || beat < 1) fail(`can’t read the beat in ${JSON.stringify(v)}`);
  return { i: bar - 1, beat };
}

/** A beat of bar `no` as a tick, in the bar's meter as it is when the op runs. */
function tickOf(beat: number, m: Meter, no: number): number {
  const exact = (beat - 1) * m.beat;
  const tick = Math.round(exact);
  if (Math.abs(tick - exact) > 0.2) fail(`beat ${beat} of bar ${no} isn’t on a half, third or quarter of a beat`);
  if (tick < 0 || tick >= m.length) fail(`bar ${no} is in ${m.num}/${m.den}: its beats run 1 to ${m.num}${m.den === 8 ? ' (eighths)' : ''}, not ${beat}`);
  return tick;
}

function parseBeat(s: string): number {
  const m = s.trim().match(/^([\d.]+)\s*(\+|&|and)?$/);
  if (!m) return NaN;
  return Number(m[1]) + (m[2] ? 0.5 : 0);
}

function only(op: Record<string, unknown>, keys: string[]) {
  const extra = Object.keys(op).filter((k) => k !== 'op' && !keys.includes(k));
  if (extra.length) fail(`doesn’t take ${extra.map((k) => `“${k}”`).join(', ')} (it takes ${keys.join(', ')})`);
}

// ---- Applying ----

interface State {
  chart: Chart;
  meta: SongMeta;
  /** Where the next insert "after bar X" goes, so two inserts after one bar land in order. */
  lastAfter: Map<string, string>;
}

type Step = (st: State) => void;

const where = (st: State, id: string, n: number): number => {
  const i = st.chart.bars.findIndex((b) => b.id === id);
  if (i < 0) fail(`bar ${n} was deleted earlier in this request`);
  return i;
};

/** Text for a run of bars: a string with | between bars, or one string per bar. */
function barSources(text: unknown): string[] {
  if (Array.isArray(text)) return text.map((t) => String(t ?? ''));
  if (typeof text !== 'string' || !text.trim()) return fail('text is missing (bars like "| Dm7 G7 | Cmaj7 |")');
  return splitBars(text);
}

/** Write bars from their text, each read against its own meter; a bar the parser would flag stops everything. */
function writeBars(st: State, ids: string[], sources: string[], nos: number[]) {
  ids.forEach((id, k) => {
    const i = where(st, id, nos[k]);
    const m = metersOf(st.chart)[i];
    const p = parseBar(sources[k], m);
    if (p.flags.length) fail(`bar ${nos[k]} (“${sources[k]}”): ${p.flags.join('; ')}`);
    st.chart = replaceEvents(st.chart, i, p.events, p.simile);
  });
}

/** Put bars in at `pos`, keeping the final barline on the last bar. */
function insertBlock(st: State, pos: number, bars: Bar[]) {
  const all = st.chart.bars.slice();
  const block = bars.map((b) => withoutFinal(b));
  if (pos >= all.length && all.length && all[all.length - 1].close === 'Z') {
    all[all.length - 1] = withoutFinal(all[all.length - 1]);
    block[block.length - 1] = { ...block[block.length - 1], close: 'Z' };
  }
  all.splice(pos, 0, ...block);
  st.chart = normalizeChart({ ...st.chart, bars: all });
}

function withoutFinal(b: Bar): Bar {
  if (b.close !== 'Z') return b;
  const out = { ...b };
  delete out.close;
  return out;
}

/** After bars moved, a final barline that ended up mid-chart goes back to the end. */
function keepFinal(st: State, had: boolean) {
  if (!had) return;
  const bars = st.chart.bars.map((b, i, a) => (i === a.length - 1 ? { ...b, close: 'Z' as const } : withoutFinal(b)));
  st.chart = { ...st.chart, bars };
}

/** Where "after bar X" / "before bar X" puts new bars, now. */
function anchorOf(op: Record<string, unknown>, base: Chart): { id: string; n: number; after: boolean } {
  if (op.after != null && op.before != null) fail('give after or before, not both');
  if (op.after == null && op.before == null) fail('needs after (a bar number) or before (a bar number)');
  const after = op.after != null;
  const i = barOf(after ? op.after : op.before, base.bars.length, after ? 'after' : 'before');
  return { id: base.bars[i].id, n: i + 1, after };
}

function positionOf(st: State, a: { id: string; n: number; after: boolean }): number {
  if (!a.after) return where(st, a.id, a.n);
  const last = st.lastAfter.get(a.id);
  const i = last ? st.chart.bars.findIndex((b) => b.id === last) : -1;
  return (i >= 0 ? i : where(st, a.id, a.n)) + 1;
}

const MARKS = ['text', 'fermata', 'segno', 'coda', 'end'] as const;

function withoutMarks(e: Ev): Ev {
  const out = { ...e };
  for (const k of MARKS) delete out[k];
  return out;
}

/**
 * Place one event: `fresh` from `tick` for `dur` ticks (or, without a length,
 * up to where the next event starts). What was sounding carries on after it:
 * C for the bar, then G7 on beat 3 for a beat, is C · G7 · C.
 */
function putEvent(evs: Ev[], tick: number, dur: number | null, fresh: Omit<Ev, 'id' | 'at' | 'dur'>, length: number): Ev[] {
  const here = evs.find((e) => e.at === tick);
  const end = dur == null ? (here ? here.at + here.dur : (evs.find((e) => e.at > tick)?.at ?? length)) : tick + dur;
  const out: Ev[] = [];
  for (const e of evs) {
    const eEnd = e.at + e.dur;
    if (e.at < tick) out.push({ ...e, dur: Math.min(eEnd, tick) - e.at });
    if (eEnd > end) out.push(e.at >= end ? e : withoutMarks({ ...e, id: newId(), at: end, dur: eEnd - end }));
  }
  // The new event keeps the id and marks of one that started here.
  const marks: Partial<Ev> = {};
  if (here) for (const k of MARKS) if (here[k]) (marks as Record<string, unknown>)[k] = here[k];
  out.push({ ...marks, ...fresh, id: here?.id ?? newId(), at: tick, dur: end - tick } as Ev);
  return out.sort((a, b) => a.at - b.at);
}

function eventFrom(what: unknown): Omit<Ev, 'id' | 'at' | 'dur'> {
  if (typeof what !== 'string' || !what.trim()) return fail('what is missing (a chord like "G7", or "rest", "nc", "/", "G7>" for a hit)');
  const t = readToken(what.trim().replace(/^rest$/i, 'r'));
  if (typeof t === 'string') return fail(t);
  if (t.beats != null) fail(`give the length as beats, not inside “${what}”`);
  const kind: EventKind = t.kind === 'cont' ? 'hold' : t.kind;
  const ev: Omit<Ev, 'id' | 'at' | 'dur'> = { kind };
  if (t.ch) ev.ch = t.ch;
  if (t.alt) ev.alt = t.alt;
  return ev;
}

function idsOf(base: Chart, [a, b]: [number, number]) {
  return { ids: base.bars.slice(a, b + 1).map((x) => x.id), nos: base.bars.slice(a, b + 1).map((_, k) => a + k + 1) };
}

const SECTION_WORDS: Record<string, string> = { intro: 'i', in: 'i', verse: 'V' };

/** "A", "b", "intro", "verse" → the stored letter; "none" or "" → no section. */
function sectionOf(v: unknown): string | undefined {
  const raw = String(v).trim();
  if (!raw || raw.toLowerCase() === 'none') return undefined;
  const word = SECTION_WORDS[raw.toLowerCase()];
  if (word) return word;
  if (/^[A-Za-z]$/.test(raw)) return raw.toUpperCase();
  return fail(`section is a letter (A, B…), "intro", "verse" or null, not “${raw}”`);
}

/** Turn one op into a step against the chart as read. Throws OpError for anything it can't do for certain. */
function compile(op: Record<string, unknown>, base: Chart): Step {
  const n = base.bars.length;
  const ms = metersOf(base);
  switch (op.op) {
    case 'chords': {
      only(op, ['bars', 'text']);
      const r = rangeOf(op.bars, n);
      const { ids, nos } = idsOf(base, r);
      const sources = barSources(op.text);
      if (sources.length !== ids.length)
        fail(`text has ${sources.length} bar${sources.length === 1 ? '' : 's'} but bars ${nos[0]}–${nos[nos.length - 1]} are ${ids.length} (use insert or delete to change how many bars there are)`);
      const flagged = sources.flatMap((src, k) => {
        const f = parseBar(src, ms[r[0] + k]).flags;
        return f.length ? [`bar ${nos[k]} (“${src}”): ${f.join('; ')}`] : [];
      });
      if (flagged.length) fail(flagged.join(' · '));
      return (st) => writeBars(st, ids, sources, nos);
    }
    case 'put': {
      only(op, ['at', 'what', 'beats']);
      const { i, beat } = placeOf(op.at, n);
      tickOf(beat, ms[i], i + 1);
      const fresh = eventFrom(op.what);
      const beats = op.beats == null ? null : Number(op.beats);
      if (beats != null && !(beats > 0)) fail('beats must be a positive number');
      const id = base.bars[i].id;
      return (st) => {
        const j = where(st, id, i + 1);
        const m = metersOf(st.chart)[j];
        const tick = tickOf(beat, m, i + 1);
        let dur: number | null = null;
        if (beats != null) {
          dur = Math.round(beats * m.beat);
          if (Math.abs(dur - beats * m.beat) > 0.2) fail(`${beats} beats isn’t a whole number of halves, thirds or quarters of a beat`);
          if (tick + dur > m.length) fail(`${beats} beat${beats === 1 ? '' : 's'} from beat ${beat} runs past the end of bar ${i + 1} (${m.num}/${m.den})`);
        }
        st.chart = editEvents(st.chart, j, (evs) => putEvent(evs, tick, dur, fresh, m.length));
        // A repeat sign stood for the whole bar; it now has music of its own.
        if (st.chart.bars[j].simile) st.chart = patchBar(st.chart, j, { simile: undefined, simileAt: undefined });
      };
    }
    case 'remove': {
      only(op, ['at']);
      const { i, beat } = placeOf(op.at, n);
      tickOf(beat, ms[i], i + 1);
      const id = base.bars[i].id;
      return (st) => {
        const j = where(st, id, i + 1);
        const m = metersOf(st.chart)[j];
        const tick = tickOf(beat, m, i + 1);
        const evs = st.chart.bars[j].events;
        const ev = evs.find((e) => e.at === tick);
        if (!ev) {
          const starts = evs.map((e) => num(e.at / m.beat + 1));
          fail(`nothing starts on beat ${beat} of bar ${i + 1} (its events start on beat${starts.length === 1 ? '' : 's'} ${starts.join(', ')})`);
        }
        st.chart = removeEvent(st.chart, j, ev!.id);
      };
    }
    case 'insert': {
      only(op, ['after', 'before', 'count', 'text', 'section']);
      const a = anchorOf(op, base);
      const section = op.section == null ? undefined : sectionOf(op.section);
      const sources = op.text != null ? barSources(op.text) : null;
      const count = sources ? sources.length : op.count == null ? 1 : Number(op.count);
      if (!Number.isInteger(count) || count < 1 || count > 64) fail('count must be 1 to 64 bars');
      if (sources && op.count != null && Number(op.count) !== sources.length) fail(`count is ${op.count} but text has ${sources.length} bars`);
      return (st) => {
        const pos = positionOf(st, a);
        const time = !a.after && pos === 0 ? st.chart.bars[0]?.time : undefined;
        st.chart = insertBars(st.chart, pos, count);
        if (time) st.chart = patchBar(st.chart, 0, { time });
        const fresh = st.chart.bars.slice(pos, pos + count).map((b) => b.id);
        if (a.after) st.lastAfter.set(a.id, fresh[fresh.length - 1]);
        if (section) st.chart = patchBar(st.chart, pos, { section });
        if (sources) writeBars(st, fresh, sources, fresh.map((_, k) => pos + k + 1));
      };
    }
    case 'delete':
    case 'clear': {
      only(op, ['bars']);
      const { ids, nos } = idsOf(base, rangeOf(op.bars, n));
      return (st) => {
        const at = ids.map((id, k) => where(st, id, nos[k])).sort((x, y) => y - x);
        if (op.op === 'clear') {
          for (const i of at) st.chart = clearBars(st.chart, i, i);
          return;
        }
        // Delete runs from the end, so the indices of the rest stay put.
        let k = 0;
        while (k < at.length) {
          let from = at[k];
          const to = at[k];
          while (k + 1 < at.length && at[k + 1] === from - 1) from = at[++k];
          st.chart = deleteBars(st.chart, from, to);
          k++;
        }
      };
    }
    case 'copy':
    case 'move': {
      only(op, ['bars', 'after', 'before']);
      const { ids, nos } = idsOf(base, rangeOf(op.bars, n));
      const a = anchorOf(op, base);
      if (op.op === 'move' && ids.includes(a.id)) fail(`can’t move bars ${nos[0]}–${nos[nos.length - 1]} next to bar ${a.n}, which is one of them`);
      return (st) => {
        const had = st.chart.bars[st.chart.bars.length - 1]?.close === 'Z';
        const src = ids.map((id, k) => st.chart.bars[where(st, id, nos[k])]);
        let block: Bar[];
        if (op.op === 'copy') block = cloneBars(src);
        else {
          block = src;
          st.chart = { ...st.chart, bars: st.chart.bars.filter((b) => !ids.includes(b.id)) };
        }
        const pos = positionOf(st, a);
        insertBlock(st, pos, block);
        if (a.after) st.lastAfter.set(a.id, block[block.length - 1].id);
        keepFinal(st, had);
      };
    }
    case 'transpose': {
      only(op, ['bars', 'semitones']);
      const semis = Number(op.semitones);
      if (!Number.isInteger(semis) || semis === 0 || Math.abs(semis) > 11) fail('semitones must be a whole number from -11 to 11, not 0');
      const whole = op.bars == null || (typeof op.bars === 'string' && op.bars.trim().toLowerCase() === 'all');
      const r = whole ? null : rangeOf(op.bars, n);
      const sel = r ? idsOf(base, r) : null;
      return (st) => {
        if (!sel) {
          const key = transposeKey(st.meta.key, semis);
          st.chart = transposeChart(st.chart, semis, prefersFlats(key));
          st.meta = { ...st.meta, key };
          return;
        }
        for (const [k, id] of sel.ids.entries()) {
          const i = where(st, id, sel.nos[k]);
          st.chart = transposeBars(st.chart, i, i, semis, prefersFlats(st.meta.key));
        }
      };
    }
    case 'key': {
      only(op, ['key', 'move']);
      const key = typeof op.key === 'string' ? parseKey(op.key) : null;
      if (!key) fail(`can’t read the key ${JSON.stringify(op.key)} (like "Eb", "F# minor", "Cm")`);
      if (op.move != null && typeof op.move !== 'boolean') fail('move is true (move every chord to the new key) or false (only change the key shown)');
      const move = op.move !== false;
      return (st) => {
        const semis = move ? keyDistance(st.meta.key, key!) : 0;
        if (semis) st.chart = transposeChart(st.chart, semis, prefersFlats(key!));
        st.meta = { ...st.meta, key: key! };
      };
    }
    case 'format': {
      only(op, ['bars', 'section', 'time', 'ending', 'repeat', 'barline', 'segno', 'coda', 'fermata', 'text', 'newLine']);
      const r = rangeOf(op.bars, n);
      const { ids, nos } = idsOf(base, r);
      const first = ids[0];
      const last = ids[ids.length - 1];
      const steps: Step[] = [];
      const firstIdx = (st: State) => where(st, first, nos[0]);
      const lastIdx = (st: State) => where(st, last, nos[nos.length - 1]);
      if ('section' in op) {
        const section = op.section == null ? undefined : sectionOf(op.section);
        steps.push((st) => (st.chart = patchBar(st.chart, firstIdx(st), { section })));
      }
      if ('time' in op) {
        const t = String(op.time ?? '').trim();
        if (!/^\d{1,2}\/(1|2|4|8|16)$/.test(t) || Number(t.split('/')[0]) < 1) fail(`time is like "3/4", "5/4" or "6/8", not “${t}”`);
        steps.push((st) => {
          const a = firstIdx(st);
          const b = lastIdx(st);
          const times = timeAt(st.chart);
          const after = times[b + 1];
          st.chart = patchBar(st.chart, a, { time: t });
          // Only these bars change: the bar after goes back to what it was in.
          if (after && st.chart.bars[b + 1] && !st.chart.bars[b + 1].time && after !== t) st.chart = patchBar(st.chart, b + 1, { time: after });
          st.chart = normalizeChart(st.chart);
        });
      }
      if ('ending' in op) {
        const e = op.ending == null || op.ending === 0 ? undefined : Number(op.ending);
        if (e !== undefined && (!Number.isInteger(e) || e < 1 || e > 9)) fail('ending is 1, 2 or 3 (or null to take it off)');
        steps.push((st) => (st.chart = patchBar(st.chart, firstIdx(st), { ending: e })));
      }
      if ('barline' in op) {
        const bl = op.barline;
        if (!['double', 'double-start', 'final', 'single', 'none'].includes(String(bl))) fail('barline is "double", "double-start", "final" or "single"');
        steps.push((st) => {
          const a = firstIdx(st);
          const b = lastIdx(st);
          if (bl === 'single' || bl === 'none') st.chart = clearBarlines(st.chart, a, b);
          else if (bl === 'double-start') st.chart = patchBar(st.chart, a, { open: '[' });
          else st.chart = patchBar(st.chart, b, { close: bl === 'final' ? 'Z' : ']' });
        });
      }
      if ('repeat' in op) {
        const rp = op.repeat;
        if (!['start', 'end', 'both', 'none'].includes(String(rp))) fail('repeat is "start", "end", "both" (around these bars) or "none"');
        steps.push((st) => {
          const a = firstIdx(st);
          const b = lastIdx(st);
          if (rp === 'none') {
            for (let i = a; i <= b; i++) {
              const bar = st.chart.bars[i];
              if (bar.open === '{') st.chart = patchBar(st.chart, i, { open: undefined });
              if (bar.close === '}') st.chart = patchBar(st.chart, i, { close: undefined });
            }
            return;
          }
          if (rp === 'start' || rp === 'both') st.chart = patchBar(st.chart, a, { open: '{' });
          if (rp === 'end' || rp === 'both') st.chart = patchBar(st.chart, b, { close: '}' });
        });
      }
      for (const k of ['segno', 'coda'] as const) {
        if (!(k in op)) continue;
        if (typeof op[k] !== 'boolean') fail(`${k} is true or false`);
        steps.push((st) => {
          const i = firstIdx(st);
          st.chart = patchEvent(st.chart, i, st.chart.bars[i].events[0].id, { [k]: op[k] as boolean });
        });
      }
      if ('text' in op) {
        const t = op.text == null ? '' : String(op.text).replace(/[<>]/g, '').slice(0, 60);
        steps.push((st) => {
          const i = firstIdx(st);
          st.chart = patchEvent(st.chart, i, st.chart.bars[i].events[0].id, { text: t || undefined });
        });
      }
      if ('fermata' in op) {
        const f = op.fermata;
        if (typeof f === 'boolean') {
          steps.push((st) => {
            for (const [k, id] of ids.entries()) {
              const i = where(st, id, nos[k]);
              const evs = st.chart.bars[i].events;
              for (const e of f ? evs.slice(0, 1) : evs) st.chart = patchEvent(st.chart, i, e.id, { fermata: f || undefined });
            }
          });
        } else {
          const p = placeOf(f, n);
          tickOf(p.beat, ms[p.i], p.i + 1);
          if (!ids.includes(base.bars[p.i].id)) fail(`fermata at ${String(f)} is outside bars ${nos[0]}–${nos[nos.length - 1]}`);
          const id = base.bars[p.i].id;
          steps.push((st) => {
            const i = where(st, id, p.i + 1);
            const tick = tickOf(p.beat, metersOf(st.chart)[i], p.i + 1);
            const e = st.chart.bars[i].events.find((x) => tick >= x.at && tick < x.at + x.dur);
            if (e) st.chart = patchEvent(st.chart, i, e.id, { fermata: true });
          });
        }
      }
      if ('newLine' in op) {
        if (typeof op.newLine !== 'boolean') fail('newLine is true or false');
        steps.push((st) => (st.chart = patchBar(st.chart, firstIdx(st), { br: op.newLine ? true : undefined })));
      }
      if (!steps.length) fail('says nothing to change (give section, time, ending, repeat, barline, segno, coda, fermata, text or newLine)');
      return (st) => steps.forEach((s) => s(st));
    }
    case 'info': {
      only(op, ['title', 'composer', 'style', 'bpm']);
      if (op.bpm != null && !(Number(op.bpm) >= 0 && Number(op.bpm) <= 400)) fail('bpm is 0 (none) to 400');
      const patch: Record<string, unknown> = {};
      for (const k of ['title', 'composer', 'style'] as const) if (op[k] != null) patch[k] = String(op[k]);
      if (op.bpm != null) patch.bpm = Number(op.bpm);
      if (!Object.keys(patch).length) fail('says nothing to change (give title, composer, style or bpm; the key has its own op)');
      return (st) => (st.meta = sanitizeMeta({ ...st.meta, ...patch }, st.meta));
    }
    default:
      return fail(
        op.op == null
          ? 'has no op (one of chords, put, remove, insert, delete, clear, copy, move, transpose, key, format, info)'
          : `“${String(op.op)}” isn’t an op (one of chords, put, remove, insert, delete, clear, copy, move, transpose, key, format, info)`,
      );
  }
}

export type ApplyResult = { ok: true; doc: Doc } | { ok: false; errors: string[] };

/** Apply a request's ops to a song, all of them or none. */
export function applyOps(doc: Doc, ops: unknown): ApplyResult {
  if (!Array.isArray(ops) || !ops.length) return { ok: false, errors: ['ops must be a list of edits'] };
  if (ops.length > MAX_OPS) return { ok: false, errors: [`at most ${MAX_OPS} ops in one request`] };
  const errors: string[] = [];
  const steps: Step[] = [];
  const label = (k: number, op: unknown) => `op ${k + 1}${op && typeof op === 'object' && 'op' in op ? ` (${String((op as { op: unknown }).op)})` : ''}`;
  ops.forEach((op, k) => {
    try {
      if (!op || typeof op !== 'object' || Array.isArray(op)) fail('isn’t an object like {"op": "chords", …}');
      steps.push(compile(op as Record<string, unknown>, doc.chart));
    } catch (e) {
      if (!(e instanceof OpError)) throw e;
      errors.push(`${label(k, op)}: ${e.message}`);
    }
  });
  if (errors.length) return { ok: false, errors };
  const st: State = { chart: doc.chart, meta: doc.meta, lastAfter: new Map() };
  for (const [k, step] of steps.entries()) {
    try {
      step(st);
    } catch (e) {
      if (!(e instanceof OpError)) throw e;
      return { ok: false, errors: [`${label(k, ops[k])}: ${e.message}`] };
    }
  }
  const out = { meta: st.meta, chart: normalizeChart(st.chart) };
  if (sameMusic(out, doc)) return { ok: false, errors: ['these ops change nothing'] };
  return { ok: true, doc: out };
}

/** The same song, whatever the event ids (writing a bar's chords back as they were changes nothing). */
function sameMusic(a: Doc, b: Doc): boolean {
  const strip = (d: Doc) => canon({ meta: d.meta, bars: d.chart.bars.map((x) => ({ ...x, events: x.events.map(({ id: _id, cell: _cell, ...e }) => e) })) });
  return strip(a) === strip(b);
}

// ---- What changed, to read back ----

export interface BarChange {
  /** The bar's number now. */
  n: number;
  /** Its number before, or null for a new bar. */
  was: number | null;
  before: string | null;
  after: string;
}

export function changes(before: Doc, after: Doc): { bars: BarChange[]; removed: number[] } {
  const d = diffCharts(before.chart, after.chart);
  const msB = metersOf(before.chart);
  const msA = metersOf(after.chart);
  const old = new Map(before.chart.bars.map((b, i) => [b.id, i]));
  const now = new Set(after.chart.bars.map((b) => b.id));
  const bars = after.chart.bars.flatMap((b, i) => {
    if (!d.changed.has(b.id)) return [];
    const o = old.get(b.id);
    return [{ n: i + 1, was: o == null ? null : o + 1, before: o == null ? null : barText(before.chart.bars[o], msB[o]) || '/', after: barText(b, msA[i]) || '/' }];
  });
  const removed = before.chart.bars.flatMap((b, i) => (now.has(b.id) ? [] : [i + 1]));
  return { bars, removed };
}
