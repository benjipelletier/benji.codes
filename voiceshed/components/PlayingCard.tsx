'use client';

// A deck group as a playing card (the owner: "a less detail actual card shape
// like a playing card shape"): the chord big, the mode in the corner, the
// status at the foot and in the border, the group's other inversions fanned
// behind it. Tap: the voicing's page. On Review's home and the Deck view.

import { chordDisplay, parseChordLabel, prettyLabel } from '@voiceshed/lib/theory';
import { MODE_LABEL, type Mode } from '@voiceshed/lib/types';
import type { SetCard } from '@voiceshed/lib/drill';

/** A group as a playing card: the chord big, the mode in the corners, its inversions as the cards stacked behind. */
export function PlayingCard({ g, status, label, onOpen }: { g: Chip; status: string; label: string; onOpen: (id: string) => void }) {
  const p = parseChordLabel(g.label);
  const d = p ? chordDisplay(p.rootName, p.quality) : { root: g.label, quality: '' };
  const corner = MODE_LABEL[g.mode];
  return (
    <li className={`rv-pc rv-pc-${status}`}>
      {/* Tap: the voicing's own page (the owner: "clicking the card in review to open its card page"). */}
      <button type="button" className="rv-pc-open" onClick={() => onOpen(g.first)} aria-label={`${prettyLabel(g.label)}, ${corner}, ${label}${g.n > 1 ? `, ${g.n} inversions` : ''} — open`} />
      {Array.from({ length: Math.min(3, g.n - 1) }, (_, i) => (
        <span key={i} className="rv-pc-back" style={{ ['--i' as string]: i + 1 }} aria-hidden />
      ))}
      <span className="rv-pc-face" aria-hidden>
        <span className="rv-pc-corner">{corner}</span>
        <span className="rv-pc-chord">
          {d.root}
          <small>{d.quality}</small>
        </span>
        <span className="rv-pc-foot">{label}</span>
      </span>
    </li>
  );
}

export type Chip = { group: string; label: string; mode: Mode; why: SetCard['why']; n: number; first: string };

/** A set's cards as one chip per group (a chord's inversions in one mode). */
export function chips(cards: SetCard[]): Chip[] {
  const out = new Map<string, Chip>();
  for (const c of cards) {
    const e = out.get(c.group);
    if (e) e.n++;
    else out.set(c.group, { group: c.group, label: c.voicing.chord_label, mode: c.mode, why: c.why, n: 1, first: c.voicing.id });
  }
  return [...out.values()];
}

