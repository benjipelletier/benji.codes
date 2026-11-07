'use client';

// An on-screen piano: renders a voicing and accepts taps. Keys answer on
// pointer-down, not click, so a tap counts the moment the finger lands —
// every attempt is timed.

import { memo, useMemo } from 'react';

/** on: held; right / wrong: answered; missed: the answer; move: where the top voice moves to; lift: the top about to move. */
export type KeyMark = 'on' | 'right' | 'wrong' | 'missed' | 'move' | 'lift';

const BLACK = new Set([1, 3, 6, 8, 10]);
const isBlack = (m: number) => BLACK.has(((m % 12) + 12) % 12);

const WW = 24; // white key width (viewBox units)
const BW = 14;
/** Key length to width, as drawn unless a keyboard asks otherwise (a real white key is 6.4). */
const DEFAULT_ASPECT = 100 / 24;

interface Props {
  low: number;
  high: number;
  marks?: Record<number, KeyMark>;
  /** Names written on keys (e.g. the voicing's spelled notes). */
  labels?: Record<number, string>;
  onKey?: (midi: number) => void;
  compact?: boolean;
  className?: string;
  /** White key length over width; black keys are 62% as long. */
  aspect?: number;
}

function KeyboardImpl({ low, high, marks = {}, labels = {}, onKey, compact = false, className = '', aspect = DEFAULT_ASPECT }: Props) {
  const WH = Math.round(WW * aspect);
  const BH = Math.round(WH * 0.62);
  const lo = isBlack(low) ? low - 1 : low;
  const hi = isBlack(high) ? high + 1 : high;
  const { whites, blacks, width } = useMemo(() => {
    const w: number[] = [];
    for (let m = lo; m <= hi; m++) if (!isBlack(m)) w.push(m);
    const b: { midi: number; x: number }[] = [];
    w.forEach((m, i) => {
      if (m + 1 <= hi && isBlack(m + 1)) b.push({ midi: m + 1, x: (i + 1) * WW - BW / 2 });
    });
    return { whites: w, blacks: b, width: w.length * WW };
  }, [lo, hi]);

  const down = (midi: number) => (e: React.PointerEvent) => {
    if (!onKey) return;
    e.preventDefault();
    onKey(midi);
  };
  const cls = (base: string, midi: number) => {
    const m = marks[midi];
    return m ? `${base} ${base}-${m}` : base;
  };

  return (
    <svg
      className={`vk ${onKey ? 'vk-play' : ''} ${compact ? 'vk-compact' : ''} ${className}`}
      viewBox={`0 0 ${width} ${WH}`}
      preserveAspectRatio="xMidYMin meet"
      role={onKey ? 'group' : 'img'}
      aria-label={onKey ? 'piano keyboard' : 'voicing on a keyboard'}
    >
      {whites.map((m, i) => (
        <g key={m} onPointerDown={down(m)} data-midi={m}>
          <rect className={cls('vk-w', m)} x={i * WW + 0.5} y={0.5} width={WW - 1} height={WH - 1} rx={2.5} />
          {labels[m] && !compact ? (
            <text className="vk-lbl vk-lbl-w" x={i * WW + WW / 2} y={WH - 9} textAnchor="middle">
              {labels[m]}
            </text>
          ) : m % 12 === 0 && !compact ? (
            <text className="vk-c" x={i * WW + WW / 2} y={WH - 8} textAnchor="middle">
              C{Math.floor(m / 12) - 1}
            </text>
          ) : null}
        </g>
      ))}
      {blacks.map(({ midi, x }) => (
        <g key={midi} onPointerDown={down(midi)} data-midi={midi}>
          <rect className={cls('vk-b', midi)} x={x} y={0.5} width={BW} height={BH} rx={2} />
          {labels[midi] && !compact && (
            <text className="vk-lbl vk-lbl-b" x={x + BW / 2} y={BH - 8} textAnchor="middle">
              {labels[midi]}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

export const Keyboard = memo(KeyboardImpl);

/** A range that shows `midis` with some room either side, from a C or an F. */
export function rangeAround(midis: number[], minWhites = 10): [number, number] {
  if (!midis.length) return [48, 72];
  let lo = Math.min(...midis) - 3;
  let hi = Math.max(...midis) + 3;
  while (lo % 12 !== 0 && lo % 12 !== 5) lo--;
  while (hi % 12 !== 4 && hi % 12 !== 11) hi++;
  const whites = () => {
    let n = 0;
    for (let m = lo; m <= hi; m++) if (!isBlack(m)) n++;
    return n;
  };
  while (whites() < minWhites) {
    lo -= 1;
    while (lo % 12 !== 0 && lo % 12 !== 5) lo--;
    if (whites() >= minWhites) break;
    hi += 1;
    while (hi % 12 !== 4 && hi % 12 !== 11) hi++;
  }
  return [lo, hi];
}
