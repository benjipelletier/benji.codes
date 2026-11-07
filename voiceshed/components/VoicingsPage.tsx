'use client';

// Voicings: every voicing, narrowed with the stackable filter (key, chord
// type, voicing type — VoicingFilter), as a progress map (ProgressMap: keys ×
// voicing types, each card's state at a glance) or a list grouped by chord. Open one to see it on the keyboard, edit
// its tags, mark it muddy, set its lowest playable register, set a card's
// target time, and see its stats per mode — accuracy, average time, and
// isolated against in-context speed.

import { useEffect, useMemo, useState } from 'react';
import { Keyboard, rangeAround } from './Keyboard';
import { ProgressMap } from './ProgressMap';
import { fmtPct, fmtSecs, relTime, useCardStats } from './TrainerShell';
import { newId, partnersOf, useTrainer } from './TrainerProvider';
import { midisOf } from '@voiceshed/lib/practice';
import { applyFilter, EMPTY_FILTER, useFilterState, VoicingFilter, type FilterState, type FilterTests } from './VoicingFilter';
import { targetFor } from '@voiceshed/lib/srs';
import { chordLabel, CYCLE_OF_FOURTHS, midiName, noteMidi, PC_FLAT, pitchName, pretty, QUALITIES, QUALITY, spellMidis, type Quality, prettyLabel } from '@voiceshed/lib/theory';
import { MODES, MODE_LABEL, srsKey, type Voicing } from '@voiceshed/lib/types';

const PAGE = 120;

export function VoicingsPage() {
  const t = useTrainer();
  const { voicings, srs, canEdit } = t;
  const { gapKeys, stats } = useCardStats();
  const { settings } = t;
  // Map or list, kept on this device.
  const [view, setViewState] = useState<'map' | 'list'>('map');
  useEffect(() => {
    try {
      const v = localStorage.getItem('vs-voicings-view');
      if (v === 'map' || v === 'list') setViewState(v);
    } catch {
      // The map, then.
    }
  }, []);
  const setView = (v: 'map' | 'list') => {
    setViewState(v);
    try {
      localStorage.setItem('vs-voicings-view', v);
    } catch {
      // Not remembered.
    }
  };
  const [filter, setFilter] = useFilterState();
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const tests = useMemo<FilterTests>(
    () => ({
      gap: v => MODES.some(m => gapKeys.has(srsKey(v.id, m))),
      learned: v => MODES.every(m => !!srs.get(srsKey(v.id, m))?.learned),
      inDeck: v => MODES.some(m => srs.has(srsKey(v.id, m))),
    }),
    [gapKeys, srs],
  );
  const filtered = useMemo(() => applyFilter(voicings, filter, tests), [voicings, filter, tests]);
  const changeFilter = (f: FilterState) => {
    setFilter(f);
    setShown(PAGE);
  };

  // Voicings of the same chord together, chords round the cycle of fourths.
  const groups = useMemo(() => {
    const qOrder = QUALITIES.map(x => x.id);
    const sorted = [...filtered].sort(
      (a, b) => CYCLE_OF_FOURTHS.indexOf(a.root) - CYCLE_OF_FOURTHS.indexOf(b.root) || qOrder.indexOf(a.quality) - qOrder.indexOf(b.quality) || a.sort_order - b.sort_order,
    );
    const out = new Map<string, Voicing[]>();
    for (const v of sorted.slice(0, shown)) {
      let g = out.get(v.chord_label);
      if (!g) out.set(v.chord_label, (g = []));
      g.push(v);
    }
    return [...out];
  }, [filtered, shown]);

  const openV = open ? voicings.find(v => v.id === open) ?? null : null;

  return (
    <div className="vt-page">
      <VoicingFilter voicings={voicings} value={filter} onChange={changeFilter} tests={tests} total={voicings.length} shown={filtered.length} collapsible={view === 'map'} />
      <div className="vt-seg lb-view" role="radiogroup" aria-label="View">
        {(['map', 'list'] as const).map(m => (
          <button type="button" key={m} role="radio" aria-checked={view === m} className={view === m ? 'on' : ''} onClick={() => setView(m)}>
            {m === 'map' ? 'Map' : 'List'}
          </button>
        ))}
      </div>

      {/* The map first, the deck's buttons after it; the list keeps them on top, with New voicing. */}
      {view === 'map' && <ProgressMap voicings={filtered} srs={srs} stats={stats} settings={settings} onOpen={setOpen} />}
      {canEdit && <DeckBar shown={filtered} />}
      {canEdit && view === 'list' && (
        <button type="button" className="vt-secondary lb-new" onClick={() => setAdding(true)}>
          + New voicing
        </button>
      )}

      {view === 'map' ? null : (
        <div className="lb-groups">
          {groups.map(([label, vs]) => (
            <section key={label} className="lb-group">
              <h3 className="lb-group-h">
                {prettyLabel(label)} <span>{vs.length}</span>
              </h3>
              <div className="lb-cards">
                {vs.map(v => (
                  <VoicingCard
                    key={v.id}
                    v={v}
                    inDeck={tests.inDeck(v)}
                    canEdit={canEdit}
                    learned={MODES.map(m => !!srs.get(srsKey(v.id, m))?.learned)}
                    gap={MODES.some(m => gapKeys.has(srsKey(v.id, m)))}
                    onOpen={() => setOpen(v.id)}
                  />
                ))}
              </div>
            </section>
          ))}
          {filtered.length > shown && (
            <button type="button" className="vt-secondary lb-more" onClick={() => setShown(s => s + PAGE * 2)}>
              Show more ({filtered.length - shown} left)
            </button>
          )}
          {!filtered.length && (
            <p className="vt-empty">
              Nothing fits all of that.{' '}
              <button type="button" className="vf-inline" onClick={() => changeFilter(EMPTY_FILTER)}>
                Clear the filter
              </button>
            </p>
          )}
        </div>
      )}

      {openV && <VoicingDetail v={openV} onClose={() => setOpen(null)} />}
      {adding && <NewVoicing onClose={() => setAdding(false)} onCreated={id => { setAdding(false); setOpen(id); }} />}
    </div>
  );
}

/**
 * The deck, for what the filter shows: how much of it is in, add the rest in
 * one go (each voicing's Play, Spell and Name cards), or take it all out.
 */
function DeckBar({ shown }: { shown: Voicing[] }) {
  const t = useTrainer();
  const inDeck = shown.filter(v => MODES.some(m => t.srs.has(srsKey(v.id, m))));
  const out = shown.filter(v => !inDeck.includes(v));
  const [said, setSaid] = useState<string | null>(null);
  if (!shown.length) return null;
  return (
    <section className="db" aria-label="Your deck">
      <span className="db-what">
        <b>{inDeck.length}</b> of {shown.length} shown in your deck
      </span>
      <div className="db-actions">
        {out.length > 0 && (
          <button
            type="button"
            className="vt-primary db-add"
            onClick={async () => {
              const n = await t.addToDeck(out.map(v => v.id));
              const vs = n / 3;
              setSaid(`Added ${vs} voicing${vs === 1 ? '' : 's'}${vs > out.length ? ' (with their other inversions)' : ''} — ${n} cards, new in your next review.`);
            }}
          >
            Add {out.length === shown.length ? 'all ' : ''}
            {out.length} to deck
          </button>
        )}
        {inDeck.length > 0 && (
          <button
            type="button"
            className="vt-secondary"
            onClick={async () => {
              if (!confirm(`Take ${inDeck.length} voicing${inDeck.length === 1 ? '' : 's'} out of your deck? Their schedules go; your answers stay.`)) return;
              const n = await t.removeFromDeck(inDeck.map(v => v.id));
              setSaid(`Took ${n} out of your deck.`);
            }}
          >
            Remove {inDeck.length === shown.length ? 'all' : inDeck.length}
          </button>
        )}
      </div>
      {said && <span className="vt-hint db-said">{said}</span>}
    </section>
  );
}

function VoicingCard({
  v,
  learned,
  gap,
  inDeck,
  canEdit,
  onOpen,
}: {
  v: Voicing;
  learned: boolean[];
  gap: boolean;
  inDeck: boolean;
  canEdit: boolean;
  onOpen: () => void;
}) {
  const t = useTrainer();
  const m = midisOf(v);
  const mv = v.top_move ? noteMidi(v.top_move) : null;
  const [lo, hi] = rangeAround(mv != null ? [...m, mv] : m, 10);
  const muddy = v.tags.includes('muddy');
  return (
    <div className={`lb-card ${muddy ? 'lb-muddy' : ''} ${inDeck ? 'lb-in' : ''}`}>
      <button type="button" className="lb-open" onClick={onOpen}>
        <Keyboard compact low={lo} high={hi} marks={{ ...Object.fromEntries(m.map(x => [x, 'on'])), ...(mv != null ? { [mv]: 'move' } : {}) }} />
        <span className="lb-notes">
          {v.notes.map(n => pretty(pitchName(n))).join(' ')}
          {v.top_move ? ` → ${pretty(pitchName(v.top_move))}` : ''}
        </span>
        <span className="lb-meta">
          <span className="lb-fam">{v.family}</span>
          {muddy && <span className="lb-flag">muddy</span>}
          {gap && <span className="lb-flag lb-flag-gap" title="Fast in context, slow on its own">gap</span>}
          {inDeck && (
            <span className="lb-learned" title={MODES.map((md, i) => `${MODE_LABEL[md]}: ${learned[i] ? 'learned' : 'not yet'}`).join(' · ')}>
              {learned.map((l, i) => (
                <i key={i} className={l ? 'on' : ''} />
              ))}
            </span>
          )}
        </span>
      </button>
      {canEdit && (
        <button
          type="button"
          className={`lb-deck ${inDeck ? 'on' : ''}`}
          aria-pressed={inDeck}
          onClick={() => void (inDeck ? t.removeFromDeck([v.id]) : t.addToDeck([v.id]))}
        >
          {inDeck ? '✓ In deck' : '+ Deck'}
        </button>
      )}
    </div>
  );
}

function VoicingDetail({ v, onClose }: { v: Voicing; onClose: () => void }) {
  const t = useTrainer();
  const { canEdit, srs, settings } = t;
  const { stats, gapKeys } = useCardStats();
  const deckIn = MODES.some(m => srs.has(srsKey(v.id, m)));
  const pair = partnersOf(t.voicings, v).filter(o => o.id !== v.id);
  // A 7♭9 is a diminished seventh: its keys also voice three other dominants.
  const siblings = useMemo(() => {
    if (v.quality !== '7b9') return [];
    const pcs = (x: Voicing) => [...new Set(x.notes.map(n => noteMidi(n) % 12))].sort((a, b) => a - b).join(',');
    const mine = pcs(v);
    return [...new Set(t.voicings.filter(o => o.quality === '7b9' && o.family === v.family && o.root !== v.root && pcs(o) === mine).map(o => o.chord_label))];
  }, [t.voicings, v]);
  const [tagDraft, setTagDraft] = useState('');
  const [notesDraft, setNotesDraft] = useState(v.notes_text ?? '');
  const m = midisOf(v);
  const mv = v.top_move ? noteMidi(v.top_move) : null;
  const [lo, hi] = rangeAround(mv != null ? [...m, mv] : m, 15);
  const labels = Object.fromEntries(v.notes.map((n, i) => [m[i], pretty(pitchName(n))]));
  const muddy = v.tags.includes('muddy');

  const save = (p: Partial<Voicing>) => void t.saveVoicing({ ...v, ...p });
  const addTag = () => {
    const tag = tagDraft.trim().toLowerCase().replace(/\s+/g, '-');
    if (tag && !v.tags.includes(tag)) save({ tags: [...v.tags, tag] });
    setTagDraft('');
  };
  const registers = Array.from({ length: 30 }, (_, i) => 36 + i); // C2 … F4

  return (
    <div className="vt-modal" role="dialog" aria-modal="true" aria-label={`${v.chord_label} voicing`} onClick={onClose}>
      <div className="vt-sheet" onClick={e => e.stopPropagation()}>
        <div className="vt-sheet-head">
          <h2>{prettyLabel(v.chord_label)}</h2>
          <span className="vt-hint">
            {v.family} · top {pretty(pitchName(v.top_note))}
          </span>
          <button type="button" className="vt-x" onClick={onClose} aria-label="close">
            ×
          </button>
        </div>
        <div className="dt-kb">
          <Keyboard
            low={lo}
            high={hi}
            marks={{ ...Object.fromEntries(m.map(x => [x, 'on'])), ...(mv != null ? { [mv]: 'move' } : {}) }}
            labels={{ ...labels, ...(mv != null ? { [mv]: `→${pretty(pitchName(v.top_move!))}` } : {}) }}
          />
        </div>
        <p className="dt-notes">
          {v.notes.map(pretty).join('  ')}
          {v.top_move ? `  → ${pretty(v.top_move)}` : ''}
        </p>
        {v.top_move && <span className="vt-hint">The top voice moves from {pretty(pitchName(v.top_note))} to {pretty(pitchName(v.top_move))} after the chord: Play and Spell ask for the move too.</span>}

        <div className="vt-field">
          <span className="vt-field-lbl">Tags</span>
          <div className="vt-chips">
            {v.tags.map(tag => (
              <span key={tag} className="vt-chip on">
                {tag}
                {canEdit && (
                  <button type="button" className="vt-chip-x" onClick={() => save({ tags: v.tags.filter(x => x !== tag) })} aria-label={`remove ${tag}`}>
                    ×
                  </button>
                )}
              </span>
            ))}
            {canEdit && (
              <form
                className="dt-tagform"
                onSubmit={e => {
                  e.preventDefault();
                  addTag();
                }}
              >
                <input className="vt-input" value={tagDraft} onChange={e => setTagDraft(e.target.value)} placeholder="add tag" />
              </form>
            )}
          </div>
        </div>

        <div className="vt-row2">
          <label className="vt-check">
            <input type="checkbox" checked={muddy} disabled={!canEdit} onChange={e => save({ tags: e.target.checked ? [...v.tags, 'muddy'] : v.tags.filter(x => x !== 'muddy') })} />
            Muddy
          </label>
          <label className="vt-field vt-field-inline">
            <span className="vt-field-lbl">Lowest register</span>
            <select disabled={!canEdit} value={v.lowest_register ?? ''} onChange={e => save({ lowest_register: e.target.value === '' ? null : Number(e.target.value) })}>
              <option value="">none</option>
              {registers.map(r => (
                <option key={r} value={r}>
                  bottom note ≥ {pretty(midiName(r))}
                </option>
              ))}
            </select>
          </label>
        </div>
        <span className="vt-hint">In Play mode it may be played an octave away, but never with its bottom note below this.</span>

        <label className="vt-field">
          <span className="vt-field-lbl">Notes</span>
          <textarea className="vt-input" rows={2} disabled={!canEdit} value={notesDraft} onChange={e => setNotesDraft(e.target.value)} onBlur={() => notesDraft !== (v.notes_text ?? '') && save({ notes_text: notesDraft || null })} />
        </label>

        <div className="dt-deck">
          {deckIn ? (
            <span>
              <b>In your deck</b> — Play, Spell and Name cards.
            </span>
          ) : (
            <span>Not in your deck: it won’t come up in Review.</span>
          )}
          {siblings.length > 0 && (
            <span className="vt-hint dt-pair">
              Same keys as {siblings.map(o => prettyLabel(o)).join(', ')} — a diminished shape: one hand shape, four dominants a minor third apart.
            </span>
          )}
          {pair.length > 0 && (
            <span className="vt-hint dt-pair">
              Goes with its other inversion, {pair.map(o => o.notes.map(n => pretty(pitchName(n))).join(' ')).join(', ')}: added and removed together.
            </span>
          )}
          {canEdit &&
            (deckIn ? (
              <button type="button" className="vt-secondary" onClick={() => confirm('Take this voicing out of your deck? Its schedules go; your answers stay.') && void t.removeFromDeck([v.id])}>
                Remove from deck
              </button>
            ) : (
              <button type="button" className="vt-primary dt-add" onClick={() => void t.addToDeck([v.id])}>
                Add to deck
              </button>
            ))}
        </div>

        <table className="vt-table dt-stats">
          <thead>
            <tr>
              <th>Mode</th>
              <th>Accuracy</th>
              <th>Avg</th>
              <th>Isolated</th>
              <th>In context</th>
              <th>Target</th>
              <th>Due</th>
            </tr>
          </thead>
          <tbody>
            {MODES.map(md => {
              const key = srsKey(v.id, md);
              const s = stats.get(key);
              const st = srs.get(key);
              const target = targetFor(st, md, settings);
              return (
                <tr key={md} className={gapKeys.has(key) ? 'dt-gap' : ''}>
                  <td>
                    {MODE_LABEL[md]} {st?.learned ? <span className="dt-learned">learned</span> : null}
                  </td>
                  <td>{s ? `${fmtPct(s.correct, s.attempts)} of ${s.attempts}` : '—'}</td>
                  <td>{fmtSecs(s?.avgMs)}</td>
                  <td>{fmtSecs(s?.isolatedMs)}</td>
                  <td>
                    {fmtSecs(s?.contextMs)}
                    {gapKeys.has(key) && <span className="lb-flag lb-flag-gap">gap</span>}
                  </td>
                  <td>
                    <input
                      className="dt-target"
                      type="number"
                      min={0.5}
                      max={20}
                      step={0.1}
                      disabled={!canEdit || !st}
                      title={st ? undefined : 'Add it to your deck to set its target'}
                      value={target / 1000}
                      onChange={e => {
                        const ms = Math.round(Number(e.target.value) * 1000);
                        if (ms < 500 || !st) return;
                        void t.saveSrs([{ ...st, target_ms: ms === settings.target_ms[md] ? null : ms, updated_at: new Date().toISOString(), dirty: true }]);
                      }}
                    />
                    s
                  </td>
                  <td>{!st ? '—' : st.reps === 0 ? 'new' : relTime(st.due_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <span className="vt-hint">Isolated and in-context are the medians of the last ten right answers. “gap”: fast in context but slow on its own — shown more often in review.</span>

        {canEdit && (
          <div className="vt-inline dt-danger">
            <button
              type="button"
              className="vt-secondary"
              onClick={() => {
                if (confirm(`Delete this ${v.chord_label} voicing and its history?`)) {
                  void t.deleteVoicing(v.id);
                  onClose();
                }
              }}
            >
              Delete voicing
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function NewVoicing({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const t = useTrainer();
  const [root, setRoot] = useState(0);
  const [quality, setQuality] = useState<Quality>('maj7');
  const [family, setFamily] = useState('custom');
  const [tagText, setTagText] = useState('');
  const [midis, setMidis] = useState<number[]>([]);
  const [lo, setLo] = useState(48);

  const spelled = midis.length ? spellMidis(root, quality, midis) : null;
  const label = spelled ? chordLabel(spelled.rootName, quality) : chordLabel(QUALITY[quality].roots[root], quality);
  const dup = spelled ? t.voicings.find(v => v.chord_label === label && v.family === family && v.notes.join() === spelled.notes.join()) : null;

  const create = () => {
    if (!spelled || dup) return;
    const id = newId();
    const tags = tagText
      .split(',')
      .map(x => x.trim().toLowerCase().replace(/\s+/g, '-'))
      .filter(Boolean);
    void t.saveVoicing({
      id,
      chord_label: label,
      root,
      quality,
      notes: spelled.notes,
      top_note: spelled.notes[spelled.notes.length - 1],
      top_move: null,
      family: family.trim() || 'custom',
      tags: [...new Set([...tags, `${spelled.notes.length}-note`])],
      lowest_register: null,
      notes_text: null,
      sort_order: 30000 + t.voicings.length,
      updated_at: new Date().toISOString(),
    });
    onCreated(id);
  };

  return (
    <div className="vt-modal" role="dialog" aria-modal="true" aria-label="new voicing" onClick={onClose}>
      <div className="vt-sheet" onClick={e => e.stopPropagation()}>
        <div className="vt-sheet-head">
          <h2>New voicing</h2>
          <button type="button" className="vt-x" onClick={onClose} aria-label="close">
            ×
          </button>
        </div>
        <div className="vt-row2">
          <label className="vt-field vt-field-inline">
            <span className="vt-field-lbl">Root</span>
            <select value={root} onChange={e => setRoot(Number(e.target.value))}>
              {PC_FLAT.map((n, pc) => (
                <option key={pc} value={pc}>
                  {pretty(n)}
                </option>
              ))}
            </select>
          </label>
          <label className="vt-field vt-field-inline">
            <span className="vt-field-lbl">Chord</span>
            <select value={quality} onChange={e => setQuality(e.target.value as Quality)}>
              {QUALITIES.map(x => (
                <option key={x.id} value={x.id}>
                  {x.display}
                </option>
              ))}
            </select>
          </label>
          <label className="vt-field vt-field-inline">
            <span className="vt-field-lbl">Family</span>
            <input className="vt-input" value={family} onChange={e => setFamily(e.target.value)} />
          </label>
        </div>
        <span className="vt-field-lbl">Tap the notes</span>
        <div className="dt-kb">
          <Keyboard low={lo} high={lo + 28} marks={Object.fromEntries(midis.map(m => [m, 'on']))} onKey={m => setMidis(cur => (cur.includes(m) ? cur.filter(x => x !== m) : [...cur, m].sort((a, b) => a - b)))} />
        </div>
        <div className="cr-kb-shift">
          <button type="button" onClick={() => setLo(l => Math.max(24, l - 12))}>
            ◀ 8va
          </button>
          <span>{spelled ? `${prettyLabel(label)}: ${spelled.notes.map(pretty).join(' ')}` : 'no notes yet'}</span>
          <button type="button" onClick={() => setLo(l => Math.min(84, l + 12))}>
            8va ▶
          </button>
        </div>
        <label className="vt-field">
          <span className="vt-field-lbl">Tags (comma separated)</span>
          <input className="vt-input" value={tagText} onChange={e => setTagText(e.target.value)} placeholder="rootless, left-hand" />
        </label>
        {dup && <p className="vt-error">That voicing is already in your voicings.</p>}
        <div className="vt-inline">
          <button type="button" className="vt-primary" disabled={!spelled || midis.length < 2 || !!dup} onClick={create}>
            Add voicing
          </button>
          <button type="button" className="vt-secondary" onClick={() => setMidis([])} disabled={!midis.length}>
            Clear
          </button>
        </div>
        <span className="vt-hint">Each note is spelled as its interval above the root.</span>
      </div>
    </div>
  );
}
