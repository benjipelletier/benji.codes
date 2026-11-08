'use client';

// A deck group as a playing card (the owner: "a less detail actual card shape
// like a playing card shape"): the chord big, the mode in the corner, the
// status at the foot and in the border, the group's other inversions fanned
// behind it — each card behind in its own inversion's colour, and a swipe up
// or down on the card brings the next one to the front (the owner: "colour the
// cards behind and allow me to switch between them by swiping up or down").
// Tap: the front inversion's page. On Review's home and the Deck view.

import { useMemo, useRef, useState } from 'react';
import { useTrainer } from './TrainerProvider';
import { chordDisplay, parseChordLabel, prettyLabel } from '@voiceshed/lib/theory';
import { degreesOf } from '@voiceshed/lib/practice';
import { MODE_LABEL, srsKey, type Mode } from '@voiceshed/lib/types';
import { cardStatus, type SetCard } from '@voiceshed/lib/drill';

/** How far a finger moves, up or down, before it counts as a swipe. */
const SWIPE_PX = 18;
/** How long the front inversion's bottom tone shows at the foot after a swipe. */
const FLASH_MS = 1400;

/** A group as a playing card: the chord big, the mode in the corners, its inversions as the cards stacked behind. */
export function PlayingCard({ g, status, label, onOpen }: { g: Chip; status: string; label: string; onOpen: (id: string) => void }) {
  const p = parseChordLabel(g.label);
  const d = p ? chordDisplay(p.rootName, p.quality) : { root: g.label, quality: '' };
  const corner = MODE_LABEL[g.mode];
  const t = useTrainer();
  // Each inversion's own status (solid, shaky, new) and bottom tone.
  const invs = useMemo(() => {
    const byId = new Map(t.voicings.map(v => [v.id, v]));
    return g.ids.map(id => {
      const v = byId.get(id);
      return { id, bottom: v ? degreesOf(v)[0] : '', status: cardStatus(t.srs.get(srsKey(id, g.mode)), false) };
    });
  }, [g.ids, g.mode, t.voicings, t.srs]);
  const [front, setFront] = useState(0);
  const [flash, setFlash] = useState(false);
  /** Swipes so far, so each one replays the deal. */
  const [turns, setTurns] = useState(0);
  const n = invs.length;
  const order = Array.from({ length: n }, (_, i) => invs[(front + i) % n]);
  // Only when the inversions stand apart does each card take its own colour; else the group's look.
  const apart = new Set(invs.map(i => i.status)).size > 1;
  const own = (i: number) => (apart && order[i] ? `rv-pc-own-${order[i].status}` : '');

  const start = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const flashT = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The card just swiped away, flying off the way the finger went (the owner: "it doesn't look like anything changes"). */
  const [leaving, setLeaving] = useState<{ status: string; up: boolean; id: number } | null>(null);
  const turn = (by: number) => {
    if (n < 2) return;
    setLeaving({ status: order[0].status, up: by > 0, id: turns + 1 });
    setFront(f => (f + by + n) % n);
    setTurns(x => x + 1);
    setFlash(true);
    if (flashT.current) clearTimeout(flashT.current);
    flashT.current = setTimeout(() => setFlash(false), FLASH_MS);
  };

  return (
    <li className={`rv-pc rv-pc-${status} ${n > 1 ? 'rv-pc-swipe' : ''}`}>
      {/* Tap: the front inversion's own page (the owner: "clicking the card in review to open its card page"). */}
      <button
        type="button"
        className="rv-pc-open"
        onClick={() => {
          if (swiped.current) {
            swiped.current = false;
            return;
          }
          onOpen(order[0]?.id ?? g.first);
        }}
        onPointerDown={e => {
          start.current = { x: e.clientX, y: e.clientY };
          swiped.current = false;
        }}
        onPointerMove={e => {
          const s0 = start.current;
          if (!s0 || n < 2) return;
          const dy = e.clientY - s0.y;
          if (Math.abs(dy) >= SWIPE_PX && Math.abs(dy) > Math.abs(e.clientX - s0.x)) {
            turn(dy < 0 ? 1 : -1);
            start.current = null;
            swiped.current = true;
          }
        }}
        onPointerUp={() => (start.current = null)}
        onPointerCancel={() => (start.current = null)}
        onKeyDown={e => {
          if (n < 2 || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
          e.preventDefault();
          turn(e.key === 'ArrowUp' ? 1 : -1);
        }}
        aria-label={`${prettyLabel(g.label)}, ${corner}, ${label}${n > 1 ? `, ${n} inversions, showing ${order[0].bottom} on the bottom (${order[0].status}); swipe or arrow keys for the next` : ''} — open`}
      />
      {Array.from({ length: Math.min(3, n - 1) }, (_, i) => (
        <span key={i} className={`rv-pc-back ${own(i + 1)}`} style={{ ['--i' as string]: i + 1 }} aria-hidden />
      ))}
      <span key={turns} className={`rv-pc-face ${own(0)} ${turns ? 'rv-pc-dealt' : ''}`} aria-hidden>
        <span className="rv-pc-corner">{corner}</span>
        <span className="rv-pc-chord">
          {d.root}
          <small>{d.quality}</small>
        </span>
        {/* Which inversion is in front, as page dots. */}
        {n > 1 && (
          <span className="rv-pc-dots">
            {invs.map((x, i) => (
              <i key={x.id} className={i === front ? 'on' : ''} />
            ))}
          </span>
        )}
        <span className={`rv-pc-foot ${flash && n > 1 ? 'rv-pc-flash' : ''}`}>{flash && n > 1 ? `${order[0].bottom} bottom` : label}</span>
      </span>
      {leaving && (
        <span
          key={`leave-${leaving.id}`}
          className={`rv-pc-face rv-pc-leave ${leaving.up ? 'up' : 'down'} ${apart ? `rv-pc-own-${leaving.status}` : ''}`}
          onAnimationEnd={() => setLeaving(l => (l?.id === leaving.id ? null : l))}
          aria-hidden
        >
          <span className="rv-pc-corner">{corner}</span>
          <span className="rv-pc-chord">
            {d.root}
            <small>{d.quality}</small>
          </span>
          <span className="rv-pc-foot">{label}</span>
        </span>
      )}
    </li>
  );
}

export type Chip = { group: string; label: string; mode: Mode; why: SetCard['why']; n: number; first: string; ids: string[] };

/** A set's cards as one chip per group (a chord's inversions in one mode). */
export function chips(cards: SetCard[]): Chip[] {
  const out = new Map<string, Chip>();
  for (const c of cards) {
    const e = out.get(c.group);
    if (e) {
      e.n++;
      e.ids.push(c.voicing.id);
    } else out.set(c.group, { group: c.group, label: c.voicing.chord_label, mode: c.mode, why: c.why, n: 1, first: c.voicing.id, ids: [c.voicing.id] });
  }
  return [...out.values()];
}
