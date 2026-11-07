'use client';

// What today's set draws from: which answer modes, chord types, voicing
// types, keys and spellings, how many cards a set drills, and whether new
// voicings come in. Rows to scroll sideways and tap, like the Voicings
// filter; an empty row means all of it. Each chip shows how many cards are
// waiting with it (shaky, due a check, new), given the other rows.
// Remembered on this device.

import { useEffect, useMemo, useState } from 'react';
import { CYCLE_OF_FOURTHS, parseChordLabel, pretty, QUALITIES, QUALITY, rootNames, type Quality } from '@voiceshed/lib/theory';
import { MODES, MODE_LABEL, type Mode, type SrsState, type Voicing } from '@voiceshed/lib/types';
import { FLUENT_STREAK, NEW_AT_ONCE, NEW_PER_SET } from '@voiceshed/lib/drill';

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
  /** Cards drilled at once (lib/drill.ts). */
  size: number;
  /** New cards (in the deck, never answered) roll into the set, NEW_AT_ONCE at a time (lib/drill.ts). */
  fresh: boolean;
}

export const SET_SIZES = [4, 6, 8, 10];

export const DEFAULT_REVIEW: ReviewConfig = {
  modes: [...MODES],
  qualities: [],
  families: [],
  keys: [],
  spelling: 'both',
  size: 6,
  fresh: true,
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
        setC({
          ...DEFAULT_REVIEW,
          ...saved,
          size: SET_SIZES.includes(saved.size ?? 0) ? saved.size! : DEFAULT_REVIEW.size,
          fresh: saved.fresh ?? DEFAULT_REVIEW.fresh,
          modes: saved.modes?.length ? saved.modes : DEFAULT_REVIEW.modes,
        });
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
  /** Cards waiting (shaky, due a check, new), all voicings and modes: what the chip counts count. */
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

  // Waiting with each chip, given the other rows.
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
                <span className="vf-n">{n} waiting</span>
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
                <span className="vf-n">{n}</span>
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
        <span className="vf-row-lbl">Cards in a set</span>
        <div className="vt-seg" role="radiogroup" aria-label="Cards in a set">
          {SET_SIZES.map(n => (
            <button type="button" key={n} role="radio" aria-checked={c.size === n} className={c.size === n ? 'on' : ''} onClick={() => set({ size: n })}>
              {n}
            </button>
          ))}
        </div>
        <span className="vt-hint">Drilled together until each is right and fast {FLUENT_STREAK} times in a row.</span>
      </div>

      <label className="vt-check rs-check">
        <input type="checkbox" checked={c.fresh} onChange={e => set({ fresh: e.target.checked })} />
        <span>
          New voicings <em>up to {NEW_PER_SET} a session, {NEW_AT_ONCE} at a time — the next joins once one is fast</em>
        </span>
      </label>
    </section>
  );
}
