'use client';

// The editor sheet's panels. Chord: what an event is (simple mode). Rhythm:
// when it starts and how long it lasts (rhythmic mode). Bars: the structure,
// for one bar or a selected range. Type: chords as text, for a bar, a range
// or a whole new tune. All of them edit the one chart through `apply`, so
// everything is undoable and nothing behaves differently between them.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { type Bar, type Chart, type Ev, type EventKind, type Meter, sectionLabel } from '@ifakepro/lib/chart';
import {
  type ChordStyle, QUALITIES, chordParts, chordText, isDominant, joinChord, normalizeChord, roots, splitChord, tritoneSub, twoOf,
} from '@ifakepro/lib/chords';
import {
  GRIDS, chordBefore, clearBarlines, clearBars, deleteBars, duplicateBars, insertAt, insertBars, insertCopies, mergeWithNext, moveBars, patchBar,
  patchEvent, removeEvent, replaceEvents, sectionRange, setChord, setDuration, setKind, shiftEvent, splitEvent, splitOnGrid, toggleWrap, transposeBars,
} from '@ifakepro/lib/edit';
import { type ParsedBar, barsText, parseBar, parseProgression } from '@ifakepro/lib/progression';
import type { Selection } from '../ChartView';
import { ChartView } from '../ChartView';
import { beatsLabel, positionLabel } from './Timeline';

export interface EdCtx {
  chart: Chart;
  meters: Meter[];
  sel: Selection;
  /** First selected bar. */
  i: number;
  bar: Bar;
  m: Meter;
  ev: Ev;
  multi: boolean;
  apply: (fn: (c: Chart) => Chart, coalesce?: string) => void;
  select: (from: number, to?: number, ev?: string | null) => void;
  goEvent: (delta: 1 | -1) => void;
  flats: boolean;
  chordStyle: ChordStyle;
  step: number;
  grid: number;
  setGrid: (g: number) => void;
  canComment: boolean;
  onComment: (barId: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  note: (text: string) => void;
}

// ---- Shared bits ----

function Btn(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { on?: boolean; wide?: boolean }) {
  const { on, wide, className, ...rest } = props;
  return <button type="button" {...rest} className={`ed-btn ${on ? 'on' : ''} ${wide ? 'wide' : ''} ${className ?? ''}`} aria-pressed={on} />;
}

const KINDS: { kind: EventKind; label: string; more?: boolean; title: string }[] = [
  { kind: 'chord', label: 'Chord', title: 'A chord symbol' },
  { kind: 'rest', label: 'Rest', title: 'Silence: nobody plays' },
  { kind: 'nc', label: 'N.C.', title: 'No chord: the band stops, the melody goes on' },
  { kind: 'hold', label: 'No change', more: true, title: 'No new chord here: the harmony before carries on' },
  { kind: 'slash', label: 'Slash', more: true, title: 'A rhythmic slash on the current harmony' },
  { kind: 'hit', label: 'Hit', more: true, title: 'An ensemble hit (accent), on a chord' },
];

function KindChips({ c }: { c: EdCtx }) {
  const [more, setMore] = useState(['hold', 'slash', 'hit'].includes(c.ev.kind));
  return (
    <div className="ed-row ed-kinds" role="group" aria-label="What this is">
      {KINDS.filter((k) => !k.more || more).map((k) => (
        <Btn key={k.kind} on={c.ev.kind === k.kind} title={k.title} onClick={() => c.apply((ch) => setKind(ch, c.i, c.ev.id, k.kind))}>
          {k.label}
        </Btn>
      ))}
      {!more && (
        <Btn onClick={() => setMore(true)} aria-label="More kinds of event">
          More…
        </Btn>
      )}
    </div>
  );
}

function qualityLabel(q: string, style: ChordStyle): string {
  if (q === '') return 'maj';
  if (q === '-') return style === 'jazz' ? '–' : 'm';
  return chordParts(`C${q}`, style).quality;
}

// ---- Chord (simple mode) ----

export function ChordPanel({ c }: { c: EdCtx }) {
  const { ev } = c;
  const isChord = ev.kind === 'chord' || ev.kind === 'hit';
  const parts = isChord && ev.ch ? splitChord(ev.ch) : null;
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [moreQ, setMoreQ] = useState(false);
  const [bassOpen, setBassOpen] = useState(!!parts?.bass);
  const lastQ = useRef('7');

  // The field shows the selected event; it follows the selection and outside edits.
  const shown = isChord && ev.ch ? chordText(ev.ch) : '';
  const lastEv = useRef(ev.id);
  useLayoutEffect(() => {
    const el = c.inputRef.current;
    const moved = lastEv.current !== ev.id;
    lastEv.current = ev.id;
    // Another event: show it, selected, so typing replaces it. The same event changed while
    // typing (each valid chord is applied as you go): leave what's being typed alone.
    if (moved || document.activeElement !== el || !text) {
      setText(shown);
      if (moved && el && document.activeElement === el) requestAnimationFrame(() => el.select());
    }
    setErr(null);
  }, [ev.id, shown]); // eslint-disable-line react-hooks/exhaustive-deps

  const put = (ch: string, key?: string) => c.apply((x) => setChord(x, c.i, ev.id, ch), key);
  const fromRoot = (root: string) => {
    if (parts) return put(joinChord({ ...parts, root }));
    const q = splitChord(chordBefore(c.chart, c.i, ev.id) ?? '')?.quality ?? lastQ.current;
    put(`${root}${q}`);
  };
  const fromQuality = (q: string) => {
    lastQ.current = q;
    if (parts) return put(joinChord({ ...parts, quality: q }));
    const root = splitChord(chordBefore(c.chart, c.i, ev.id) ?? 'C')?.root ?? 'C';
    put(`${root === 'W' ? 'C' : root}${q}`);
  };

  const onText = (v: string) => {
    setText(v);
    const t = v.trim();
    if (!t) return setErr(null);
    if (/\s/.test(t)) return setErr(null); // a whole bar; applied on Enter
    const n = normalizeChord(t);
    if (n) {
      setErr(null);
      put(n, `text:${ev.id}`);
    } else setErr(`“${t}” isn’t a chord yet`);
  };
  const commit = (move: boolean) => {
    const t = text.trim();
    if (/\s/.test(t)) {
      const p = parseBar(t, c.m);
      c.apply((x) => replaceEvents(x, c.i, p.events, p.simile));
      if (p.flags.length) c.note(`Bar ${c.i + 1}: ${p.flags.join('; ')}`);
      if (move) c.select(c.i + 1 < c.chart.bars.length ? c.i + 1 : c.i, undefined, null);
      return;
    }
    if (t && !normalizeChord(t)) return setErr(`“${t}” isn’t a chord`);
    if (move) c.goEvent(1);
  };

  const rs = roots(c.flats);
  const common = QUALITIES.filter((q) => q.common);
  const qualities = moreQ ? QUALITIES : common;
  const currentQ = parts?.quality ?? null;
  const currentRoot = parts?.root ?? null;

  return (
    <div className="ed-panel-body">
      <div className="ed-row ed-entry">
        <input
          ref={c.inputRef}
          className={`ed-input ${err ? 'bad' : ''}`}
          value={text}
          onChange={(e) => onText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
              e.preventDefault();
              commit(true);
            } else if (e.key === 'Tab' && e.shiftKey) {
              e.preventDefault();
              c.goEvent(-1);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setText(shown);
              (e.target as HTMLInputElement).blur();
            }
          }}
          onBlur={() => {
            if (/\s/.test(text.trim())) commit(false);
          }}
          placeholder={isChord ? 'Chord' : 'Type a chord — e.g. Dm7, Bb7b9, F/A'}
          aria-label="Chord"
          aria-invalid={!!err}
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="next"
        />
        <Btn className="ed-next" onClick={() => commit(true)} aria-label="Next chord">
          Next ›
        </Btn>
      </div>
      {err && <div className="ed-err" role="alert">{err}</div>}

      <div className="ed-roots" role="group" aria-label="Root">
        {rs.map((r) => (
          <Btn key={r} on={currentRoot === r} onClick={() => fromRoot(r)} className="ed-root">
            {r.replace('b', '♭').replace('#', '♯')}
          </Btn>
        ))}
      </div>
      <div className="ed-quals" role="group" aria-label="Quality">
        {qualities.map((q) => (
          <Btn key={q.q} on={currentQ === q.q} onClick={() => fromQuality(q.q)} className="ed-q" title={chordText(`C${q.q}`).slice(1) || 'major'}>
            {qualityLabel(q.q, c.chordStyle)}
          </Btn>
        ))}
        <Btn onClick={() => setMoreQ((x) => !x)} className="ed-q ed-more">{moreQ ? 'Less' : 'More…'}</Btn>
      </div>
      <div className="ed-row">
        <Btn on={bassOpen} onClick={() => setBassOpen((x) => !x)} disabled={!parts}>/ Bass{parts?.bass ? ` ${parts.bass.replace('b', '♭').replace('#', '♯')}` : ''}</Btn>
        {parts && isDominant(ev.ch!) && (
          <Btn onClick={() => put(tritoneSub(ev.ch!, c.flats))} title="Tritone substitute">Tritone sub</Btn>
        )}
        {parts && isDominant(ev.ch!) && ev.dur >= 2 * c.step && (
          <Btn
            title="Split into its ii–V"
            onClick={() => {
              const two = twoOf(ev.ch!, c.flats);
              if (!two) return;
              const orig = ev.ch!;
              c.apply((x) => {
                const s = splitEvent(x, c.i, ev.id, 2);
                const second = s.bars[c.i].events[s.bars[c.i].events.findIndex((e) => e.id === ev.id) + 1];
                return setChord(setChord(s, c.i, second.id, orig), c.i, ev.id, two);
              });
            }}
          >
            ii–V
          </Btn>
        )}
        <Btn onClick={() => c.apply((x) => splitEvent(x, c.i, ev.id, 2))} disabled={ev.dur < 2} title="Split this in half (nothing you hear changes until you set a chord)">
          Split ½
        </Btn>
        <Btn onClick={() => c.apply((x) => removeEvent(x, c.i, ev.id))} title="Remove this chord: the one before carries on">
          Remove
        </Btn>
      </div>
      {bassOpen && parts && (
        <div className="ed-roots ed-bass" role="group" aria-label="Bass note">
          <Btn on={!parts.bass} onClick={() => put(joinChord({ ...parts, bass: '' }))} className="ed-root">none</Btn>
          {rs.map((r) => (
            <Btn key={r} on={parts.bass === r} onClick={() => put(joinChord({ ...parts, bass: r }))} className="ed-root">
              /{r.replace('b', '♭').replace('#', '♯')}
            </Btn>
          ))}
        </div>
      )}
      <KindChips c={c} />
    </div>
  );
}

// ---- Rhythm (rhythmic mode) ----

export function RhythmPanel({ c }: { c: EdCtx }) {
  const { ev, m, step } = c;
  const k = c.bar.events.findIndex((e) => e.id === ev.id);
  const room = m.length - ev.at;
  const lengths = [m.beat / 2, m.beat, m.beat * 2, m.beat * 3, m.length].filter((d, i, a) => d <= room && d >= 1 && Number.isInteger(d) && a.indexOf(d) === i);
  const gridName = GRIDS.find((g) => g.div === c.grid)?.label ?? 'Beat';
  return (
    <div className="ed-panel-body">
      <div className="ed-row" role="group" aria-label="Grid">
        <span className="ed-label">Grid</span>
        {GRIDS.map((g) => (
          <Btn key={g.div} on={c.grid === g.div} onClick={() => c.setGrid(g.div)}>
            {g.label}
          </Btn>
        ))}
      </div>
      <div className="ed-info">
        {ev.kind === 'chord' || ev.kind === 'hit' ? <b>{chordText(ev.ch!)}</b> : <b>{KINDS.find((x) => x.kind === ev.kind)?.label}</b>} starts on {positionLabel(ev.at, m)} and lasts{' '}
        {beatsLabel(ev.dur, m)}.
      </div>
      <div className="ed-row" role="group" aria-label="Length">
        <span className="ed-label">Length</span>
        <Btn onClick={() => c.apply((x) => setDuration(x, c.i, ev.id, ev.dur - step), `dur:${ev.id}`)} disabled={ev.dur <= step} aria-label="Shorter">−</Btn>
        <span className="ed-value">{beatsLabel(ev.dur, m)}</span>
        <Btn onClick={() => c.apply((x) => setDuration(x, c.i, ev.id, ev.dur + step), `dur:${ev.id}`)} disabled={ev.at + ev.dur >= m.length} aria-label="Longer">+</Btn>
        {lengths.map((d) => (
          <Btn key={d} on={ev.dur === d} onClick={() => c.apply((x) => setDuration(x, c.i, ev.id, d))}>
            {d === m.length ? 'Bar' : beatsLabel(d, m).replace(/ (beat|eighth)s?$/, '')}
          </Btn>
        ))}
      </div>
      <div className="ed-row" role="group" aria-label="Position">
        <span className="ed-label">Move</span>
        <Btn onClick={() => c.apply((x) => shiftEvent(x, c.i, ev.id, -step, step), `shift:${ev.id}`)} disabled={k < 1}>◂ Earlier</Btn>
        <Btn onClick={() => c.apply((x) => shiftEvent(x, c.i, ev.id, step, step), `shift:${ev.id}`)} disabled={k < 1}>Later ▸</Btn>
      </div>
      <div className="ed-row" role="group" aria-label="Split and merge">
        <Btn onClick={() => c.apply((x) => splitEvent(x, c.i, ev.id, 2))} disabled={ev.dur < 2}>Split ½</Btn>
        <Btn onClick={() => c.apply((x) => splitOnGrid(x, c.i, ev.id, step))} disabled={ev.dur <= step}>Split into {gridName === 'Beat' ? 'beats' : `${gridName}s`}</Btn>
        <Btn onClick={() => c.apply((x) => mergeWithNext(x, c.i, ev.id))} disabled={k >= c.bar.events.length - 1}>Merge with next</Btn>
        <Btn onClick={() => c.apply((x) => removeEvent(x, c.i, ev.id))}>Remove</Btn>
      </div>
      <KindChips c={c} />
    </div>
  );
}

// ---- Bars (structure) ----

const SECTIONS = [['', 'None'], ['A', 'A'], ['B', 'B'], ['C', 'C'], ['D', 'D'], ['i', 'Intro'], ['V', 'Verse']] as const;
const TIMES = ['4/4', '3/4', '2/4', '5/4', '6/4', '7/4', '2/2', '3/8', '5/8', '6/8', '7/8', '9/8', '12/8'];
let clipboard: Bar[] | null = null;

export function BarsPanel({ c, rangeMode, setRangeMode }: { c: EdCtx; rangeMode: boolean; setRangeMode: (v: boolean) => void }) {
  const { sel, chart } = c;
  const from = sel.from;
  const to = sel.to;
  const n = chart.bars.length;
  const first = chart.bars[from];
  const last = chart.bars[to];
  const count = to - from + 1;
  const ev = c.ev;
  const move = (d: number) => {
    let r = { from, to };
    c.apply((x) => {
      const out = moveBars(x, from, to, d);
      r = { from: out.from, to: out.to };
      return out.chart;
    });
    c.select(r.from, r.to);
  };
  return (
    <div className="ed-panel-body">
      <div className="ed-row" role="group" aria-label="Selection">
        <span className="ed-label">{count === 1 ? `Bar ${from + 1}` : `Bars ${from + 1}–${to + 1}`}</span>
        <Btn onClick={() => c.select(Math.max(0, from - 1), to)} disabled={from === 0}>◂ +1</Btn>
        <Btn onClick={() => c.select(from, Math.min(n - 1, to + 1))} disabled={to >= n - 1}>+1 ▸</Btn>
        <Btn onClick={() => c.select(...sectionRange(chart, from))}>Section</Btn>
        <Btn onClick={() => c.select(0, n - 1)}>All</Btn>
        <Btn on={rangeMode} onClick={() => setRangeMode(!rangeMode)} className="ed-range" title="Tap bars on the chart to extend the selection">Tap to extend</Btn>
      </div>
      <div className="ed-row" role="group" aria-label="Bars">
        <Btn onClick={() => { c.apply((x) => insertBars(x, from)); c.select(from); }}>+ Before</Btn>
        <Btn onClick={() => { c.apply((x) => insertBars(x, to + 1)); c.select(to + 1); }}>+ After</Btn>
        <Btn onClick={() => { c.apply((x) => duplicateBars(x, from, to)); c.select(to + 1, to + count); }}>Duplicate</Btn>
        <Btn onClick={() => { c.apply((x) => deleteBars(x, from, to)); c.select(Math.max(0, Math.min(from, n - count - 1))); }} disabled={count >= n}>Delete</Btn>
        <Btn onClick={() => c.apply((x) => clearBars(x, from, to))}>Clear</Btn>
      </div>
      <div className="ed-row" role="group" aria-label="Clipboard and order">
        <Btn
          onClick={() => {
            clipboard = structuredClone(chart.bars.slice(from, to + 1));
            navigator.clipboard?.writeText(barsText(clipboard, c.meters.slice(from, to + 1))).catch(() => {});
            c.note(`Copied ${count} bar${count === 1 ? '' : 's'}`);
          }}
        >
          Copy
        </Btn>
        <Btn onClick={() => { if (clipboard) { const k = clipboard.length; c.apply((x) => insertCopies(x, to + 1, clipboard!)); c.select(to + 1, to + k); } }} disabled={!clipboard}>Paste after</Btn>
        <Btn onClick={() => move(-1)} disabled={from === 0}>◂ Move</Btn>
        <Btn onClick={() => move(1)} disabled={to >= n - 1}>Move ▸</Btn>
        <Btn onClick={() => c.apply((x) => transposeBars(x, from, to, -1, c.flats))} title="Transpose the selected bars down a half step">−½ step</Btn>
        <Btn onClick={() => c.apply((x) => transposeBars(x, from, to, 1, c.flats))} title="Transpose the selected bars up a half step">+½ step</Btn>
      </div>
      <div className="ed-row ed-selects">
        <label>
          Section
          <select value={first.section ?? ''} onChange={(e) => c.apply((x) => patchBar(x, from, { section: e.target.value || undefined, ...(e.target.value && !first.open ? { open: '[' as const } : {}) }))}>
            {SECTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label>
          Time
          <select value={first.time ?? ''} onChange={(e) => c.apply((x) => patchBar(x, from, { time: e.target.value || undefined }))}>
            <option value="">{`— (${c.m.num}/${c.m.den})`}</option>
            {TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>
          Ending
          <select value={first.ending != null ? String(first.ending) : ''} onChange={(e) => c.apply((x) => patchBar(x, from, { ending: e.target.value === '' ? undefined : Number(e.target.value) }))}>
            <option value="">None</option>
            <option value="1">1st</option>
            <option value="2">2nd</option>
            <option value="3">3rd</option>
          </select>
        </label>
      </div>
      <div className="ed-row" role="group" aria-label="Barlines">
        <Btn on={first.open === '{' && last.close === '}'} onClick={() => c.apply((x) => toggleWrap(x, from, to, '{', '}'))} title="Repeat the selected bars">𝄆 Repeat 𝄇</Btn>
        <Btn on={first.open === '[' && last.close === ']'} onClick={() => c.apply((x) => toggleWrap(x, from, to, '[', ']'))}>‖ Double</Btn>
        <Btn on={last.close === 'Z'} onClick={() => c.apply((x) => patchBar(x, to, { close: x.bars[to].close === 'Z' ? undefined : 'Z' }))}>Final</Btn>
        <Btn onClick={() => c.apply((x) => clearBarlines(x, from, to))}>Plain</Btn>
        <Btn on={!!first.br} onClick={() => c.apply((x) => patchBar(x, from, { br: x.bars[from].br ? undefined : true }))}>⏎ New line</Btn>
        <Btn on={!!first.simile} onClick={() => c.apply((x) => patchBar(x, from, { simile: x.bars[from].simile ? undefined : 1, simileAt: undefined }))} disabled={count > 1} title="This bar repeats the one before">% Repeat bar</Btn>
      </div>
      {count === 1 && (
        <div className="ed-row" role="group" aria-label={`Marks on ${positionLabel(ev.at, c.m)}`}>
          <span className="ed-label">On {positionLabel(ev.at, c.m)}</span>
          <Btn on={!!ev.segno} onClick={() => c.apply((x) => patchEvent(x, from, ev.id, { segno: !ev.segno }))}>Segno</Btn>
          <Btn on={!!ev.coda} onClick={() => c.apply((x) => patchEvent(x, from, ev.id, { coda: !ev.coda }))}>Coda</Btn>
          <Btn on={!!ev.fermata} onClick={() => c.apply((x) => patchEvent(x, from, ev.id, { fermata: !ev.fermata }))}>Fermata</Btn>
          <Btn
            on={!!ev.text}
            onClick={() => {
              const t = window.prompt('Text above this beat (e.g. “D.C. al Coda”, “Fine”, “Solos”) — empty to remove', ev.text?.replace(/^\*\d\d/, '') ?? '');
              if (t !== null) c.apply((x) => patchEvent(x, from, ev.id, { text: t.trim() || undefined }));
            }}
          >
            Text…
          </Btn>
          {c.canComment && <Btn onClick={() => c.onComment(first.id)}>💬 Comment</Btn>}
        </div>
      )}
      {first.section && <div className="ed-info">Section {sectionLabel(first.section)} starts here.</div>}
    </div>
  );
}

// ---- Type (text) ----

export function TypePanel({ c }: { c: EdCtx }) {
  const { sel, chart, meters } = c;
  const selText = useMemo(() => barsText(chart.bars.slice(sel.from, sel.to + 1), meters.slice(sel.from, sel.to + 1)), [chart, meters, sel.from, sel.to]);
  const [text, setText] = useState(selText);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setText(selText);
  }, [selText, dirty]);

  const parsed: ParsedBar[] = useMemo(() => parseProgression(text, (k) => meters[Math.min(sel.from + k, meters.length - 1)]), [text, meters, sel.from]);
  const flagged = parsed.map((b, k) => ({ k, flags: b.flags })).filter((x) => x.flags.length);
  const preview: Chart = useMemo(
    () => ({ v: 2, bars: parsed.map((b, k) => ({ id: `p${k}`, events: b.events, ...(b.simile ? { simile: b.simile } : {}), ...(k === 0 ? { time: `${meters[sel.from].num}/${meters[sel.from].den}` } : {}) })) }),
    [parsed, meters, sel.from],
  );

  const replace = () => {
    const count = sel.to - sel.from + 1;
    c.apply((x) => {
      let out = x;
      // Fit the bar count to the text, then fill bar by bar.
      if (parsed.length > count) out = insertBars(out, sel.to + 1, parsed.length - count);
      if (parsed.length < count) out = deleteBars(out, sel.from + parsed.length, sel.to);
      parsed.forEach((b, k) => (out = replaceEvents(out, sel.from + k, b.events.map((e) => ({ ...e })), b.simile)));
      return out;
    });
    c.select(sel.from, sel.from + parsed.length - 1);
    setDirty(false);
  };
  const insertAfter = (at: number) => {
    c.apply((x) => {
      let out = insertBars(x, at, parsed.length);
      parsed.forEach((b, k) => (out = replaceEvents(out, at + k, b.events.map((e) => ({ ...e })), b.simile)));
      return out;
    });
    c.select(at, at + parsed.length - 1);
    setDirty(false);
  };

  return (
    <div className="ed-panel-body">
      <textarea
        className="ed-text"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setDirty(true);
        }}
        rows={3}
        spellCheck={false}
        autoCapitalize="characters"
        autoCorrect="off"
        aria-label="Chords as text"
        placeholder="| Cm7 | F7 | Bbmaj7 | Ebmaj7 |"
      />
      <div className="ed-help">
        Bars between <code>|</code>, chords with spaces. <code>Dm7:2 r G7</code> sets lengths in beats · <code>/</code> another beat of the same · <code>r</code> rest ·{' '}
        <code>nc</code> N.C. · <code>%</code> repeat bar · <code>C7(b9)</code> altered · <code>C7&gt;</code> a hit.
      </div>
      {parsed.length > 0 && (
        <div className="ed-preview" aria-label="Preview">
          <ChartView chart={preview} chordStyle={c.chordStyle} changed={new Set(flagged.map((f) => `p${f.k}`))} />
        </div>
      )}
      {flagged.length > 0 && (
        <ul className="ed-flags" role="alert">
          {flagged.map((f) => (
            <li key={f.k}>
              Bar {f.k + 1}: {f.flags.join('; ')}
            </li>
          ))}
        </ul>
      )}
      <div className="ed-row">
        <Btn wide className="primary" disabled={!parsed.length} onClick={replace}>
          Replace {sel.from === sel.to ? `bar ${sel.from + 1}` : `bars ${sel.from + 1}–${sel.to + 1}`}
          {parsed.length && parsed.length !== sel.to - sel.from + 1 ? ` with ${parsed.length}` : ''}
        </Btn>
        <Btn disabled={!parsed.length} onClick={() => insertAfter(sel.to + 1)}>Insert after</Btn>
        <Btn disabled={!parsed.length} onClick={() => insertAfter(chart.bars.length)}>Add at end</Btn>
        <Btn
          onClick={() => {
            c.select(0, chart.bars.length - 1);
            setDirty(false);
          }}
        >
          Whole chart
        </Btn>
      </div>
    </div>
  );
}

/** For the keyboard: put an event's kind straight in (r rest, n N.C.). */
export function quickKind(c: EdCtx, kind: EventKind) {
  c.apply((x) => setKind(x, c.i, c.ev.id, kind));
}

/** For the keyboard and the + marks: start a chord at a tick. */
export function addAt(c: EdCtx, tick: number): string | null {
  let id: string | null = null;
  c.apply((x) => {
    const r = insertAt(x, c.i, tick, 'chord');
    id = r.id;
    return r.chart;
  });
  return id;
}
