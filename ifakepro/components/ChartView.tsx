'use client';

// Draws a chart the way iReal Pro and the Real Book do: rows of 16 cells,
// barlines with repeats and endings, boxed section letters, chords with
// raised extensions. Sizes scale with the chart's width (container units),
// so the same chart reads on a phone and fills a laptop.

import { memo, type MouseEvent as RMouseEvent } from 'react';
import { type Bar, type Cell, type Chart, cellText, layout, sectionLabel, timeAt } from '@ifakepro/lib/chart';
import { type ChordStyle, chordParts, transposeCells } from '@ifakepro/lib/chords';

export interface Selection {
  from: number;
  to: number;
  cell: number | null;
}

export interface ChartViewProps {
  chart: Chart;
  /** Semitones to transpose the display by. */
  shift?: number;
  flats?: boolean;
  chordStyle?: ChordStyle;
  selection?: Selection | null;
  /** A click or tap on a bar, with the cell under it. */
  onBarClick?: (index: number, cell: number, e: RMouseEvent) => void;
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

/** A note name with its accidental set small and raised, the way fake books print it. */
function Note({ name }: { name: string }) {
  return (
    <>
      {name[0]}
      {name.length > 1 && <span className="acc">{name.slice(1)}</span>}
    </>
  );
}

function withAcc(text: string) {
  return text.split(/([♭♯])/).map((t, i) => (t === '♭' || t === '♯' ? <span key={i} className="acc">{t}</span> : t));
}

export function Chord({ ch, style = 'jazz' }: { ch: string; style?: ChordStyle }) {
  const p = chordParts(ch, style);
  return (
    <span className="ch">
      {p.root && (
        <span className="ch-root">
          <Note name={p.root} />
        </span>
      )}
      {p.quality && <span className="ch-q">{withAcc(p.quality)}</span>}
      {p.bass && (
        <span className="ch-bass">
          /<Note name={p.bass} />
        </span>
      )}
    </span>
  );
}

function CellView({ cell, style, alone, cursor }: { cell: Cell; style: ChordStyle; alone: boolean; cursor: boolean }) {
  const marks = (
    <>
      {(cell.segno || cell.coda || cell.fermata || cell.text) && (
        <span className="cell-marks">
          {cell.segno && <span className="sym" title="Segno">𝄋</span>}
          {cell.coda && <span className="sym" title="Coda">𝄌</span>}
          {cell.fermata && <span className="sym" title="Fermata">𝄐</span>}
          {cell.text && <span className="cell-text">{cellText(cell.text)}</span>}
        </span>
      )}
      {cell.alt && (
        <span className="cell-alt">
          {cell.alt.split(/\s+/).map((a, i) => (/^[A-GW]/.test(a) ? <Chord key={i} ch={a} style={style} /> : <span key={i}>{a}</span>))}
        </span>
      )}
    </>
  );
  let body = null;
  if (cell.ch) body = <Chord ch={cell.ch} style={style} />;
  else if (cell.sym === 'x') body = <span className={`simile ${alone ? 'simile-center' : ''}`} title="Repeat the last bar">𝄎</span>;
  else if (cell.sym === 'r') body = <span className="simile simile-two" title="Repeat the last two bars">𝄏</span>;
  else if (cell.sym === 'p') body = <span className="slash">/</span>;
  else if (cell.sym === 'n') body = <span className="nc">N.C.</span>;
  return (
    <span className={`cell ${cell.small ? 'cell-small' : ''}`}>
      {cursor && <span className="cell-cursor" aria-hidden />}
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
  const { chart, shift = 0, flats = true, chordStyle = 'jazz', selection, onBarClick, presence, pins, onPin, changed, flash, barNumbers, className } = props;
  const rows = layout(chart);
  const times = timeAt(chart);
  const ends = endings(chart.bars);
  return (
    <div className={`chart ${className ?? ''}`}>
      {rows.map((row, ri) => (
        <div key={ri} className="chart-row" style={row.vspace ? { marginTop: `${row.vspace * 0.9}em` } : undefined}>
          {row.items.map((it, k) => {
            if (it.kind === 'spacer') return <div key={`s${k}`} className="spacer" style={{ gridColumn: `span ${it.span}` }} />;
            const { bar, index } = it;
            const prevItem = row.items[k - 1];
            const prevBar = prevItem?.kind === 'bar' ? prevItem.bar : null;
            const isRowEnd = k === row.items.length - 1;
            const showTime = bar.time && (index === 0 || times[index - 1] !== bar.time);
            const cells = transposeCells(bar.cells, shift, flats);
            const filled = cells.filter((c) => c.ch || c.sym);
            const selected = selection && index >= selection.from && index <= selection.to;
            const people = presence?.[bar.id];
            const ending = ends[index];
            const cls = [
              'bar',
              bar.open === '[' ? 'open-dbl' : bar.open === '{' ? 'open-rep' : prevBar?.close ? 'open-none' : '',
              bar.close === ']' ? 'close-dbl' : bar.close === '}' ? 'close-rep' : bar.close === 'Z' ? 'close-fin' : '',
              isRowEnd && !bar.close ? 'row-end' : '',
              showTime ? 'has-time' : '',
              filled.length >= 3 ? 'dense' : '',
              selected ? 'sel' : '',
              changed?.has(bar.id) ? 'changed' : '',
              flash?.has(bar.id) ? 'flash' : '',
              people?.length ? 'present' : '',
              ending != null ? 'in-ending' : '',
              typeof ending === 'number' ? 'ending-start' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <div
                key={bar.id}
                className={cls}
                data-bar={index}
                style={{ gridColumn: `span ${it.span}`, gridTemplateColumns: `repeat(${Math.max(1, cells.length)}, minmax(0, 1fr))`, ...(people?.length ? { ['--who' as string]: people[0].color } : {}) }}
                onClick={
                  onBarClick
                    ? (e) => {
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const cell = Math.max(0, Math.min(cells.length - 1, Math.floor(((e.clientX - r.left) / r.width) * cells.length)));
                        onBarClick(index, cell, e);
                      }
                    : undefined
                }
              >
                {bar.section && <span className="section">{sectionLabel(bar.section)}</span>}
                {typeof ending === 'number' && <span className="ending">{ending ? `${ending}.` : ''}</span>}
                {showTime && (
                  <span className="ts" aria-label={`time ${bar.time}`}>
                    <b>{bar.time!.split('/')[0]}</b>
                    <b>{bar.time!.split('/')[1]}</b>
                  </span>
                )}
                {(bar.open === '[' || bar.open === '{') && <i className="bl bl-open" aria-hidden />}
                {bar.open === '{' && <i className="dots dots-open" aria-hidden />}
                {bar.close && <i className="bl bl-close" aria-hidden />}
                {bar.close === '}' && <i className="dots dots-close" aria-hidden />}
                {barNumbers && !bar.section && <span className="bar-no">{index + 1}</span>}
                {cells.map((c, ci) => (
                  <CellView
                    key={ci}
                    cell={c}
                    style={chordStyle}
                    alone={filled.length === 1 && c.sym === 'x'}
                    cursor={!!selected && selection!.from === selection!.to && selection!.cell === ci}
                  />
                ))}
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
