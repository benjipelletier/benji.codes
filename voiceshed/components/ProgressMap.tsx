'use client';

// The progress map, phone first (the owner: "I can't scroll the map easily on
// mobile … see everything at a glance and easily move across it"): one chart
// per voicing type, keys down the side (round the cycle of fourths, a black
// key's two names in one row) and chords across, so a whole chart fits the
// screen's width — no scrolling inside it. Each key × chord is one tile of
// three stripes, Play, Spell, Name, each summing that chord's voicings there:
// not in the deck (dashed), new (outlined), learning (amber), learned (green,
// deeper the faster); a dot marks one due now. Tap a tile for its voicings
// (`onOpenCell`), to see them and add them to the deck. Above it, a circle of
// fifths shaded by how much of each key is known (tap a key to find its row),
// the totals, and the slowest cards.

import { Fragment, useEffect, useMemo, useState } from 'react';
import { CYCLE_OF_FOURTHS, LATER_FAMILIES, parseChordLabel, pretty, QUALITIES, QUALITY, rootNames, SHAPE_SETS, prettyLabel } from '@voiceshed/lib/theory';
import { targetFor, type ModeStats } from '@voiceshed/lib/srs';
import { MODES, MODE_LABEL, srsKey, type Mode, type Settings, type SrsState, type Voicing } from '@voiceshed/lib/types';
import { fmtSecs } from './TrainerShell';

type CardState = 'out' | 'new' | 'learning' | 'learned';

interface CardView {
  state: CardState;
  due: boolean;
  /** 0–1: accuracy while learning, speed against target once learned. */
  strength: number;
  avgMs: number | null;
}

function cardView(st: SrsState | undefined, s: ModeStats | undefined, target: number, now: number): CardView {
  if (!st) return { state: 'out', due: false, strength: 0, avgMs: null };
  const due = new Date(st.due_at).getTime() <= now;
  if (st.reps === 0) return { state: 'new', due, strength: 0, avgMs: null };
  if (!st.learned) return { state: 'learning', due, strength: s?.attempts ? s.correct / s.attempts : 0, avgMs: s?.avgMs ?? null };
  // Learned: at the target 0.5, twice as fast (or better) 1.
  const avg = s?.avgMs ?? target;
  return { state: 'learned', due, strength: Math.max(0.35, Math.min(1, 1 - (avg / target - 0.5))), avgMs: s?.avgMs ?? null };
}

/** Short chord names for the map's narrow columns. */
const SHORT: Partial<Record<Voicing['quality'], string>> = { maj7: 'Δ7', m7: 'm7', '7': '7', '7b9': '7♭9', '7alt': 'alt', dim7: '°7', '6': '6', m7b5: 'ø7' };

/** A chord's cards in one key, summed per mode: out if none is in the deck, learned if every one is, else learning or new. */
function sumCards(cards: CardView[]): CardView {
  const inDeck = cards.filter(c => c.state !== 'out');
  const due = cards.some(c => c.due);
  if (!inDeck.length) return { state: 'out', due: false, strength: 0, avgMs: null };
  if (inDeck.every(c => c.state === 'learned')) return { state: 'learned', due, strength: inDeck.reduce((s, c) => s + c.strength, 0) / inDeck.length, avgMs: null };
  if (inDeck.some(c => c.state === 'learned' || c.state === 'learning')) {
    const done = inDeck.filter(c => c.state === 'learned').length + inDeck.filter(c => c.state === 'learning').reduce((s, c) => s + c.strength * 0.5, 0);
    return { state: 'learning', due, strength: Math.max(0.25, done / inDeck.length), avgMs: null };
  }
  return { state: 'new', due, strength: 0, avgMs: null };
}
/** The two-hand types, grouped under one heading on the tabs. */
const TWO_HAND = ['drop-2 two-hand', 'closed (block)'];
const FAMILY_KEY = 'vt-map-family';

export function ProgressMap({
  voicings: all,
  srs,
  stats,
  settings,
  onOpen,
  onOpenCell,
  onChart,
}: {
  /** The voicings the filter leaves. */
  voicings: Voicing[];
  srs: Map<string, SrsState>;
  stats: Map<string, ModeStats>;
  settings: Settings;
  onOpen: (id: string) => void;
  /** A tile tapped: its voicings (both names of a black key), and a title for them. */
  onOpenCell: (ids: string[], title: string) => void;
  /** Told which voicing type's chart is showing, so the page's deck bar acts on it. */
  onChart?: (family: string | null) => void;
}) {
  const now = Date.now();
  /** A key tapped on the circle: its row, lit for a moment. */
  const [lit, setLit] = useState<number | null>(null);

  // One chart per voicing type, picked above the map and kept on the device.
  const families = useMemo(() => {
    const famOrder = SHAPE_SETS.map(s => s.family);
    const rank = (f: string) => (famOrder.includes(f) ? famOrder.indexOf(f) : famOrder.length);
    return [...new Set(all.map(v => v.family))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  }, [all]);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    try {
      setPicked(localStorage.getItem(FAMILY_KEY));
    } catch {
      // Not remembered: the first chart.
    }
  }, []);
  const pick = (f: string) => {
    setPicked(f);
    try {
      localStorage.setItem(FAMILY_KEY, f);
    } catch {
      // Not remembered: fine.
    }
  };
  const family = picked && families.includes(picked) ? picked : families[0];
  const voicings = useMemo(() => all.filter(v => v.family === family), [all, family]);
  useEffect(() => {
    onChart?.(family ?? null);
  }, [family, onChart]);
  // Each chart's tab: voicings known (all three modes learned) of those in the deck.
  const famTotals = useMemo(() => {
    const out = new Map<string, { known: number; deck: number; all: number }>();
    for (const v of all) {
      const t = out.get(v.family) ?? { known: 0, deck: 0, all: 0 };
      t.all++;
      const sts = MODES.map(m => srs.get(srsKey(v.id, m)));
      if (sts.some(Boolean)) t.deck++;
      if (sts.every(st => st?.learned)) t.known++;
      out.set(v.family, t);
    }
    return out;
  }, [all, srs]);

  const view = useMemo(() => {
    const out = new Map<string, CardView>();
    for (const v of voicings)
      for (const m of MODES) {
        const k = srsKey(v.id, m);
        out.set(k, cardView(srs.get(k), stats.get(k), targetFor(srs.get(k), m, settings), now));
      }
    return out;
  }, [voicings, srs, stats, settings, now]);

  // Rows: each chord of this voicing type the filter leaves (one family per chart).
  const rows = useMemo(() => {
    const famOrder = SHAPE_SETS.map(s => s.family);
    // Chords as a ii–V–I runs, then the rest.
    const qOrder = ['m7', '7', '7b9', 'dim7', '7alt', 'maj7', '6', 'm7b5', ...QUALITIES.map(q => q.id)];
    const seen = new Map<string, { family: string; quality: Voicing['quality']; iii: boolean }>();
    for (const v of voicings) seen.set(`${v.family}|${v.quality}|${v.tags.includes('iii')}`, { family: v.family, quality: v.quality, iii: v.tags.includes('iii') });
    const rank = (f: string) => (famOrder.includes(f) ? famOrder.indexOf(f) : famOrder.length);
    return [...seen.values()].sort((a, b) => rank(a.family) - rank(b.family) || a.family.localeCompare(b.family) || qOrder.indexOf(a.quality) - qOrder.indexOf(b.quality) || Number(a.iii) - Number(b.iii));
  }, [voicings]);
  const cols = useMemo(() => CYCLE_OF_FOURTHS.filter(k => voicings.some(v => v.root === k)), [voicings]);

  // Totals, over this chart's voicings.
  const totals = useMemo(() => {
    let deckV = 0;
    let known = 0;
    let partly = 0;
    const perMode: Record<Mode, { learned: number; deck: number }> = { play: { learned: 0, deck: 0 }, spell: { learned: 0, deck: 0 }, name: { learned: 0, deck: 0 } };
    const perKey = new Map<number, { learned: number; deck: number }>();
    for (const v of voicings) {
      const cards = MODES.map(m => view.get(srsKey(v.id, m))!);
      if (cards.every(c => c.state === 'out')) continue;
      deckV++;
      const learned = cards.filter(c => c.state === 'learned').length;
      if (learned === MODES.length) known++;
      else if (learned) partly++;
      MODES.forEach((m, i) => {
        if (cards[i].state === 'out') return;
        perMode[m].deck++;
        if (cards[i].state === 'learned') perMode[m].learned++;
        const pk = perKey.get(v.root) ?? { learned: 0, deck: 0 };
        pk.deck++;
        if (cards[i].state === 'learned') pk.learned++;
        perKey.set(v.root, pk);
      });
    }
    // Slowest in the deck: answered at least twice, by average time against target.
    const slow = voicings
      .flatMap(v => MODES.map(m => ({ v, m, s: stats.get(srsKey(v.id, m)), st: srs.get(srsKey(v.id, m)) })))
      .filter(x => x.st && x.s && x.s.correct >= 2 && x.s.avgMs != null)
      .map(x => ({ ...x, ratio: x.s!.avgMs! / targetFor(x.st, x.m, settings) }))
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, 5);
    return { deckV, known, partly, perMode, perKey, slow };
  }, [voicings, view, stats, srs, settings]);

  const goToKey = (k: number) => {
    document.querySelector(`[data-row="${k}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setLit(k);
    setTimeout(() => setLit(x => (x === k ? null : x)), 1600);
  };

  if (!all.length) return <p className="vt-empty">No voicings match.</p>;
  const tab = (f: string, label: string) => {
    const t = famTotals.get(f);
    return (
      <button type="button" key={f} role="tab" aria-selected={f === family} className={f === family ? 'on' : ''} onClick={() => pick(f)}>
        <b>{label}</b>
        <span>{t?.deck ? `${t.known}/${t.deck} known` : `${t?.all ?? 0} voicings`}</span>
      </button>
    );
  };

  return (
    <div className="pm">
      <div className="pm-tabs" role="tablist" aria-label="Voicing type">
        {/* Two-hand first, its types under it (the owner: "under two hand we have drop twos … and then
            block chords"); then any other type; then the hands-apart ones to come. */}
        {families.some(f => TWO_HAND.includes(f)) && (
          <div className="pm-tabgroup" role="presentation">
            <span className="pm-tabgroup-h">Two-hand</span>
            <div className="pm-tabgroup-row">{families.filter(f => TWO_HAND.includes(f)).map(f => tab(f, f === 'closed (block)' ? 'Block' : 'Drop-2'))}</div>
          </div>
        )}
        {families.filter(f => !TWO_HAND.includes(f)).map(f => tab(f, f.replace('m7b5', 'm7♭5')))}
        {LATER_FAMILIES.filter(f => !families.includes(f)).map(f => (
          <button type="button" key={f} role="tab" aria-selected={false} disabled className="pm-tab-later" title="Coming later">
            <b>{f[0].toUpperCase() + f.slice(1)}</b>
            <span>later</span>
          </button>
        ))}
      </div>
      <section className="pm-top">
        <Wheel perKey={totals.perKey} onKey={goToKey} />
        <div className="pm-totals">
          <div className="pm-big">
            <span className="pm-num">{totals.known}</span>
            <span className="pm-lbl">
              voicings known
              <br />
              of {totals.deckV} in your deck
            </span>
          </div>
          {totals.partly > 0 && <span className="vt-hint">{totals.partly} more learned in some modes.</span>}
          <div className="pm-modes">
            {MODES.map(m => {
              const pm = totals.perMode[m];
              return (
                <div key={m} className="pm-mode">
                  <span>{MODE_LABEL[m]}</span>
                  <span className="pm-bar">
                    <i style={{ width: `${pm.deck ? (pm.learned / pm.deck) * 100 : 0}%` }} />
                  </span>
                  <b>
                    {pm.learned}/{pm.deck}
                  </b>
                </div>
              );
            })}
          </div>
          <span className="vt-hint">{voicings.length - totals.deckV} of these voicings aren’t in your deck.</span>
        </div>
      </section>

      {totals.slow.length > 0 && (
        <section className="pm-slow">
          <h3 className="sm-h">Slowest in your deck</h3>
          <div className="pm-slow-list">
            {totals.slow.map(x => (
              <button type="button" key={`${x.v.id}${x.m}`} className="pm-slow-card" onClick={() => onOpen(x.v.id)}>
                <b>{prettyLabel(x.v.chord_label)}</b> {MODE_LABEL[x.m]} <em>{fmtSecs(x.s!.avgMs)}</em>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="pm-tools">
        <Legend />
      </div>

      {/* Keys down, chords across: the whole chart fits the width (the owner: "see everything at a glance"). */}
      <div className="pm-board" role="grid" aria-label="Progress by key and chord" style={{ '--pm-cols': rows.length } as React.CSSProperties}>
        <div className="pm-bh pm-bh-corner" role="columnheader" />
        {rows.map(r => (
          <div key={`${r.quality}|${r.iii}`} className="pm-bh" role="columnheader" title={`${QUALITY[r.quality].display}${r.iii ? ' as iii' : ''}`}>
            {r.iii ? 'iii' : SHORT[r.quality] ?? QUALITY[r.quality].display}
          </div>
        ))}
        {cols.map(k => {
          const pk = totals.perKey.get(k);
          return (
            <Fragment key={k}>
              <div className={`pm-bk ${lit === k ? 'lit' : ''}`} data-row={k} role="rowheader">
                <b>{rootNames(k).map(n => pretty(n)).join('/')}</b>
                <span>{pk?.deck ? `${Math.round((pk.learned / pk.deck) * 100)}%` : ''}</span>
              </div>
              {rows.map(r => {
                const here = voicings.filter(v => v.root === k && v.quality === r.quality && v.tags.includes('iii') === r.iii);
                if (!here.length) return <span key={`${r.quality}|${r.iii}`} className="pm-bc pm-bc-none" role="gridcell" aria-label="none" />;
                const bands = MODES.map(m => sumCards(here.map(v => view.get(srsKey(v.id, m))!)));
                const inDeck = bands.some(b => b.state !== 'out');
                const name = `${rootNames(k).map(n => pretty(n)).join('/')}${QUALITY[r.quality].display}${r.iii ? ' as iii' : ''}`;
                const label = `${name}: ${here.length} voicing${here.length === 1 ? '' : 's'} — ${MODES.map((m, i) => `${MODE_LABEL[m]} ${bands[i].state}${bands[i].due ? ', due' : ''}`).join(' · ')}`;
                return (
                  <button
                    type="button"
                    key={`${r.quality}|${r.iii}`}
                    className={`pm-bc ${inDeck ? '' : 'pm-out'} ${lit === k ? 'lit' : ''}`}
                    role="gridcell"
                    aria-label={label}
                    title={label}
                    onClick={() => onOpenCell(here.map(v => v.id), name)}
                  >
                    {bands.map((c, i) => (
                      <span key={i} className={`pm-band pm-${c.state}`} style={c.state === 'learning' || c.state === 'learned' ? ({ '--s': c.strength } as React.CSSProperties) : undefined} />
                    ))}
                    {bands.some(b => b.due) && <i className="pm-due" />}
                  </button>
                );
              })}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}


function Legend() {
  return (
    <div className="pm-legend" aria-label="Legend">
      <span>
        <i className="pm-band pm-out" /> not in deck
      </span>
      <span>
        <i className="pm-band pm-new" /> new
      </span>
      <span>
        <i className="pm-band pm-learning" style={{ '--s': 0.7 } as React.CSSProperties} /> learning
      </span>
      <span>
        <i className="pm-band pm-learned" style={{ '--s': 0.9 } as React.CSSProperties} /> learned
      </span>
      <span>
        <i className="pm-due pm-due-key" /> due
      </span>
      <span className="pm-legend-modes">stripes: Play · Spell · Name</span>
    </div>
  );
}

/** The circle of fifths, each key shaded by the share of its deck cards learned. */
function Wheel({ perKey, onKey }: { perKey: Map<number, { learned: number; deck: number }>; onKey: (k: number) => void }) {
  // Clockwise from C at the top, round the fifths (the cycle of fourths reversed).
  const fifths = [0, ...CYCLE_OF_FOURTHS.slice(1).reverse()];
  const R = 100;
  const r = 58;
  const arc = (i: number) => {
    const a0 = ((i - 0.5) / 12) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((i + 0.5) / 12) * Math.PI * 2 - Math.PI / 2;
    const p = (rad: number, a: number) => `${110 + rad * Math.cos(a)} ${110 + rad * Math.sin(a)}`;
    return `M ${p(R, a0)} A ${R} ${R} 0 0 1 ${p(R, a1)} L ${p(r, a1)} A ${r} ${r} 0 0 0 ${p(r, a0)} Z`;
  };
  let learned = 0;
  let deck = 0;
  for (const v of perKey.values()) {
    learned += v.learned;
    deck += v.deck;
  }
  return (
    <svg className="pm-wheel" viewBox="0 0 220 220" role="group" aria-label="Keys known, round the circle of fifths">
      {fifths.map((k, i) => {
        const pk = perKey.get(k);
        const share = pk?.deck ? pk.learned / pk.deck : 0;
        const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
        return (
          <g key={k} className="pm-seg" onClick={() => onKey(k)} role="button" aria-label={`${rootNames(k).join(' or ')}: ${pk?.deck ? Math.round(share * 100) : 0}% learned`}>
            <path d={arc(i)} className={pk?.deck ? 'pm-seg-in' : 'pm-seg-out'} style={{ '--s': share } as React.CSSProperties} />
            <text x={110 + 79 * Math.cos(a)} y={110 + 79 * Math.sin(a) + 4} textAnchor="middle" className="pm-seg-lbl">
              {pretty(rootNames(k)[0])}
            </text>
          </g>
        );
      })}
      <text x="110" y="108" textAnchor="middle" className="pm-wheel-num">
        {deck ? `${Math.round((learned / deck) * 100)}%` : '—'}
      </text>
      <text x="110" y="128" textAnchor="middle" className="pm-wheel-lbl">
        cards learned
      </text>
    </svg>
  );
}
