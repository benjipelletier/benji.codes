'use client';

// What a review session deals: which answer modes, chord types, voicing
// types, keys and spellings, which cards (due, new, and ahead of schedule),
// and how many. Rows to scroll sideways and tap, like the Voicings filter;
// an empty row means all of it. Each chip shows how many cards are due now
// with it, given the other rows. Remembered on this device.

import { useEffect, useMemo, useState } from 'react';
import { CYCLE_OF_FOURTHS, parseChordLabel, pretty, QUALITIES, QUALITY, rootNames, type Quality } from '@voiceshed/lib/theory';
import { MODES, MODE_LABEL, type Mode, type SrsState, type Voicing } from '@voiceshed/lib/types';

export type Spelling = 'both' | 'flats' | 'sharps';

export interface ReviewConfig {
  /** At least one. */
  modes: Mode[];
  /** Empty: all. */
  qualities: Quality[];
  families: string[];
  keys: number[];
  /** Black-key chords under which name. */
  spelling: Spelling;
  /** Cards due now (and context-gap ones), new cards, cards not due yet (soonest first). */
  include: { due: boolean; fresh: boolean; ahead: boolean };
  /** Most cards in the session; 0 = no limit. */
  length: number;
}

export const DEFAULT_REVIEW: ReviewConfig = {
  modes: [...MODES],
  qualities: [],
  families: [],
  keys: [],
  spelling: 'both',
  include: { due: true, fresh: true, ahead: false },
  length: 60,
};

const STORE = 'vs-review-config';

/** The session set-up, kept on this device. */
export function useReviewConfig(): [ReviewConfig, (c: ReviewConfig) => void] {
  const [c, setC] = useState<ReviewConfig>(DEFAULT_REVIEW);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<ReviewConfig>;
        setC({ ...DEFAULT_REVIEW, ...saved, include: { ...DEFAULT_REVIEW.include, ...saved.include }, modes: saved.modes?.length ? saved.modes : DEFAULT_REVIEW.modes });
      }
    } catch {
      // Not remembered: the default it is.
    }
  }, []);
  const set = (next: ReviewConfig) => {
    setC(next);
    try {
      localStorage.setItem(STORE, JSON.stringify(next));
    } catch {
      // Not remembered across visits; fine for this one.
    }
  };
  return [c, set];
}

type Facet = 'qualities' | 'families' | 'keys' | 'spelling';

/** Is this voicing in the session, leaving one row out (for that row's counts)? */
export function voicingIn(v: Voicing, c: ReviewConfig, skip?: Facet): boolean {
  if (skip !== 'qualities' && c.qualities.length && !c.qualities.includes(v.quality)) return false;
  if (skip !== 'families' && c.families.length && !c.families.includes(v.family)) return false;
  if (skip !== 'keys' && c.keys.length && !c.keys.includes(v.root)) return false;
  if (skip !== 'spelling' && c.spelling !== 'both') {
    const name = parseChordLabel(v.chord_label)?.rootName ?? '';
    if (c.spelling === 'flats' && name.includes('#')) return false;
    if (c.spelling === 'sharps' && name.includes('b')) return false;
  }
  return true;
}

const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter(y => y !== x) : [...xs, x]);

/** A one-line account of the set-up: "Play + Spell · m7, 7 · drop-2 two-hand · F, B♭". */
export function describe(c: ReviewConfig): string {
  const parts: string[] = [];
  parts.push(c.modes.length === MODES.length ? 'All modes' : c.modes.map(m => MODE_LABEL[m]).join(' + '));
  if (c.qualities.length) parts.push(c.qualities.map(q => QUALITY[q].display).join(', '));
  if (c.families.length) parts.push(c.families.join(', '));
  if (c.keys.length) parts.push(c.keys.map(k => rootNames(k).map(pretty).join('/')).join(', '));
  if (c.spelling !== 'both') parts.push(c.spelling === 'flats' ? 'flat names' : 'sharp names');
  return parts.join(' · ');
}

export function ReviewSetup({
  config,
  onChange,
  voicings,
  srs,
  due,
}: {
  config: ReviewConfig;
  onChange: (c: ReviewConfig) => void;
  voicings: Voicing[];
  srs: Map<string, SrsState>;
  /** Cards due now, all voicings and modes: what the chip counts count. */
  due: { voicing: Voicing; mode: Mode }[];
}) {
  const c = config;
  const set = (p: Partial<ReviewConfig>) => onChange({ ...c, ...p });
  void srs;

  const qualities = useMemo(() => QUALITIES.map(q => q.id).filter(id => voicings.some(v => v.quality === id)), [voicings]);
  const families = useMemo(() => {
    const order = new Map<string, number>();
    for (const v of voicings) if (!order.has(v.family) || v.sort_order < order.get(v.family)!) order.set(v.family, v.sort_order);
    return [...order].sort((a, b) => a[1] - b[1]).map(([f]) => f);
  }, [voicings]);

  // Due now with each chip, given the other rows.
  const counts = useMemo(() => {
    const mode = new Map<Mode, number>();
    const qual = new Map<Quality, number>();
    const fam = new Map<string, number>();
    const key = new Map<number, number>();
    const inc = (m: Map<unknown, number>, k: unknown) => m.set(k, (m.get(k) ?? 0) + 1);
    for (const d of due) {
      const inModes = c.modes.includes(d.mode);
      if (voicingIn(d.voicing, c)) inc(mode as Map<unknown, number>, d.mode);
      if (inModes && voicingIn(d.voicing, c, 'qualities')) inc(qual as Map<unknown, number>, d.voicing.quality);
      if (inModes && voicingIn(d.voicing, c, 'families')) inc(fam as Map<unknown, number>, d.voicing.family);
      if (inModes && voicingIn(d.voicing, c, 'keys')) inc(key as Map<unknown, number>, d.voicing.root);
    }
    return { mode, qual, fam, key };
  }, [due, c]);

  const chip = (on: boolean, n: number) => `${on ? 'on' : ''} ${!n && !on ? 'none' : ''}`;

  return (
    <section className="vt-panel rs" aria-label="This session">
      <div className="rs-head">
        <h3 className="vt-panel-title">This session</h3>
        <button type="button" className="vf-clear" onClick={() => onChange(DEFAULT_REVIEW)}>
          Reset
        </button>
      </div>

      <div className="vf-row">
        <span className="vf-row-lbl">Answer by</span>
        <div className="vf-scroll">
          {MODES.map(m => {
            const on = c.modes.includes(m);
            const n = counts.mode.get(m) ?? 0;
            return (
              <button
                type="button"
                key={m}
                className={`vf-qual rs-mode ${chip(on, n)}`}
                aria-pressed={on}
                // One mode always stays on.
                onClick={() => (on && c.modes.length === 1 ? undefined : set({ modes: MODES.filter(x => (x === m ? !on : c.modes.includes(x))) }))}
              >
                <span className="rs-mode-name">{MODE_LABEL[m]}</span>
                <span className="vf-n">{n} due</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="vf-row">
        <span className="vf-row-lbl">Chord {c.qualities.length ? '' : '· all'}</span>
        <div className="vf-scroll">
          {qualities.map(q => {
            const on = c.qualities.includes(q);
            const n = counts.qual.get(q) ?? 0;
            return (
              <button type="button" key={q} className={`vf-qual ${chip(on, n)}`} aria-pressed={on} onClick={() => set({ qualities: toggle(c.qualities, q) })}>
                <span className="vf-qual-name">{QUALITY[q].display}</span>
                <span className="vf-n">{n} due</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="vf-row">
        <span className="vf-row-lbl">Voicing {c.families.length ? '' : '· all'}</span>
        <div className="vf-scroll">
          {families.map(f => {
            const on = c.families.includes(f);
            const n = counts.fam.get(f) ?? 0;
            return (
              <button type="button" key={f} className={`vf-flag ${chip(on, n)}`} aria-pressed={on} onClick={() => set({ families: toggle(c.families, f) })}>
                {f} <span className="vf-n">{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="vf-row">
        <span className="vf-row-lbl">Key {c.keys.length ? '' : '· all'}</span>
        <div className="vf-scroll">
          {CYCLE_OF_FOURTHS.map(k => {
            const on = c.keys.includes(k);
            const n = counts.key.get(k) ?? 0;
            return (
              <button type="button" key={k} className={`vf-key ${chip(on, n)}`} aria-pressed={on} onClick={() => set({ keys: toggle(c.keys, k) })}>
                <span className="vf-key-name">
                  {rootNames(k).map(name => (
                    <span key={name}>{pretty(name)}</span>
                  ))}
                </span>
                <span className="vf-n">{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="vt-field">
        <span className="vf-row-lbl">Black-key chords named</span>
        <div className="vt-seg" role="radiogroup">
          {(
            [
              ['both', 'Both'],
              ['flats', 'With flats (D♭)'],
              ['sharps', 'With sharps (C♯)'],
            ] as [Spelling, string][]
          ).map(([s, label]) => (
            <button type="button" key={s} role="radio" aria-checked={c.spelling === s} className={c.spelling === s ? 'on' : ''} onClick={() => set({ spelling: s })}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="vt-field">
        <span className="vf-row-lbl">Cards</span>
        <div className="rs-include">
          {(
            [
              ['due', 'Due now', 'what the schedule says, and context-gap cards'],
              ['fresh', 'New', 'up to the day’s new-card limit'],
              ['ahead', 'Not due yet', 'soonest first: extra rounds before a flight'],
            ] as [keyof ReviewConfig['include'], string, string][]
          ).map(([k, label, hint]) => (
            <label key={k} className="vt-check rs-check">
              <input type="checkbox" checked={c.include[k]} onChange={e => set({ include: { ...c.include, [k]: e.target.checked } })} />
              <span>
                {label} <em>{hint}</em>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="vt-field">
        <span className="vf-row-lbl">Length</span>
        <div className="vt-seg" role="radiogroup">
          {[10, 20, 40, 60, 0].map(n => (
            <button type="button" key={n} role="radio" aria-checked={c.length === n} className={c.length === n ? 'on' : ''} onClick={() => set({ length: n })}>
              {n || 'All'}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
