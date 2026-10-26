// Chord progressions as text, both ways: what you type or paste into the
// editor ("| Cm7 | F7 | Bbmaj7 Eb7 |") and how a bar is shown back.
//
//   Bars are separated by | (or new lines). In a bar, chords are separated by spaces.
//   One chord fills the bar. Chords that divide the bar evenly share it
//   (2 or 4 in 4/4, 3 in 3/4, 8 eighths in 4/4…).
//   chord:beats sets a length in beats: Dm7:2 r:1 G7:1, C:1.5 D:1/2.
//   /  another beat (or share) of what came before: Dm7 / G7 /
//   r or rest · nc or N.C. · %  (repeat the last bar) · C7> a hit
//   C7(b9) is an altered chord; C7(Db7) gives C7 an alternate chord above it.
//
// Anything it can't place for certain — three chords in a 4/4 bar, lengths
// that don't add up, a chord it can't read — is flagged on that bar, never
// guessed at silently.

import { type Ev, type EventKind, type Meter, fitEvents, newId } from './chart';
import { chordText, normalizeChord } from './chords';

export interface ParsedBar {
  events: Ev[];
  simile?: 1 | 2;
  /** Problems a person should look at; the bar is still filled in as best it can be. */
  flags: string[];
  /** The text this bar came from. */
  source: string;
}

interface Token {
  kind: EventKind | 'cont';
  ch?: string;
  alt?: string;
  /** Explicit length, in beats. */
  beats?: number;
}

function parseBeats(s: string): number | null {
  const f = s.match(/^(\d+)\/(\d+)$/);
  const v = f ? Number(f[1]) / Number(f[2]) : Number(s);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function readToken(raw: string): Token | string {
  let t = raw;
  let beats: number | undefined;
  const colon = t.lastIndexOf(':');
  if (colon > 0) {
    const b = parseBeats(t.slice(colon + 1));
    if (b == null) return `can’t read the length in “${raw}”`;
    beats = b;
    t = t.slice(0, colon);
  }
  if (t === '/' || t === '.' || t === '_') return { kind: 'cont', beats };
  if (/^(r|rest|𝄽)$/i.test(t)) return { kind: 'rest', beats };
  if (/^(n|nc|n\.c\.?)$/i.test(t)) return { kind: 'nc', beats };
  if (/^slash$/i.test(t)) return { kind: 'slash', beats };
  let kind: EventKind = 'chord';
  if (t.endsWith('>') || t.startsWith('!')) {
    kind = 'hit';
    t = t.replace(/^!|>$/g, '');
  }
  // C7(b9): an alteration. C7(Db7): an alternate chord.
  let alt: string | undefined;
  const paren = t.match(/^(.*?)\(([^)]*)\)$/);
  if (paren) {
    const inner = paren[2].trim();
    if (/^[A-G]/.test(inner)) {
      alt = normalizeChord(inner) ?? undefined;
      if (!alt) return `can’t read the chord “${inner}”`;
      t = paren[1];
    } else t = `${paren[1]}${inner}`;
  }
  const ch = normalizeChord(t);
  if (!ch) return `can’t read the chord “${t}”`;
  return { kind, ch, alt, beats };
}

/** Split `length` ticks into n parts on whole beats, longer parts first (3 in 4/4 → 2+1+1). */
function longFirst(n: number, m: Meter): number[] {
  if (n <= m.num) {
    const base = Math.floor(m.num / n);
    let extra = m.num - base * n;
    return Array.from({ length: n }, () => (base + (extra-- > 0 ? 1 : 0)) * m.beat);
  }
  return Array.from({ length: n }, (_, k) => Math.round(((k + 1) * m.length) / n) - Math.round((k * m.length) / n));
}

function fmtTime(m: Meter): string {
  return `${m.num}/${m.den}`;
}

export function parseBar(source: string, m: Meter): ParsedBar {
  const flags: string[] = [];
  const words = source.trim().split(/[\s,]+/).filter(Boolean);
  if (words.length === 1 && /^(%|x)$/i.test(words[0])) return { events: [{ id: newId(), at: 0, dur: m.length, kind: 'hold' }], simile: 1, flags, source };
  if (words.length === 1 && words[0] === '%%') return { events: [{ id: newId(), at: 0, dur: m.length, kind: 'hold' }], simile: 2, flags, source };
  const toks: Token[] = [];
  for (const w of words) {
    const t = readToken(w);
    if (typeof t === 'string') flags.push(t);
    else toks.push(t);
  }
  if (!toks.length) return { events: [{ id: newId(), at: 0, dur: m.length, kind: 'hold' }], flags, source };

  // Lengths.
  let sizes: number[];
  const explicit = toks.filter((t) => t.beats != null);
  if (explicit.length) {
    const given = explicit.reduce((s, t) => s + t.beats! * m.beat, 0);
    const rest = toks.length - explicit.length;
    const left = m.length - given;
    if (rest === 0 && Math.abs(left) > 0.5) flags.push(`lengths add up to ${+(given / m.beat).toFixed(2)} of ${m.num} beats`);
    if (rest > 0 && left <= 0) flags.push(`no time left for the chords without a length`);
    const share = rest > 0 && left > 0 ? left / rest : 0;
    sizes = toks.map((t) => Math.round(t.beats != null ? t.beats * m.beat : share));
  } else {
    const n = toks.length;
    const even = m.length / n;
    const onGrid = Number.isInteger(even) && (m.num % n === 0 || (n % m.num === 0 && [2, 3, 4].includes(n / m.num)));
    if (n === 1 || onGrid) sizes = toks.map(() => Math.round(even));
    else {
      sizes = longFirst(n, m);
      flags.push(`${n} chords in a bar of ${fmtTime(m)}: placed ${sizes.map((s) => +(s / m.beat).toFixed(2)).join('+')} beats — check the rhythm (or write lengths like Dm7:2)`);
    }
  }

  // "/" carries on what came before.
  const events: Ev[] = [];
  toks.forEach((t, k) => {
    const dur = sizes[k];
    if (t.kind === 'cont' && events.length) {
      events[events.length - 1].dur += dur;
      return;
    }
    const kind: EventKind = t.kind === 'cont' ? 'hold' : t.kind;
    const ev: Ev = { id: newId(), at: 0, dur, kind };
    if (t.ch) ev.ch = t.ch;
    if (t.alt) ev.alt = t.alt;
    events.push(ev);
  });
  return { events: fitEvents(events, m.length), flags, source };
}

/** Split text into bars and read each against the meter it will land in. */
export function parseProgression(text: string, meterFor: (k: number) => Meter): ParsedBar[] {
  const parts = text
    .replace(/\|\|:|:\|\||\[|\]|\{|\}/g, '|')
    .split(/[|\n]/)
    .map((s) => s.trim());
  // Leading and trailing barlines don't make empty bars; empty bars in between do (as holds).
  while (parts.length && !parts[0]) parts.shift();
  while (parts.length && !parts[parts.length - 1]) parts.pop();
  return parts.map((p, k) => parseBar(p, meterFor(k)));
}

// ---- Back to text ----

function fmtBeats(ticks: number, m: Meter): string {
  const b = ticks / m.beat;
  if (Number.isInteger(b * 4)) return String(+b.toFixed(2));
  for (const d of [3, 6, 12]) if (Number.isInteger(Math.round(b * d * 1000) / 1000)) return `${Math.round(b * d)}/${d}`;
  return String(+b.toFixed(3));
}

function tokenOf(e: Ev): string {
  const alt = e.alt ? `(${chordText(e.alt)})` : '';
  switch (e.kind) {
    case 'chord': return chordText(e.ch!) + alt;
    case 'hit': return `${chordText(e.ch!)}${alt}>`;
    case 'rest': return 'r';
    case 'nc': return 'N.C.';
    case 'slash': return 'slash';
    default: return '/';
  }
}

/** A bar as text: plain chords when they share the bar evenly, with lengths when not. */
export function barText(bar: { events: Ev[]; simile?: 1 | 2 }, m: Meter): string {
  if (bar.simile) return bar.simile === 1 ? '%' : '%%';
  const evs = bar.events;
  if (evs.length === 1 && evs[0].kind === 'hold' && !evs[0].alt) return '';
  const n = evs.length;
  const even = evs.every((e) => e.dur === evs[0].dur);
  const plain = even && (n === 1 || m.num % n === 0 || (n % m.num === 0 && [2, 3, 4].includes(n / m.num)));
  return evs.map((e) => (plain ? tokenOf(e) : `${tokenOf(e)}:${fmtBeats(e.dur, m)}`)).join(' ');
}

export function barsText(bars: { events: Ev[]; simile?: 1 | 2 }[], meters: Meter[]): string {
  return `| ${bars.map((b, i) => barText(b, meters[i]) || '/').join(' | ')} |`;
}
