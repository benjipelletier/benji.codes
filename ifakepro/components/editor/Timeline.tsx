'use client';

// One bar as a timeline: its events side by side, each as wide as it is
// long. Tap one to select it. In rhythm mode it gets a beat ruler, handles on
// the boundaries between events (drag them, or focus one and use the arrow
// keys; they snap to the grid), and + marks on the grid lines inside the
// selected event to start a new event there.

import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import type { Bar, Ev, Meter } from '@ifakepro/lib/chart';
import type { ChordStyle } from '@ifakepro/lib/chords';
import { Chord } from '../ChartView';

const KIND_LABEL: Record<Ev['kind'], string> = { chord: '', hit: '', rest: 'Rest', nc: 'N.C.', hold: 'no change', slash: 'slash' };

export function beatsLabel(ticks: number, m: Meter): string {
  const b = ticks / m.beat;
  const unit = m.den === 8 ? 'eighth' : 'beat';
  const frac: Record<string, string> = { '0.25': '¼', '0.5': '½', '0.75': '¾', '0.333': '⅓', '0.667': '⅔', '0.167': '⅙' };
  const whole = Math.floor(b + 1e-9);
  const rest = +(b - whole).toFixed(3);
  const f = rest ? frac[String(rest)] ?? `.${String(rest).slice(2)}` : '';
  const n = `${whole || !f ? whole : ''}${f}`;
  return `${n} ${unit}${b === 1 ? '' : 's'}`;
}

/** "beat 3", "beat 2 + ½" — where a tick falls in the bar. */
export function positionLabel(tick: number, m: Meter): string {
  const b = Math.floor(tick / m.beat);
  const off = tick - b * m.beat;
  if (!off) return `beat ${b + 1}`;
  const frac = off / m.beat;
  const name: Record<string, string> = { '0.5': '½', '0.25': '¼', '0.75': '¾', '0.333': '⅓', '0.667': '⅔' };
  return `beat ${b + 1} + ${name[String(+frac.toFixed(3))] ?? `${off}/${m.beat}`}`;
}

export function Timeline({
  bar, m, selected, onSelect, rhythm, step, onMoveBoundary, onInsertAt, chordStyle,
}: {
  bar: Bar;
  m: Meter;
  selected: string | null;
  onSelect: (id: string) => void;
  rhythm: boolean;
  /** Grid step in ticks. */
  step: number;
  onMoveBoundary: (b: number, tick: number) => void;
  onInsertAt: (tick: number) => void;
  chordStyle: ChordStyle;
}) {
  const track = useRef<HTMLDivElement>(null);
  const pct = (t: number) => `${(t / m.length) * 100}%`;
  const sel = bar.events.find((e) => e.id === selected) ?? null;

  const tickAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.round((((clientX - r.left) / r.width) * m.length) / step) * step;
  };
  const drag = (b: number) => ({
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: PointerEvent<HTMLButtonElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      onMoveBoundary(b, tickAt(e.clientX));
    },
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      e.stopPropagation();
      onMoveBoundary(b, bar.events[b].at + (e.key === 'ArrowRight' ? step : -step));
    },
  });

  const grid: number[] = [];
  for (let t = step; t < m.length; t += step) grid.push(t);

  return (
    <div className={`tl ${rhythm ? 'tl-rhythm' : ''}`}>
      {rhythm && (
        <div className="tl-ruler" aria-hidden>
          {Array.from({ length: m.num }, (_, b) => (
            <span key={b} className={`tl-beat ${b % m.group === 0 ? 'strong' : ''}`} style={{ left: pct(b * m.beat) }}>
              {b + 1}
            </span>
          ))}
          {grid.filter((t) => t % m.beat).map((t) => (
            <i key={t} className="tl-sub" style={{ left: pct(t) }} />
          ))}
        </div>
      )}
      <div className="tl-track" ref={track}>
        {rhythm &&
          Array.from({ length: m.num - 1 }, (_, b) => <i key={b} className="tl-beatline" style={{ left: pct((b + 1) * m.beat) }} aria-hidden />)}
        {bar.events.map((e) => (
          <button
            key={e.id}
            className={`tl-ev tl-${e.kind} ${e.id === selected ? 'on' : ''}`}
            style={{ left: pct(e.at), width: pct(e.dur) }}
            onClick={() => onSelect(e.id)}
            aria-pressed={e.id === selected}
            aria-label={`${e.ch ?? KIND_LABEL[e.kind]}, ${positionLabel(e.at, m)}, ${beatsLabel(e.dur, m)}`}
          >
            <span className="tl-label">
              {e.ch ? <Chord ch={e.ch} style={chordStyle} /> : KIND_LABEL[e.kind]}
              {e.kind === 'hit' && <span className="tl-hit">›</span>}
            </span>
            {rhythm && <span className="tl-dur">{beatsLabel(e.dur, m)}</span>}
          </button>
        ))}
        {rhythm &&
          bar.events.slice(1).map((e, k) => (
            <button
              key={`h${e.id}`}
              className="tl-handle"
              style={{ left: pct(e.at) }}
              role="slider"
              aria-label={`Boundary before ${e.ch ?? KIND_LABEL[e.kind]}`}
              aria-valuemin={0}
              aria-valuemax={m.length}
              aria-valuenow={e.at}
              aria-valuetext={positionLabel(e.at, m)}
              {...drag(k + 1)}
            >
              <span />
            </button>
          ))}
      </div>
      {rhythm && sel && (
        <div className="tl-adds">
          {grid
            .filter((t) => t > sel.at && t < sel.at + sel.dur)
            .map((t) => (
              <button key={t} className="tl-add" style={{ left: pct(t) }} onClick={() => onInsertAt(t)} aria-label={`New event at ${positionLabel(t, m)}`}>
                +
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
