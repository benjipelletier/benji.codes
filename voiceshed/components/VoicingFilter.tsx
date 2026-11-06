'use client';

// The Voicings page's filter: three rows you scroll sideways and tap to
// stack — key (round the cycle of fourths), chord type, and voicing type
// (each shown with a little keyboard of what it looks like). Taps within a
// row widen the search (F or B♭); rows narrow each other (F and m7 and
// drop-2). Every chip shows how many voicings it would leave, given the
// other rows, and a chip that would leave none fades out. What's picked sits
// in a bar that stays at the top as you scroll, one tap to drop any of it;
// the address keeps it too, so a reload or the back button lands on the
// same view.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Keyboard, rangeAround } from './Keyboard';
import { midisOf } from '@voiceshed/lib/practice';
import { CYCLE_OF_FOURTHS, keyLabel, namePc, PC_FLAT, pretty, QUALITIES, QUALITY, rootNames, type Quality, prettyLabel } from '@voiceshed/lib/theory';
import type { Voicing } from '@voiceshed/lib/types';

export type Flag = 'muddy' | 'gap' | 'new';

export interface FilterState {
  keys: number[];
  qualities: Quality[];
  families: string[];
  flags: Flag[];
  q: string;
}

export const EMPTY_FILTER: FilterState = { keys: [], qualities: [], families: [], flags: [], q: '' };

const FLAG_LABEL: Record<Flag, string> = { muddy: 'muddy', gap: 'context gap', new: 'not learned yet' };

type Facet = 'keys' | 'qualities' | 'families' | 'flags' | 'q';

export interface FilterTests {
  /** Context gap in any mode. */
  gap: (v: Voicing) => boolean;
  /** Learned in every mode. */
  learned: (v: Voicing) => boolean;
}

function matches(v: Voicing, f: FilterState, t: FilterTests, skip?: Facet): boolean {
  if (skip !== 'keys' && f.keys.length && !f.keys.includes(v.root)) return false;
  if (skip !== 'qualities' && f.qualities.length && !f.qualities.includes(v.quality)) return false;
  if (skip !== 'families' && f.families.length && !f.families.includes(v.family)) return false;
  if (skip !== 'flags') {
    for (const fl of f.flags) {
      if (fl === 'muddy' && !v.tags.includes('muddy')) return false;
      if (fl === 'gap' && !t.gap(v)) return false;
      if (fl === 'new' && t.learned(v)) return false;
    }
  }
  if (skip !== 'q' && f.q.trim()) {
    const s = f.q.trim().toLowerCase().replace(/♭/g, 'b').replace(/♯/g, '#');
    const hay = `${v.chord_label} ${v.family} ${v.tags.join(' ')} ${v.notes.join(' ')} ${v.notes_text ?? ''}`.toLowerCase();
    if (!s.split(/\s+/).every(w => hay.includes(w))) return false;
  }
  return true;
}

export function applyFilter(voicings: Voicing[], f: FilterState, t: FilterTests): Voicing[] {
  return voicings.filter(v => matches(v, f, t));
}

// ── the address ─────────────────────────────────────────────────────────

function readUrl(): FilterState {
  if (typeof window === 'undefined') return EMPTY_FILTER;
  const p = new URLSearchParams(window.location.search);
  const list = (k: string) => (p.get(k) ?? '').split(',').map(x => x.trim()).filter(Boolean);
  return {
    keys: list('key').map(namePc).filter((x): x is number => x != null),
    qualities: list('chord').filter((x): x is Quality => x in QUALITY),
    families: list('type'),
    flags: list('only').filter((x): x is Flag => x in FLAG_LABEL),
    q: p.get('q') ?? '',
  };
}

function writeUrl(f: FilterState) {
  const p = new URLSearchParams();
  if (f.keys.length) p.set('key', f.keys.map(k => PC_FLAT[k]).join(','));
  if (f.qualities.length) p.set('chord', f.qualities.join(','));
  if (f.families.length) p.set('type', f.families.join(','));
  if (f.flags.length) p.set('only', f.flags.join(','));
  if (f.q.trim()) p.set('q', f.q.trim());
  const qs = p.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
}

/** The filter, kept in the address: read once on load, written with each change. */
export function useFilterState(): [FilterState, (f: FilterState) => void] {
  const [f, setF] = useState<FilterState>(EMPTY_FILTER);
  useEffect(() => setF(readUrl()), []);
  const set = useCallback((next: FilterState) => {
    setF(next);
    writeUrl(next);
  }, []);
  return [f, set];
}

// ── the component ───────────────────────────────────────────────────────

const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter(y => y !== x) : [...xs, x]);

/** A chip whose count would be zero is faded but stays tappable when it's already picked. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="vf-row">
      <span className="vf-row-lbl">{label}</span>
      <div className="vf-scroll">{children}</div>
    </div>
  );
}

export function VoicingFilter({
  voicings,
  value,
  onChange,
  tests,
  total,
  shown,
}: {
  voicings: Voicing[];
  value: FilterState;
  onChange: (f: FilterState) => void;
  tests: FilterTests;
  total: number;
  shown: number;
}) {
  const f = value;
  const set = (p: Partial<FilterState>) => onChange({ ...f, ...p });

  // What each chip would leave, given every other row.
  const counts = useMemo(() => {
    const keyN = new Map<number, number>();
    const qualN = new Map<Quality, number>();
    const famN = new Map<string, number>();
    const flagN = new Map<Flag, number>();
    for (const v of voicings) {
      if (matches(v, f, tests, 'keys')) keyN.set(v.root, (keyN.get(v.root) ?? 0) + 1);
      if (matches(v, f, tests, 'qualities')) qualN.set(v.quality, (qualN.get(v.quality) ?? 0) + 1);
      if (matches(v, f, tests, 'families')) famN.set(v.family, (famN.get(v.family) ?? 0) + 1);
      if (matches(v, f, tests, 'flags')) {
        if (v.tags.includes('muddy')) flagN.set('muddy', (flagN.get('muddy') ?? 0) + 1);
        if (tests.gap(v)) flagN.set('gap', (flagN.get('gap') ?? 0) + 1);
        if (!tests.learned(v)) flagN.set('new', (flagN.get('new') ?? 0) + 1);
      }
    }
    return { keyN, qualN, famN, flagN };
  }, [voicings, f, tests]);

  const qualities = useMemo(() => QUALITIES.map(q => q.id).filter(id => voicings.some(v => v.quality === id)), [voicings]);
  const families = useMemo(() => {
    const order = new Map<string, number>();
    for (const v of voicings) if (!order.has(v.family) || v.sort_order < order.get(v.family)!) order.set(v.family, v.sort_order);
    return [...order].sort((a, b) => a[1] - b[1]).map(([fam]) => fam);
  }, [voicings]);

  // Each voicing type drawn as one of its voicings: the first that fits the other rows, else the first of all.
  const sample = useMemo(() => {
    const out = new Map<string, Voicing>();
    for (const fam of families) {
      const pool = voicings.filter(v => v.family === fam);
      out.set(fam, pool.find(v => matches(v, f, tests, 'families')) ?? pool[0]);
    }
    return out;
  }, [voicings, families, f, tests]);

  const tokens: { key: string; label: string; drop: () => void }[] = [
    ...f.keys.map(k => ({ key: `k${k}`, label: keyLabel(k), drop: () => set({ keys: f.keys.filter(x => x !== k) }) })),
    ...f.qualities.map(q => ({ key: `q${q}`, label: QUALITY[q].display, drop: () => set({ qualities: f.qualities.filter(x => x !== q) }) })),
    ...f.families.map(fam => ({ key: `f${fam}`, label: fam, drop: () => set({ families: f.families.filter(x => x !== fam) }) })),
    ...f.flags.map(fl => ({ key: `x${fl}`, label: FLAG_LABEL[fl], drop: () => set({ flags: f.flags.filter(x => x !== fl) }) })),
    ...(f.q.trim() ? [{ key: 'q', label: `“${f.q.trim()}”`, drop: () => set({ q: '' }) }] : []),
  ];

  return (
    <>
      <div className="vf-bar" role="status" aria-live="polite">
        <div className="vf-tokens">
          {tokens.length ? (
            tokens.map(t => (
              <button type="button" key={t.key} className="vf-token" onClick={t.drop} aria-label={`remove ${t.label}`}>
                {t.label} <span aria-hidden="true">×</span>
              </button>
            ))
          ) : (
            <span className="vf-all">All voicings</span>
          )}
        </div>
        <span className="vf-count">
          <b>{shown}</b>
          {shown !== total ? ` / ${total}` : ''}
        </span>
        {tokens.length > 0 && (
          <button type="button" className="vf-clear" onClick={() => onChange(EMPTY_FILTER)}>
            Clear
          </button>
        )}
      </div>

      <section className="vf" aria-label="Filter voicings">
        <Row label="Key">
          {CYCLE_OF_FOURTHS.map(k => {
            const n = counts.keyN.get(k) ?? 0;
            const on = f.keys.includes(k);
            return (
              <button type="button" key={k} className={`vf-key ${on ? 'on' : ''} ${!n && !on ? 'none' : ''}`} aria-pressed={on} onClick={() => set({ keys: toggle(f.keys, k) })}>
                <span className="vf-key-name">
                  {rootNames(k).map(n => (
                    <span key={n}>{pretty(n)}</span>
                  ))}
                </span>
                <span className="vf-n">{n}</span>
              </button>
            );
          })}
        </Row>

        <Row label="Chord">
          {qualities.map(q => {
            const n = counts.qualN.get(q) ?? 0;
            const on = f.qualities.includes(q);
            return (
              <button type="button" key={q} className={`vf-qual ${on ? 'on' : ''} ${!n && !on ? 'none' : ''}`} aria-pressed={on} onClick={() => set({ qualities: toggle(f.qualities, q) })}>
                <span className="vf-qual-name">{QUALITY[q].display}</span>
                <span className="vf-n">{n}</span>
              </button>
            );
          })}
        </Row>

        <Row label="Voicing">
          {families.map(fam => {
            const n = counts.famN.get(fam) ?? 0;
            const on = f.families.includes(fam);
            const s = sample.get(fam);
            const m = s ? midisOf(s) : [];
            const [lo, hi] = rangeAround(m, 9);
            return (
              <button type="button" key={fam} className={`vf-fam ${on ? 'on' : ''} ${!n && !on ? 'none' : ''}`} aria-pressed={on} onClick={() => set({ families: toggle(f.families, fam) })}>
                <span className="vf-fam-kb" aria-hidden="true">
                  <Keyboard compact low={lo} high={hi} marks={Object.fromEntries(m.map(x => [x, 'on']))} />
                </span>
                <span className="vf-fam-name">{fam}</span>
                <span className="vf-n">
                  {n} {s ? <em>e.g. {prettyLabel(s.chord_label)}</em> : null}
                </span>
              </button>
            );
          })}
        </Row>

        <Row label="Only">
          {(Object.keys(FLAG_LABEL) as Flag[]).map(fl => {
            const n = counts.flagN.get(fl) ?? 0;
            const on = f.flags.includes(fl);
            return (
              <button type="button" key={fl} className={`vf-flag ${on ? 'on' : ''} ${!n && !on ? 'none' : ''}`} aria-pressed={on} onClick={() => set({ flags: toggle(f.flags, fl) })}>
                {FLAG_LABEL[fl]} <span className="vf-n">{n}</span>
              </button>
            );
          })}
        </Row>

        <input className="vt-input vf-search" type="search" placeholder="Search notes, tags…" value={f.q} onChange={e => set({ q: e.target.value })} />
      </section>
    </>
  );
}
