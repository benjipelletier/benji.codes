// Reading and writing iReal Pro links.
//
// A link is irealb:// followed by percent-encoded songs joined with ===, and
// the playlist's name last when there's more than one song. Each song is
// Title=Composer==Style=Key=Transpose=Music=CompStyle=BPM=Repeats, and the
// music is "1r34LbKcu7" followed by the chart, scrambled 50 characters at a
// time (obfusc50 below, which undoes itself). Unscrambled, the chart is a
// stream of 16-to-a-row cells: a chord, or a space for an empty cell, with
// barlines and marks written between them. Notes on the format:
// https://github.com/ironss/accompaniser/blob/master/irealb_parser.lua

import { type Chart, type SongMeta, EMPTY_META, newId } from './chart';
import { cellChartToChart, chartToCellChart } from './convert';
import { type Cell, type CellBar as Bar, type CellChart, type CloseBar, isBlankCell as isBlank } from './legacy';
import { CHORD_RE } from './chords';

const MUSIC_PREFIX = '1r34LbKcu7';

function obfusc50(s: string): string {
  const out = s.split('');
  for (let i = 0; i < 5; i++) {
    out[49 - i] = s[i];
    out[i] = s[49 - i];
  }
  for (let i = 10; i < 24; i++) {
    out[49 - i] = s[i];
    out[i] = s[49 - i];
  }
  return out.join('');
}

/** Scrambling and unscrambling are the same operation. */
export function scramble(s: string): string {
  let out = '';
  while (s.length > 51) {
    out += obfusc50(s.slice(0, 50));
    s = s.slice(50);
  }
  return out + s;
}
export const unscramble = scramble;

/** iReal's shorthands, expanded: Kcl is a repeat-bar cell, LZ a barline, XyQ three empty cells. */
function expand(s: string): string {
  return s.replace(/Kcl/g, '| x').replace(/LZ/g, ' |').replace(/XyQ/g, '   ');
}

export interface ParsedSong {
  meta: SongMeta;
  chart: Chart;
}

export interface ParsedPlaylist {
  name: string | null;
  songs: ParsedSong[];
  failed: { title: string; reason: string }[];
}

/** iReal stores "Last First"; show "First Last". Two-word names only, so it swaps back exactly. */
export function composerFromIReal(c: string): string {
  const parts = c.trim().split(/\s+/);
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : c.trim();
}
export const composerToIReal = composerFromIReal;

function timeFromToken(t: string): string {
  if (t === '12') return '12/8';
  return `${t[0]}/${t[1]}`;
}

function timeToToken(t: string): string {
  if (t === '12/8') return '12';
  const [a, b] = t.split('/');
  return `${a}${b}`;
}

interface Pending {
  section?: string;
  time?: string;
  ending?: number;
  vspace?: number;
  text?: string;
  segno?: boolean;
  coda?: boolean;
  fermata?: boolean;
  end?: boolean;
}

/** Turn an unscrambled music string into iReal's cell bars. `unknown` counts characters it had to skip. */
export function parseCells(raw: string): { chart: CellChart; unknown: string } {
  const s = expand(raw);
  const bars: Bar[] = [];
  let bar: Bar | null = null;
  let lastCell: Cell | null = null;
  let small = false;
  let spacer = 0;
  let pending: Pending = {};
  let unknown = '';

  const startBar = (open?: Bar['open']) => {
    bar = { id: newId(), cells: [] };
    if (open) bar.open = open;
    if (spacer) bar.spacer = spacer;
    spacer = 0;
  };
  const pushBar = () => {
    if (bar && bar.cells.length) bars.push(bar);
    bar = null;
    lastCell = null;
  };
  const addCell = (c: Cell) => {
    if (!bar) {
      if (isBlank(c) && !c.alt) {
        // Empty cells after a ] } Z, before the next bar: layout, not music.
        spacer++;
        return;
      }
      startBar();
    }
    const b = bar!;
    if (pending.section) b.section = pending.section;
    if (pending.time) b.time = pending.time;
    if (pending.ending != null) b.ending = pending.ending;
    if (pending.vspace) b.vspace = pending.vspace;
    if (pending.text) c.text = pending.text;
    if (pending.segno) c.segno = true;
    if (pending.coda) c.coda = true;
    if (pending.fermata) c.fermata = true;
    if (pending.end) c.end = true;
    pending = {};
    b.cells.push(c);
    lastCell = c;
  };
  const close = (c: CloseBar) => {
    const b = bar as Bar | null;
    if (b && b.cells.length) {
      b.close = c;
      pushBar();
    } else {
      // "|]" or "]]": the bar a | opened is empty; the close belongs to the last bar.
      bar = null;
      if (bars.length) bars[bars.length - 1].close = c;
    }
    spacer = 0;
  };

  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '<') {
      const j = s.indexOf('>', i);
      const text = s.slice(i + 1, j < 0 ? s.length : j);
      pending.text = pending.text ? `${pending.text} ${text}` : text;
      i = j < 0 ? s.length : j + 1;
      continue;
    }
    if (ch === '*' && /[A-Za-z]/.test(s[i + 1] ?? '')) {
      pending.section = s[i + 1];
      i += 2;
      continue;
    }
    if (ch === 'T' && /^\d\d$/.test(s.slice(i + 1, i + 3))) {
      pending.time = timeFromToken(s.slice(i + 1, i + 3));
      i += 3;
      continue;
    }
    if (ch === 'N' && /\d/.test(s[i + 1] ?? '')) {
      pending.ending = Number(s[i + 1]);
      i += 2;
      continue;
    }
    if (ch === '(') {
      const j = s.indexOf(')', i);
      const alt = s.slice(i + 1, j < 0 ? s.length : j).trim();
      i = j < 0 ? s.length : j + 1;
      if (!alt) continue;
      if (lastCell) lastCell.alt = lastCell.alt ? `${lastCell.alt} ${alt}` : alt;
      else addCell({ alt });
      continue;
    }
    const chord = /[A-GW]/.test(ch) ? s.slice(i).match(CHORD_RE) : null;
    if (chord) {
      const cell: Cell = { ch: chord[0] };
      if (small) cell.small = true;
      addCell(cell);
      i += chord[0].length;
      continue;
    }
    i++;
    switch (ch) {
      case ' ': addCell({}); break;
      case ',': break;
      case 'x': case 'r': case 'n': addCell({ sym: ch }); break;
      case 'p': addCell(small ? { sym: 'p', small: true } : { sym: 'p' }); break;
      case 's': small = true; break;
      case 'l': small = false; break;
      case 'Y': pending.vspace = (pending.vspace ?? 0) + 1; break;
      case 'S': pending.segno = true; break;
      case 'Q': pending.coda = true; break;
      case 'f': pending.fermata = true; break;
      case 'U': pending.end = true; break;
      case '|': {
        const b = bar as Bar | null;
        if (b && !b.cells.length) b.open ??= '|';
        else {
          pushBar();
          startBar('|');
        }
        break;
      }
      case '[': case '{': {
        const b = bar as Bar | null;
        if (b && !b.cells.length) b.open = ch;
        else {
          pushBar();
          startBar(ch);
        }
        break;
      }
      case ']': case '}': case 'Z': close(ch); break;
      default: unknown += ch;
    }
  }
  pushBar();
  // A stray barline at the very end ("Z[ ") leaves a bar with nothing in it.
  while (bars.length > 1) {
    const b = bars[bars.length - 1];
    if (b.cells.some((c) => Object.keys(c).length) || b.section || b.time || b.ending != null) break;
    bars.pop();
  }
  // Marks after the last cell (a closing "Fine", say) go on the last cell.
  const tail = bars[bars.length - 1]?.cells.at(-1);
  if (tail) {
    if (pending.text) tail.text = tail.text ? `${tail.text} ${pending.text}` : pending.text;
    if (pending.segno) tail.segno = true;
    if (pending.coda) tail.coda = true;
    if (pending.fermata) tail.fermata = true;
    if (pending.end) tail.end = true;
  }
  return { chart: { v: 1, bars }, unknown };
}

/** Turn an unscrambled music string into a chart of timed events. */
export function parseMusic(raw: string): { chart: Chart; unknown: string } {
  const { chart, unknown } = parseCells(raw);
  return { chart: cellChartToChart(chart), unknown };
}

/** Write a chart out as an (unscrambled) iReal music string. */
export function serializeMusic(chart: Chart): string {
  return serializeCells(chartToCellChart(chart));
}

export function serializeCells(chart: CellChart): string {
  let out = '';
  let small = false;
  let prev: Bar | null = null;
  for (const bar of chart.bars) {
    const hardBefore = !prev || !!prev.close;
    if (bar.vspace) out += 'Y'.repeat(bar.vspace);
    // Empty cells can only stand between bars after a hard close; after a
    // plain bar iReal reads them as part of it, which is how it would draw them anyway.
    if (bar.spacer) out += ' '.repeat(bar.spacer);
    if (bar.open === '[' || bar.open === '{') out += bar.open;
    else if (bar.open === '|' || !hardBefore) out += '|';
    if (bar.section) out += `*${bar.section}`;
    if (bar.time) out += `T${timeToToken(bar.time)}`;
    if (bar.ending != null) out += `N${bar.ending}`;
    bar.cells.forEach((c, j) => {
      if (c.text) out += `<${c.text.replace(/[<>]/g, '')}>`;
      if (c.segno) out += 'S';
      if (c.coda) out += 'Q';
      if (c.fermata) out += 'f';
      if (c.end) out += 'U';
      const takesSize = !!c.ch || c.sym === 'p';
      if (takesSize && !!c.small !== small) {
        small = !!c.small;
        out += small ? 's' : 'l';
      }
      if (c.ch) out += c.ch;
      else if (c.sym) out += c.sym;
      else out += ' ';
      if (c.alt) out += `(${c.alt})`;
      const next = bar.cells[j + 1];
      if (!isBlank(c) && next && !isBlank(next)) out += ',';
    });
    if (bar.close) out += bar.close;
    prev = bar;
  }
  return out;
}

function parseSongFields(fields: string[]): ParsedSong {
  const mi = fields.findIndex((f) => f.startsWith(MUSIC_PREFIX));
  let title = '', composer = '', style = '', key = '', transpose = '', comp = '', bpm = '', repeats = '';
  let music = '';
  if (mi === 6) {
    [title, composer, , style, key, transpose] = fields;
    [comp = '', bpm = '', repeats = ''] = fields.slice(7);
    music = fields[6].slice(MUSIC_PREFIX.length);
  } else if (mi >= 0) {
    // Older or hand-made links drop the empty fields; fall back to what's left.
    const before = fields.slice(0, mi).filter(Boolean);
    [title = '', composer = '', style = '', key = '', transpose = ''] = before;
    const after = fields.slice(mi + 1).filter(Boolean);
    if (after.length === 3) [comp, bpm, repeats] = after;
    else [bpm = '', repeats = ''] = after;
    music = fields[mi].slice(MUSIC_PREFIX.length);
  } else {
    throw new Error('no chart in this song');
  }
  const { chart } = parseMusic(unscramble(music));
  if (!chart.bars.length) throw new Error('chart has no bars');
  return {
    meta: {
      ...EMPTY_META,
      title: title.trim() || 'Untitled',
      composer: composerFromIReal(composer),
      style: style.trim(),
      key: /^[A-G][b#]?-?$/.test(key) ? key : 'C',
      transpose: Number(transpose) || 0,
      comp: comp.trim(),
      bpm: Number(bpm) || 0,
      repeats: Number(repeats) || 0,
    },
    chart,
  };
}

/** irealbook:// is the old, unscrambled form: Title=Composer=Style=Key=n=Music. */
function parseOldSong(fields: string[]): ParsedSong {
  const [title = '', composer = '', style = '', key = ''] = fields;
  const music = fields[fields.length - 1] ?? '';
  const { chart } = parseMusic(music);
  if (!chart.bars.length) throw new Error('chart has no bars');
  return {
    meta: { ...EMPTY_META, title: title.trim() || 'Untitled', composer: composerFromIReal(composer), style, key: /^[A-G][b#]?-?$/.test(key) ? key : 'C' },
    chart,
  };
}

/** Every iReal link in some text: a pasted link, or the HTML page iReal exports. */
export function findLinks(text: string): string[] {
  return text.match(/irealb(?:ook)?:\/\/[^"<>\s]+/g) ?? [];
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return decodeURIComponent(s.replace(/%(?![0-9A-Fa-f]{2})/g, '%25'));
  }
}

export function parseLink(link: string): ParsedPlaylist {
  const old = link.startsWith('irealbook://');
  const body = decode(link.replace(/^irealb(?:ook)?:\/\//, ''));
  const parts = body.split('===');
  let name: string | null = null;
  if (parts.length > 1 && !parts[parts.length - 1].includes('=')) name = parts.pop()!.trim() || null;
  const songs: ParsedSong[] = [];
  const failed: ParsedPlaylist['failed'] = [];
  for (const p of parts) {
    if (!p.trim()) continue;
    const fields = p.split('=');
    try {
      songs.push(old ? parseOldSong(fields) : parseSongFields(fields));
    } catch (e) {
      failed.push({ title: fields[0] || '(untitled)', reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return { name, songs, failed };
}

/** Parse any text holding iReal links. Throws when there are none. */
export function parseIReal(text: string): ParsedPlaylist {
  const links = findLinks(text.trim());
  if (!links.length) throw new Error('No irealb:// link found');
  const out: ParsedPlaylist = { name: null, songs: [], failed: [] };
  for (const l of links) {
    const p = parseLink(l);
    out.name ??= p.name;
    out.songs.push(...p.songs);
    out.failed.push(...p.failed);
  }
  return out;
}

function songFields(meta: SongMeta, chart: Chart): string {
  const clean = (s: string) => s.replace(/=/g, '');
  return [
    clean(meta.title),
    clean(composerToIReal(meta.composer)),
    '',
    clean(meta.style),
    meta.key,
    meta.transpose ? String(meta.transpose) : '',
    MUSIC_PREFIX + scramble(serializeMusic(chart)),
    clean(meta.comp),
    String(meta.bpm || 0),
    String(meta.repeats || 0),
  ].join('=');
}

export function serializeSong(song: ParsedSong): string {
  return `irealb://${encodeURIComponent(songFields(song.meta, song.chart))}`;
}

export function serializePlaylist(name: string, songs: ParsedSong[]): string {
  if (songs.length === 1 && !name) return serializeSong(songs[0]);
  const body = songs.map((s) => songFields(s.meta, s.chart)).join('===');
  return `irealb://${encodeURIComponent(`${body}===${name.replace(/=/g, '')}`)}`;
}

/** The HTML page iReal itself exports: opening it on a phone with iReal installed imports the songs. */
export function exportHtml(name: string, link: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(name)}</title></head>
<body style="font-family:system-ui;padding:2rem">
<h1>${esc(name)}</h1>
<p><a href="${esc(link)}">Open in iReal Pro</a></p>
<p>Made with iFake Pro · benji.codes/ifakepro</p>
</body></html>
`;
}
