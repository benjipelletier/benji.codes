'use client';

// A chord in the deck as a playing card (the owner: "a less detail actual card
// shape like a playing card shape"): the chord big, how many inversions it has
// ("×2", learned together), and its three modes as tabs on the top edge, each a
// symbol coloured by that mode's status (the owner: "B but not with the full
// name written out, let's make symbols for each"). The card's border and foot
// are its most urgent mode. Tap: the voicing's page. On Review's home and the
// Deck view.

import { chordDisplay, parseChordLabel, prettyLabel } from '@voiceshed/lib/theory';
import { MODES, MODE_LABEL, type Mode } from '@voiceshed/lib/types';
import type { SetCard } from '@voiceshed/lib/drill';

/** A mode's state on a card: in today's set (shaky, check, early check, new, joining later) or in the deck (solid). */
export type ModeState = 'shaky' | 'check' | 'early' | 'new' | 'later' | 'solid';
const URGENCY: ModeState[] = ['shaky', 'check', 'early', 'new', 'later', 'solid'];

export interface ChordCard {
  /** The chord's group without its mode: label, family, iii-ness (or a found voicing's id). */
  key: string;
  label: string;
  /** The voicing a tap opens. */
  first: string;
  /** Its inversions. */
  n: number;
  modes: Partial<Record<Mode, ModeState>>;
  /** The soonest check among its solid modes, ms. */
  at: number | null;
}

/** The most urgent of a card's modes. */
export const worstOf = (c: ChordCard): ModeState => URGENCY.find(s => Object.values(c.modes).includes(s)) ?? 'solid';

/** Cards (each a voicing in a mode, `group` per groupOf) folded into one per chord. */
export function chordCards(entries: { card: SetCard; state: ModeState; at?: number }[]): ChordCard[] {
  const out = new Map<string, ChordCard & { perMode: Map<Mode, number> }>();
  for (const { card, state, at } of entries) {
    const key = card.group.slice(0, card.group.lastIndexOf('|'));
    let c = out.get(key);
    if (!c) out.set(key, (c = { key, label: card.voicing.chord_label, first: card.voicing.id, n: 0, modes: {}, at: null, perMode: new Map() }));
    const k = (c.perMode.get(card.mode) ?? 0) + 1;
    c.perMode.set(card.mode, k);
    c.n = Math.max(c.n, k);
    const had = c.modes[card.mode];
    if (!had || URGENCY.indexOf(state) < URGENCY.indexOf(had)) c.modes[card.mode] = state;
    if (state === 'solid' && at != null) c.at = c.at == null ? at : Math.min(c.at, at);
  }
  return [...out.values()].map(({ perMode: _p, ...c }) => c);
}

const STATE_WORD: Record<ModeState, string> = { shaky: 'shaky', check: 'check', early: 'early check', new: 'new', later: 'later', solid: 'solid' };

/** A mode's symbol: Play a keyboard, Spell a note, Name a name tag. */
export function ModeIcon({ mode }: { mode: Mode }) {
  return (
    <svg viewBox="0 0 16 16" className="mi" aria-hidden>
      {mode === 'play' ? (
        <>
          <rect x="1.5" y="3" width="13" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M5.8 3v10M10.2 3v10" stroke="currentColor" strokeWidth="1.1" />
          <rect x="4.6" y="3" width="2.4" height="5.6" fill="currentColor" />
          <rect x="9" y="3" width="2.4" height="5.6" fill="currentColor" />
        </>
      ) : mode === 'spell' ? (
        <>
          <ellipse cx="6" cy="11.6" rx="3" ry="2.2" transform="rotate(-20 6 11.6)" fill="currentColor" />
          <path d="M8.7 11V2.2c1.6.9 3.6 1.6 4.4 3.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </>
      ) : (
        <>
          <path d="M2 4.2v3.6l6.6 6.6 5.6-5.6L7.6 2.2H4a2 2 0 0 0-2 2Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          <circle cx="5.2" cy="5.4" r="1.3" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

export function PlayingCard({ c, foot, onOpen }: { c: ChordCard; foot?: string; onOpen: (id: string) => void }) {
  const p = parseChordLabel(c.label);
  const d = p ? chordDisplay(p.rootName, p.quality) : { root: c.label, quality: '' };
  const worst = worstOf(c);
  const said = MODES.filter(m => c.modes[m]).map(m => `${MODE_LABEL[m]} ${STATE_WORD[c.modes[m]!]}`).join(', ');
  return (
    <li className={`rv-pc rv-pc-${worst}`}>
      {/* Tap: the voicing's own page (the owner: "clicking the card in review to open its card page"). */}
      <button type="button" className="rv-pc-open" onClick={() => onOpen(c.first)} aria-label={`${prettyLabel(c.label)}: ${said}${c.n > 1 ? `; ${c.n} inversions` : ''} — open`} />
      <span className="rv-pc-tabs" aria-hidden>
        {MODES.map(m => (
          <span key={m} className={`rv-pc-tab rv-tab-${c.modes[m] ?? 'none'}`}>
            <ModeIcon mode={m} />
          </span>
        ))}
      </span>
      <span className="rv-pc-face" aria-hidden>
        <span className="rv-pc-chord">
          {d.root}
          <small>{d.quality}</small>
        </span>
        <span className="rv-pc-foot">
          {/* Its inversions, learned together: a count, not a stack (the owner: "I actually don't like the stacking, it's too confusing"). */}
          {c.n > 1 && <span className="rv-pc-inv">×{c.n}</span>}
          {foot ?? STATE_WORD[worst]}
        </span>
      </span>
    </li>
  );
}

/** The legend's key for the mode symbols. */
export function ModeKey() {
  return (
    <>
      {MODES.map(m => (
        <span key={m} className="rv-mk">
          <ModeIcon mode={m} /> {MODE_LABEL[m]}
        </span>
      ))}
    </>
  );
}
