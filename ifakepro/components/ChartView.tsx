'use client';

// Draws a chart the way iReal Pro and the Real Book do: rows of 16 cells,
// barlines with repeats and endings, boxed section letters, handwritten
// chords (Petaluma Script) and music signs (Petaluma Text, SMuFL). Sizes scale
// with the chart's width (container units), so the same chart reads on a
// phone and fills a laptop.

import { memo, type MouseEvent as RMouseEvent } from 'react';
import { type Bar, type Chart, type Ev, type SongMeta, cellText, layout, metersOf, sectionLabel, timeAt } from '@ifakepro/lib/chart';
import { type ChordStyle, chordParts, transposeEvent } from '@ifakepro/lib/chords';
import { displayKey } from '@ifakepro/lib/client';

export interface Selection {
  from: number;
  to: number;
  /** The selected event, when one bar is selected. */
  ev: string | null;
}

export interface ChartViewProps {
  chart: Chart;
  /** Semitones to transpose the display by. */
  shift?: number;
  flats?: boolean;
  chordStyle?: ChordStyle;
  selection?: Selection | null;
  /** A click or tap on a bar, with the time (in ticks) under it. */
  onBarClick?: (index: number, tick: number, e: RMouseEvent) => void;
  /** Draw the beats across the selected bar (editing). */
  beatGrid?: boolean;
  /** People on each bar, by bar id. */
  presence?: Record<string, { name: string; color: string }[]>;
  /** Open comment threads per bar id. */
  pins?: Record<string, number>;
  onPin?: (barId: string) => void;
  /** Bars to tint: changed in a version, or just changed by someone else. */
  changed?: Set<string>;
  flash?: Set<string>;
  barNumbers?: boolean;
  className?: string;
}

// Music symbols come from Petaluma Text, a SMuFL font: these are its code points.
export const SMUFL = {
  flat: '\uE260',
  sharp: '\uE262',
  segno: '\uE047',
  coda: '\uE048',
  fermata: '\uE4C0',
  repeat1: '\uE500',
  repeat2: '\uE501',
  accent: '\uE4A0',
  maj7: '\uE873',
  halfDim: '\uE871',
  dim: '\uE870',
  aug: '\uE872',
  timeDigit: (d: string) => String.fromCharCode(0xe080 + Number(d)),
};

const SYM: Record<string, string> = { '♭': SMUFL.flat, '♯': SMUFL.sharp, '△': SMUFL.maj7, 'ø': SMUFL.halfDim, '°': SMUFL.dim };

/** Text with its music signs (♭ ♯ △ ø °) drawn from the music font. */
function Signs({ text }: { text: string }) {
  return (
    <>
      {text.split(/([♭♯△ø°])/).map((t, i) =>
        SYM[t] ? (
          <span key={i} className={`smufl sg-${t === '♭' || t === '♯' ? 'acc' : 'q'}`}>
            {SYM[t]}
          </span>
        ) : (
          t.replace(/–/g, '-')
        ),
      )}
    </>
  );
}

/** A note name: the letter, then its accidental small and raised. */
function Note({ name }: { name: string }) {
  return (
    <>
      {name[0]}
      {name.length > 1 && <span className="ch-acc smufl">{name[1] === '♭' ? SMUFL.flat : SMUFL.sharp}</span>}
    </>
  );
}

/**
 * A chord the way iReal and the Real Book write it: a big letter, its flat or
 * sharp small and raised, the quality small and dropped below the line, and a
 * bass note after a slash.
 */
export function Chord({ ch, style = 'jazz' }: { ch: string; style?: ChordStyle }) {
  const p = chordParts(ch, style);
  return (
    <span className="ch">
      {p.root && (
        <span className="ch-root">
          <Note name={p.root} />
        </span>
      )}
      {p.quality && (
        <span className="ch-q">
          <Signs text={p.quality} />
        </span>
      )}
      {p.bass && (
        <span className="ch-bass">
          /<Note name={p.bass} />
        </span>
      )}
    </span>
  );
}

/** The chart's heading, set out like iReal's: (style) on the left, the title in the middle, the composer on the right. */
export function ChartHead({ meta, playlist, keyShown, onEdit }: { meta: SongMeta; playlist?: string; keyShown?: string; onEdit?: () => void }) {
  const style = [meta.style, meta.bpm ? `♩ = ${meta.bpm}` : ''].filter(Boolean).join(' · ');
  return (
    <header className="chart-head">
      {playlist && <span className="ch-list">{playlist}</span>}
      {onEdit ? (
        <button className="ch-title" onClick={onEdit} title="Edit the title, composer, style, tempo and key">
          {meta.title}
        </button>
      ) : (
        <h1 className="ch-title">{meta.title}</h1>
      )}
      <span className="ch-key">Key of {displayKey(keyShown ?? meta.key)}</span>
      <span className="ch-style">{style ? `(${style})` : ''}</span>
      <span className="ch-composer">{meta.composer}</span>
    </header>
  );
}

const REST: [number, string][] = [
  [96, ''], [48, ''], [24, ''], [12, ''], [6, ''], [3, ''],
];

/** The rest sign for a length: the largest that fits, dotted when it's half as long again. */
function restGlyph(dur: number, wholeBar: boolean): string {
  if (wholeBar) return REST[0][1];
  for (const [t, g] of REST) {
    if (dur === t) return g;
    if (dur === t * 1.5) return `${g} `;
  }
  return (REST.find(([t]) => t <= dur) ?? REST[REST.length - 1])[1];
}

function EventView({ ev, style, wholeBar, sel, first }: { ev: Ev; style: ChordStyle; wholeBar: boolean; sel: boolean; first: boolean }) {
  const marks = (
    <>
      {(ev.segno || ev.coda || ev.fermata || ev.text || ev.kind === 'hit') && (
        <span className="cell-marks">
          {ev.kind === 'hit' && <span className="smufl sym accent" title="Hit">{SMUFL.accent}</span>}
          {ev.segno && <span className="smufl sym" title="Segno">{SMUFL.segno}</span>}
          {ev.coda && <span className="smufl sym" title="Coda">{SMUFL.coda}</span>}
          {ev.fermata && <span className="smufl sym" title="Fermata">{SMUFL.fermata}</span>}
          {ev.text && <span className="cell-text">{cellText(ev.text)}</span>}
        </span>
      )}
      {ev.alt && (
        <span className="cell-alt">
          {ev.alt.split(/\s+/).map((a, i) => (/^[A-GW]/.test(a) ? <Chord key={i} ch={a} style={style} /> : <span key={i}>{a}</span>))}
        </span>
      )}
    </>
  );
  let body = null;
  if ((ev.kind === 'chord' || ev.kind === 'hit') && ev.ch) body = <Chord ch={ev.ch} style={style} />;
  else if (ev.kind === 'rest') body = <span className="smufl rest" aria-label="rest">{restGlyph(ev.dur, wholeBar)}</span>;
  else if (ev.kind === 'slash') body = <span className="slash">/</span>;
  else if (ev.kind === 'nc') body = <span className="nc">N.C.</span>;
  return (
    <span className={`cell ev ev-${ev.kind} ${ev.small ? 'cell-small' : ''} ${sel ? 'ev-sel' : ''} ${first ? 'c0' : ''}`} data-ev={ev.id}>
      {marks}
      {body}
    </span>
  );
}

/** Where each ending bracket starts and how far it runs. */
function endings(bars: Bar[]): (number | 'cont' | null)[] {
  const out: (number | 'cont' | null)[] = bars.map(() => null);
  for (let i = 0; i < bars.length; i++) {
    if (bars[i].ending == null) continue;
    out[i] = bars[i].ending!;
    let j = i;
    while (!bars[j].close && j + 1 < bars.length && j - i < 7 && bars[j + 1].ending == null && !bars[j + 1].section) {
      j++;
      out[j] = 'cont';
    }
  }
  return out;
}

function ChartViewInner(props: ChartViewProps) {
  const { chart, shift = 0, flats = true, chordStyle = 'jazz', selection, onBarClick, presence, pins, onPin, changed, flash, barNumbers, beatGrid, className } = props;
  const rows = layout(chart);
  const times = timeAt(chart);
  const ms = metersOf(chart);
  const ends = endings(chart.bars);
  return (
    <div className={`chart ${className ?? ''}`}>
      {rows.map((row, ri) => (
        <div key={ri} className="chart-row" style={row.vspace ? { marginTop: `${row.vspace * 0.9}em` } : undefined}>
          {row.items.map((it, k) => {
            if (it.kind === 'spacer') return <div key={`s${k}`} className="spacer" style={{ gridColumn: `span ${it.span}` }} />;
            const { bar, index } = it;
            const m = ms[index];
            const prevItem = row.items[k - 1];
            const prevBar = prevItem?.kind === 'bar' ? prevItem.bar : null;
            const isRowEnd = k === row.items.length - 1;
            const showTime = bar.time && (index === 0 || times[index - 1] !== bar.time);
            const events = bar.events.map((e) => transposeEvent(e, shift, flats));
            const shown = events.filter((e) => e.kind !== 'hold' || e.alt);
            const selected = selection && index >= selection.from && index <= selection.to;
            const people = presence?.[bar.id];
            const ending = ends[index];
            const cls = [
              'bar',
              bar.open === '[' ? 'open-dbl' : bar.open === '{' ? 'open-rep' : prevBar?.close ? 'open-none' : '',
              bar.close === ']' ? 'close-dbl' : bar.close === '}' ? 'close-rep' : bar.close === 'Z' ? 'close-fin' : '',
              isRowEnd && !bar.close ? 'row-end' : '',
              showTime ? 'has-time' : '',
              shown.length >= 3 || events.some((e) => e.dur < m.beat && e.kind !== 'hold') ? 'dense' : '',
              shown.length >= 4 ? 'crowded' : '',
              selected ? 'sel' : '',
              changed?.has(bar.id) ? 'changed' : '',
              flash?.has(bar.id) ? 'flash' : '',
              people?.length ? 'present' : '',
              ending != null ? 'in-ending' : '',
              typeof ending === 'number' ? 'ending-start' : '',
            ]
              .filter(Boolean)
              .join(' ');
            const wholeBar = events.length === 1;
            return (
              <div
                key={bar.id}
                className={cls}
                data-bar={index}
                role={onBarClick ? 'button' : undefined}
                aria-label={onBarClick ? `Bar ${index + 1}` : undefined}
                style={{ gridColumn: `span ${it.span}`, ...(people?.length ? { ['--who' as string]: people[0].color } : {}) }}
                onClick={
                  onBarClick
                    ? (e) => {
                        const body = (e.currentTarget as HTMLElement).querySelector('.bar-body') as HTMLElement;
                        const r = body.getBoundingClientRect();
                        const frac = Math.max(0, Math.min(0.9999, (e.clientX - r.left) / r.width));
                        onBarClick(index, Math.floor(frac * m.length), e);
                      }
                    : undefined
                }
              >
                {bar.section && <span className="section">{sectionLabel(bar.section)}</span>}
                {typeof ending === 'number' && <span className="ending">{ending ? `${ending}.` : ''}</span>}
                {showTime && (
                  <span className="ts" aria-label={`time ${bar.time}`}>
                    <b>{[...bar.time!.split('/')[0]].map(SMUFL.timeDigit).join('')}</b>
                    <b>{[...bar.time!.split('/')[1]].map(SMUFL.timeDigit).join('')}</b>
                  </span>
                )}
                {(bar.open === '[' || bar.open === '{') && <i className="bl bl-open" aria-hidden />}
                {bar.open === '{' && <i className="dots dots-open" aria-hidden />}
                {bar.close && <i className="bl bl-close" aria-hidden />}
                {bar.close === '}' && <i className="dots dots-close" aria-hidden />}
                {barNumbers && !bar.section && <span className="bar-no">{index + 1}</span>}
                <div
                  className="bar-body"
                  // Each event as wide as it is long; one with a long name takes what it needs, so it never runs into the next.
                  style={{ gridTemplateColumns: events.map((e) => `minmax(${e.kind === 'hold' && !e.alt ? 0 : 'min-content'}, ${e.dur}fr)`).join(' ') }}
                >
                  {events.map((e, ei) => (
                    <EventView key={e.id} ev={e} style={chordStyle} wholeBar={wholeBar} sel={!!selected && selection!.from === selection!.to && selection!.ev === e.id} first={ei === 0} />
                  ))}
                  {beatGrid && selected && selection!.from === selection!.to && (
                    <span className="beats" aria-hidden>
                      {Array.from({ length: m.num - 1 }, (_, b) => (
                        <i key={b} className={(b + 1) % m.group === 0 ? 'strong' : ''} style={{ left: `${((b + 1) / m.num) * 100}%` }} />
                      ))}
                    </span>
                  )}
                </div>
                {bar.simile === 1 && <span className="smufl simile simile-center" title="Repeat the last bar">{SMUFL.repeat1}</span>}
                {bar.simile === 2 && <span className="smufl simile simile-two" title="Repeat the last two bars">{SMUFL.repeat2}</span>}
                {pins?.[bar.id] ? (
                  <button
                    className="pin"
                    title={`${pins[bar.id]} comment${pins[bar.id] === 1 ? '' : 's'}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPin?.(bar.id);
                    }}
                  >
                    {pins[bar.id]}
                  </button>
                ) : null}
                {people?.length ? <span className="who">{people.map((p) => p.name.split(' ')[0]).join(', ')}</span> : null}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export const ChartView = memo(ChartViewInner);
