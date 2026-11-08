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
import { useBackClose } from './useBackClose';

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

/** The map's column groups, in order. */
const GROUP: Partial<Record<Voicing['quality'], string>> = { m7: 'minor', maj7: 'major', '6': 'major', '7': 'dominant', '7b9': 'dominant', '7alt': 'dominant', dim7: 'dim', m7b5: 'dim' };

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
/** The two-hand types, on one chart (the owner: "see drop-2 and block at the same time, not a toggle"). */
export const TWO_HAND = ['drop-2 two-hand', 'quartal two-hand', 'closed (block)'];
/** Which chart a voicing is on: two-hand (drop-2 and block together), else its own type. */
const chartOf = (v: Voicing) => (TWO_HAND.includes(v.family) ? 'two-hand' : v.family);
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
  /** Told which chart is showing ('two-hand', or a type), so the page's deck bar acts on it. */
  onChart?: (chart: string | null) => void;
}) {
  const now = Date.now();
  /** A key tapped on the circle: its row, lit for a moment. */
  const [lit, setLit] = useState<number | null>(null);
  /**
   * A chord group zoomed into (the owner: "clicking on a group could zoom in to just that group and
   * show more details … that's busy"): its chords only, each tile split into its inversions.
   */
  const [zoom, setZoom] = useState<string | null>(null);
  useBackClose(zoom != null, () => setZoom(null));

  // One chart per voicing type, picked above the map and kept on the device.
  const families = useMemo(() => {
    const famOrder = ['two-hand', ...SHAPE_SETS.map(s => s.family)];
    const rank = (f: string) => (famOrder.includes(f) ? famOrder.indexOf(f) : famOrder.length);
    return [...new Set(all.map(chartOf))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
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
  const voicings = useMemo(() => all.filter(v => chartOf(v) === family), [all, family]);
  useEffect(() => {
    onChart?.(family ?? null);
  }, [family, onChart]);
  // Each chart's tab: voicings known (all three modes learned) of those in the deck.
  const famTotals = useMemo(() => {
    const out = new Map<string, { known: number; deck: number; all: number }>();
    for (const v of all) {
      const t = out.get(chartOf(v)) ?? { known: 0, deck: 0, all: 0 };
      t.all++;
      const sts = MODES.map(m => srs.get(srsKey(v.id, m)));
      if (sts.some(Boolean)) t.deck++;
      if (sts.every(st => st?.learned)) t.known++;
      out.set(chartOf(v), t);
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
    // Grouped (the owner: "m7 and iii together, maj7 and 6 together, all the dominants together, and the
    // two diminisheds, full and half, together").
    const qOrder = ['m7', 'maj7', '6', '7', '7b9', '7alt', 'dim7', 'm7b5', ...QUALITIES.map(q => q.id)];
    // One column per chord (drop-2 and block share it: a split tile).
    void famOrder;
    const seen = new Map<string, { quality: Voicing['quality']; iii: boolean }>();
    for (const v of voicings) seen.set(`${v.quality}|${v.tags.includes('iii')}`, { quality: v.quality, iii: v.tags.includes('iii') });
    return [...seen.values()].sort((a, b) => qOrder.indexOf(a.quality) - qOrder.indexOf(b.quality) || Number(a.iii) - Number(b.iii));
  }, [voicings]);
  // Column groups, and the columns that start one after another (a gap before them).
  const allGroups = useMemo(() => [...new Set(rows.map(r => GROUP[r.quality] ?? 'other'))], [rows]);
  const shown = useMemo(() => (zoom ? rows.filter(r => (GROUP[r.quality] ?? 'other') === zoom) : rows), [rows, zoom]);
  const groups = useMemo(() => {
    const out: { name: string; start: number; n: number }[] = [];
    shown.forEach((r, i) => {
      const name = GROUP[r.quality] ?? 'other';
      const last = out[out.length - 1];
      if (last && last.name === name) last.n++;
      else out.push({ name, start: i, n: 1 });
    });
    return out;
  }, [shown]);
  const gapAt = useMemo(() => new Set(groups.filter(g => g.start > 0).map(g => g.start)), [groups]);
  // The grid's columns: the keys, then each chord, a thin spacer before each new group.
  const colOf = (ri: number) => 2 + ri + [...gapAt].filter(g => g <= ri).length;
  const template = `52px ${shown.map((_, ri) => `${gapAt.has(ri) ? '6px ' : ''}var(--pm-track)`).join(' ')}`;
  /** A chord's inversion columns, named (1st, 2nd…, spread, block), from any key that has it. */
  const invLabels = (r: { quality: Voicing['quality']; iii: boolean }) => {
    const shapes: { family: string; tag: string }[] = [];
    for (const v of [...voicings].filter(v => v.quality === r.quality && v.tags.includes('iii') === r.iii).sort((a, b) => TWO_HAND.indexOf(a.family) - TWO_HAND.indexOf(b.family) || a.sort_order - b.sort_order)) {
      const tag = v.tags[v.tags.length - 1];
      if (!shapes.some(x => x.family === v.family && x.tag === tag)) shapes.push({ family: v.family, tag });
    }
    const ord = ['1st', '2nd', '3rd', '4th'];
    let n = 0;
    return shapes.map(x => (x.family === 'closed (block)' ? 'block' : x.family === 'quartal two-hand' ? 'quartal' : x.tag === '1-5-7-11' ? 'spread' : ord[n++] ?? `${n}th`));
  };
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
        {families.map(f => tab(f, f === 'two-hand' ? 'Two-hand' : f.replace('m7b5', 'm7♭5')))}
        {LATER_FAMILIES.filter(f => !all.some(v => v.family === f)).map(f => (
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
        <Legend zoomed={!!zoom} />
      </div>

      {/* Keys down, chords across: the whole chart fits the width (the owner: "see everything at a glance"). */}
      {zoom && (
        <div className="pm-zoomnav" role="tablist" aria-label="Chord group">
          <button type="button" className="pm-zoom-all" onClick={() => setZoom(null)}>
            ‹ All
          </button>
          {allGroups.map(g => (
            <button type="button" key={g} role="tab" aria-selected={g === zoom} className={g === zoom ? 'on' : ''} onClick={() => setZoom(g)}>
              {g}
            </button>
          ))}
        </div>
      )}
      <div className={`pm-board ${zoom ? 'pm-board-zoom' : ''}`} role="grid" aria-label="Progress by key and chord" style={{ gridTemplateColumns: template }}>
        {!zoom && (
          <>
            <div className="pm-bg pm-bg-corner" />
            {groups.map(g => (
              <button type="button" key={g.name} className="pm-bg" style={{ gridColumn: `${colOf(g.start)} / span ${g.n}` }} onClick={() => setZoom(g.name)} title={`Zoom into ${g.name}: inversions`}>
                {g.name} <span aria-hidden>›</span>
              </button>
            ))}
          </>
        )}
        <div className="pm-bh pm-bh-corner" role="columnheader" />
        {shown.map((r, ri) => (
          <div key={`${r.quality}|${r.iii}`} className="pm-bh" style={{ gridColumn: colOf(ri) }} role="columnheader" title={`${QUALITY[r.quality].display}${r.iii ? ' as iii' : ''}`}>
            {r.iii ? 'iii' : SHORT[r.quality] ?? QUALITY[r.quality].display}
            {zoom && (
              <span className="pm-invs">
                {invLabels(r).map((l, li) => (
                  <span key={li}>{l}</span>
                ))}
              </span>
            )}
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
              {shown.map((r, ri) => {
                const here = voicings.filter(v => v.root === k && v.quality === r.quality && v.tags.includes('iii') === r.iii);
                if (!here.length) return <span key={`${r.quality}|${r.iii}`} className="pm-bc pm-bc-none" style={{ gridColumn: colOf(ri) }} role="gridcell" aria-label="none" />;
                // A column per inversion (its shape; a black key's two names share one), each with its
                // Play/Spell/Name bars (the owner picked "both: a tiny grid in each tile"); block after drop-2.
                const shapes = new Map<string, Voicing[]>();
                for (const v of [...here].sort((a, b) => TWO_HAND.indexOf(a.family) - TWO_HAND.indexOf(b.family) || a.sort_order - b.sort_order)) {
                  const key = `${v.family}|${v.tags[v.tags.length - 1]}`;
                  shapes.set(key, [...(shapes.get(key) ?? []), v]);
                }
                const fams = [...shapes.keys()].map(k => k.split('|')[0]);
                const parts = [...shapes.values()].map(vs => MODES.map(m => sumCards(vs.map(v => view.get(srsKey(v.id, m))!))));
                const bands = MODES.map(m => sumCards(here.map(v => view.get(srsKey(v.id, m))!)));
                const inDeck = bands.some(b => b.state !== 'out');
                const name = `${rootNames(k).map(n => pretty(n)).join('/')}${QUALITY[r.quality].display}${r.iii ? ' as iii' : ''}`;
                const label = `${name}: ${here.length} voicing${here.length === 1 ? '' : 's'} — ${MODES.map((m, i) => `${MODE_LABEL[m]} ${bands[i].state}${bands[i].due ? ', due' : ''}`).join(' · ')}`;
                return (
                  <button
                    type="button"
                    key={`${r.quality}|${r.iii}`}
                    className={`pm-bc ${inDeck ? '' : 'pm-out'} ${lit === k ? 'lit' : ''} ${zoom && parts.length > 1 ? 'split' : ''}`}
                    style={{ gridColumn: colOf(ri) }}
                    role="gridcell"
                    aria-label={label}
                    title={label}
                    onClick={() => onOpenCell(here.map(v => v.id), name)}
                  >
                    {/* The overview sums a chord's inversions; zoomed in, each has its own column. */}
                    {(zoom ? parts : [bands]).map((part, pi) => (
                      <Fragment key={pi}>
                        {/* Connected inversions (same voicing type) joined by a liquid neck (the owner: "connect the inversions with a small liquid type connector"). */}
                        {zoom && pi > 0 && fams[pi] === fams[pi - 1] && <LiquidNeck />}
                        <span className={`pm-part ${zoom ? 'pm-pill' : ''} ${zoom && fams[pi] === 'closed (block)' && fams[pi - 1] && fams[pi - 1] !== 'closed (block)' ? 'pm-part-block' : ''}`}>
                          {part.map((c, i) => (
                            <span key={i} className={`pm-band pm-${c.state}`} style={c.state === 'learning' || c.state === 'learned' ? ({ '--s': c.strength } as React.CSSProperties) : undefined} />
                          ))}
                        </span>
                      </Fragment>
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


/** A pinched neck joining two inversion pills, like two drops meeting. */
function LiquidNeck() {
  return (
    <svg className="pm-neck" viewBox="0 0 10 24" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 0 C 3 10, 7 10, 10 0 L 10 24 C 7 14, 3 14, 0 24 Z" />
    </svg>
  );
}

/** How to read a tile — inversions across, Play/Spell/Name down — and what the colours mean. */
function Legend({ zoomed }: { zoomed: boolean }) {
  const bar = (state: CardState, strength = 0.8) => <i className={`pm-band pm-${state}`} style={state === 'learning' || state === 'learned' ? ({ '--s': strength } as React.CSSProperties) : undefined} />;
  return (
    <div className="pm-keys" aria-label="How to read the map">
      <div className="pm-sample" aria-hidden="true">
        <span className="pm-sample-modes">
          <span>Play</span>
          <span>Spell</span>
          <span>Name</span>
        </span>
        <span className={`pm-sample-tile ${zoomed ? 'zoomed' : ''}`}>
          <span className={`pm-part ${zoomed ? 'pm-pill' : ''}`}>
            {bar('learned', 0.9)}
            {bar('learning', 0.7)}
            {bar('learned', 0.6)}
          </span>
          {zoomed && (
            <>
              <LiquidNeck />
              <span className="pm-part pm-pill">
                {bar('learning', 0.6)}
                {bar('new')}
                {bar('learning', 0.4)}
              </span>
              <span className="pm-part pm-pill pm-part-block">
                {bar('out')}
                {bar('out')}
                {bar('out')}
              </span>
            </>
          )}
        </span>
        <span className="pm-sample-invs">
          {zoomed ? (
            <>
              <span>1st</span>
              <span>2nd</span>
              <span>block</span>
            </>
          ) : (
            <span>all inversions</span>
          )}
        </span>
      </div>
      {!zoomed && <span className="pm-hint">Tap a group (minor, major…) to see each inversion.</span>}
      <div className="pm-legend-states">
        <span>
          {bar('out')} not in deck
        </span>
        <span>
          {bar('new')} new
        </span>
        <span>
          {bar('learning', 0.7)} learning
        </span>
        <span>
          {bar('learned', 0.9)} learned
        </span>
        <span>
          <i className="pm-due pm-due-key" /> due
        </span>
      </div>
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
