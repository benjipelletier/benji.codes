'use client';

// The progress map: every voicing laid out by key (columns, round the cycle
// of fourths) and by chord (rows), one chart per voicing type (the owner:
// "separate charts for the different rootless types"), to scroll around in
// both directions. Each voicing is a tile with three stripes — Play, Spell, Name —
// each showing that card: not in the deck (empty), new (outlined), learning
// (amber, stronger as its accuracy rises), learned (green, deeper the faster
// it is against its target); a dot marks one due now. Above it, a circle of
// fifths shaded by how much of each key is known (tap a key to go to its
// column), the totals, and the slowest cards. Tap a tile to open its voicing.

import { useEffect, useMemo, useRef, useState } from 'react';
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

const ZOOMS = [44, 58, 76];
const FAMILY_KEY = 'vt-map-family';

export function ProgressMap({
  voicings: all,
  srs,
  stats,
  settings,
  onOpen,
  onChart,
}: {
  /** The voicings the filter leaves. */
  voicings: Voicing[];
  srs: Map<string, SrsState>;
  stats: Map<string, ModeStats>;
  settings: Settings;
  onOpen: (id: string) => void;
  /** Told which voicing type's chart is showing, so the page's deck bar acts on it. */
  onChart?: (family: string | null) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const scroller = useRef<HTMLDivElement>(null);
  const now = Date.now();

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
    const el = scroller.current?.querySelector<HTMLElement>(`[data-col="${k}"]`);
    if (el && scroller.current) scroller.current.scrollTo({ left: el.offsetLeft - (scroller.current.querySelector<HTMLElement>('.pm-corner')?.offsetWidth ?? 0) - 8, behavior: 'smooth' });
  };

  const cell = ZOOMS[zoom];
  if (!all.length) return <p className="vt-empty">No voicings match.</p>;

  return (
    <div className="pm" style={{ '--pm-cell': `${cell}px` } as React.CSSProperties}>
      <div className="pm-tabs" role="tablist" aria-label="Voicing type">
        {families.map(f => {
          const t = famTotals.get(f);
          return (
            <button type="button" key={f} role="tab" aria-selected={f === family} className={f === family ? 'on' : ''} onClick={() => pick(f)}>
              <b>{f.replace('m7b5', 'm7♭5')}</b>
              <span>{t?.deck ? `${t.known}/${t.deck} known` : `${t?.all ?? 0} voicings`}</span>
            </button>
          );
        })}
        {/* Placeholders for the hands-apart types to come. */}
        {LATER_FAMILIES.filter(f => !families.includes(f)).map(f => (
          <button type="button" key={f} role="tab" aria-selected={false} disabled className="pm-tab-later" title="Coming later">
            <b>{f}</b>
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
        <div className="vt-seg pm-zoom" role="radiogroup" aria-label="Tile size">
          {['S', 'M', 'L'].map((z, i) => (
            <button type="button" key={z} role="radio" aria-checked={zoom === i} className={zoom === i ? 'on' : ''} onClick={() => setZoom(i)}>
              {z}
            </button>
          ))}
        </div>
      </div>

      <div className="pm-scroll" ref={scroller}>
        <table className="pm-grid">
          <thead>
            <tr>
              <th className="pm-corner" />
              {cols.map(k => {
                const pk = totals.perKey.get(k);
                return (
                  <th key={k} data-col={k} className="pm-col">
                    <span className="pm-key">
                      {rootNames(k).map(n => (
                        <span key={n}>{pretty(n)}</span>
                      ))}
                    </span>
                    <span className="pm-keypct">{pk?.deck ? `${Math.round((pk.learned / pk.deck) * 100)}%` : '—'}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={`${r.family}|${r.quality}|${r.iii}`}>
                <th className="pm-row">
                  <span className="pm-row-q">{QUALITY[r.quality].display}</span>
                  {r.iii && <span className="pm-row-f">as iii</span>}
                </th>
                {cols.map(k => {
                  const here = voicings.filter(v => v.root === k && v.family === r.family && v.quality === r.quality && v.tags.includes('iii') === r.iii);
                  // A black key's two spellings side by side, each with its inversions.
                  const names = [...new Set(here.map(v => v.chord_label))];
                  return (
                    <td key={k} className="pm-cell">
                      {names.map(label => (
                        <div key={label} className="pm-spelling">
                          {names.length > 1 && <span className="pm-name">{pretty(parseChordLabel(label)?.rootName ?? '')}</span>}
                          <div className="pm-tiles">
                            {here
                              .filter(v => v.chord_label === label)
                              .map(v => (
                                <Tile key={v.id} v={v} cards={MODES.map(m => view.get(srsKey(v.id, m))!)} onOpen={() => onOpen(v.id)} />
                              ))}
                          </div>
                        </div>
                      ))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Tile({ v, cards, onOpen }: { v: Voicing; cards: CardView[]; onOpen: () => void }) {
  const inDeck = cards.some(c => c.state !== 'out');
  const title = `${v.chord_label} · ${v.notes.join(' ')} — ${MODES.map((m, i) => `${MODE_LABEL[m]}: ${cards[i].state}${cards[i].avgMs ? ` ${fmtSecs(cards[i].avgMs)}` : ''}${cards[i].due ? ', due' : ''}`).join(' · ')}`;
  return (
    <button type="button" className={`pm-tile ${inDeck ? '' : 'pm-out'}`} onClick={onOpen} title={title} aria-label={title}>
      {cards.map((c, i) => (
        <span key={i} className={`pm-band pm-${c.state}`} style={c.state === 'learning' || c.state === 'learned' ? ({ '--s': c.strength } as React.CSSProperties) : undefined}>
          {c.due && <i className="pm-due" />}
        </span>
      ))}
    </button>
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
