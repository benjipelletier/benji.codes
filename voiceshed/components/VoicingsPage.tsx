'use client';

// Voicings: every voicing, narrowed with the stackable filter (key, chord
// type, voicing type — VoicingFilter), as a progress map (ProgressMap: keys ×
// voicing types, each card's state at a glance) or a list grouped by chord. Open one to see it on the keyboard, edit
// its tags, mark it muddy, set its lowest playable register, set a card's
// target time, and see its stats per mode — accuracy, average time, and
// isolated against in-context speed.

import { useEffect, useMemo, useState } from 'react';
import { Keyboard, rangeAround } from './Keyboard';
import { ProgressMap, TWO_HAND } from './ProgressMap';
import { relTime, useCardStats } from './TrainerShell';
import { targetFor } from '@voiceshed/lib/srs';
import { Retention } from './Retention';
import { chordCards, ModeKey, PlayingCard, worstOf, type ModeState } from './PlayingCard';
import { deckGroups } from '@voiceshed/lib/drill';
import { cardStatus, type CardStatus } from '@voiceshed/lib/drill';
import { newId, partnersOf, useTrainer } from './TrainerProvider';
import { useBackClose } from './useBackClose';
import { formatTime, parseTime, readSource, sourceHref, SOURCE_NAME } from '@voiceshed/lib/source';
import { hasRoot, midisOf } from '@voiceshed/lib/practice';
import { applyFilter, EMPTY_FILTER, useFilterState, VoicingFilter, type FilterState, type FilterTests } from './VoicingFilter';
import { chordLabel, CYCLE_OF_FOURTHS, familyLabel, FOUND, midiName, noteMidi, PC_FLAT, pitchName, pretty, QUALITIES, QUALITY, spellMidis, type Quality, prettyLabel } from '@voiceshed/lib/theory';
import { MODES, MODE_LABEL, srsKey, type Mode, type Voicing } from '@voiceshed/lib/types';

const PAGE = 120;

type View = 'map' | 'list' | 'found' | 'deck';

export function VoicingsPage() {
  const t = useTrainer();
  const { voicings, srs, canEdit } = t;
  const { gapKeys, stats } = useCardStats();
  const { settings } = t;
  // Map, list, found or deck, kept on this device; `?view=deck` (Review's link) wins.
  const [view, setViewState] = useState<View>('map');
  useEffect(() => {
    const isView = (v: string | null): v is View => v === 'map' || v === 'list' || v === 'found' || v === 'deck';
    const asked = new URLSearchParams(location.search).get('view');
    if (isView(asked)) return setViewState(asked);
    try {
      const v = localStorage.getItem('vs-voicings-view');
      if (isView(v)) setViewState(v);
    } catch {
      // The map, then.
    }
  }, []);
  const setView = (v: View) => {
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
  // In map view the deck bar acts on the chart showing (one voicing type).
  const [chart, setChart] = useState<string | null>(null);
  // Logging a voicing heard in the wild.
  const [logging, setLogging] = useState(false);
  // A map tile tapped: its voicings in a sheet.
  const [cell, setCell] = useState<{ ids: string[]; title: string } | null>(null);
  const deckShown = useMemo(
    () => (view === 'map' && chart ? filtered.filter(v => (chart === 'two-hand' ? TWO_HAND.includes(v.family) : v.family === chart)) : filtered),
    [view, chart, filtered],
  );
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
      <VoicingFilter voicings={voicings} value={filter} onChange={changeFilter} tests={tests} total={voicings.length} shown={filtered.length} collapsible={view !== 'list'} />
      <div className="vt-seg lb-view" role="radiogroup" aria-label="View">
        {(['map', 'list', 'deck', 'found'] as const).map(m => (
          <button type="button" key={m} role="radio" aria-checked={view === m} className={view === m ? 'on' : ''} onClick={() => setView(m)}>
            {m === 'map' ? 'Map' : m === 'list' ? 'List' : m === 'deck' ? 'Deck' : 'Found'}
          </button>
        ))}
      </div>

      {/* The map first, the deck's buttons after it; the list keeps them on top, with New voicing. */}
      {view === 'map' && <ProgressMap voicings={filtered} srs={srs} stats={stats} settings={settings} onOpen={setOpen} onOpenCell={(ids, title) => setCell({ ids, title })} onChart={setChart} />}
      {view !== 'found' && view !== 'deck' && canEdit && <DeckBar shown={deckShown} />}
      {view === 'deck' && <DeckView voicings={filtered} onOpen={setOpen} />}
      {canEdit && view === 'list' && (
        <button type="button" className="vt-secondary lb-new" onClick={() => setAdding(true)}>
          + New voicing
        </button>
      )}

      {view === 'found' && <FoundView onLog={() => setLogging(true)} onOpen={setOpen} />}
      {view !== 'list' ? null : (
        <div className="lb-groups">
          {groups.map(([label, vs]) => (
            <section key={label} className="lb-group">
              <h3 className="lb-group-h">
                {prettyLabel(label)} <span>{vs.length}</span>
              </h3>
              <VoicingGrid voicings={vs} onOpen={setOpen} />
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

      {cell && <CellSheet ids={cell.ids} title={cell.title} onClose={() => setCell(null)} onOpen={setOpen} />}
      {openV && <VoicingDetail v={openV} onClose={() => setOpen(null)} onOpen={setOpen} />}
      {adding && <NewVoicing onClose={() => setAdding(false)} onCreated={id => { setAdding(false); setOpen(id); }} />}
      {logging && (
        <NewVoicing
          found
          onClose={() => setLogging(false)}
          onCreated={id => {
            setLogging(false);
            setView('found');
            setOpen(id);
          }}
        />
      )}
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

export function VoicingCard({
  v,
  status,
  gap,
  inDeck,
  canEdit,
  onOpen,
}: {
  v: Voicing;
  /** Per mode, in MODES order. */
  status: CardStatus[];
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
          {v.top_move ? <b className="vk-move-txt"> → {pretty(pitchName(v.top_move))}</b> : ''}
        </span>
        <span className="lb-meta">
          <span className="lb-fam">{familyLabel(v.family)}</span>
          <span className={`lb-flag lb-flag-root ${hasRoot(v) ? 'has' : ''}`}>{hasRoot(v) ? 'has root' : 'rootless'}</span>
          {v.tags.includes('iii') && <span className="lb-flag lb-flag-iii" title="For a iii: the 8 for the 9">iii · no 9</span>}
          {muddy && <span className="lb-flag">muddy</span>}
          {gap && <span className="lb-flag lb-flag-gap" title="Fast in context, slow on its own">gap</span>}
          {inDeck && (
            <span className="lb-learned" title={MODES.map((md, i) => `${MODE_LABEL[md]}: ${status[i]}`).join(' · ')}>
              {status.map((st, i) => (
                <i key={i} className={`lb-st-${st}`} />
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

export function VoicingDetail({ v, onClose, onOpen }: { v: Voicing; onClose: () => void; onOpen?: (id: string) => void }) {
  const t = useTrainer();
  useBackClose(true, onClose);
  const { canEdit, srs } = t;
  const deckIn = MODES.some(m => srs.has(srsKey(v.id, m)));
  const pair = partnersOf(t.voicings, v).filter(o => o.id !== v.id);
  const dimFamily = useDimFamily(v);
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
            {familyLabel(v.family)} · {hasRoot(v) ? 'has root' : 'rootless'} · top {pretty(pitchName(v.top_note))}
            {v.tags.includes('iii') ? ' · as iii (8 for 9)' : ''}
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
            labels={{ ...labels, ...(mv != null ? { [mv]: pretty(pitchName(v.top_move!)) } : {}) }}
          />
        </div>
        <p className="dt-notes">
          {v.notes.map(pretty).join('  ')}
          {v.top_move ? <b className="vk-move-txt">  → {pretty(v.top_move)}</b> : ''}
        </p>
        {v.top_move && <span className="vt-hint">The top voice moves from {pretty(pitchName(v.top_note))} to {pretty(pitchName(v.top_move))} after the chord: Play and Spell ask for the move too.</span>}
        {v.source_url || v.source_label || v.source_tune_id ? <SourceLine v={v} /> : null}
        {dimFamily && <DimFamily v={v} fam={dimFamily} onOpen={onOpen} />}

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

        <Retention v={v} />

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

function NewVoicing({ onClose, onCreated, found = false }: { onClose: () => void; onCreated: (id: string) => void; found?: boolean }) {
  useBackClose(true, onClose);
  const t = useTrainer();
  const [root, setRoot] = useState(0);
  const [quality, setQuality] = useState<Quality>('maj7');
  const [family, setFamily] = useState(found ? FOUND : 'custom');
  // Heard in the wild: where, when, what song, and a note.
  const [srcUrl, setSrcUrl] = useState('');
  const [srcTime, setSrcTime] = useState('');
  const [srcLabel, setSrcLabel] = useState('');
  const [noteText, setNoteText] = useState('');
  // The standard it belongs to (the owner: "attachable to a standard as well").
  const [tune, setTune] = useState<{ id: string; title: string } | null>(null);
  const src = srcUrl.trim() ? readSource(srcUrl) : null;
  const time = srcTime.trim() ? parseTime(srcTime) : src?.time ?? null;
  const onUrl = (u: string) => {
    setSrcUrl(u);
    // A link that carries its time fills the time in.
    const r = u.trim() ? readSource(u) : null;
    if (r?.time != null && !srcTime.trim()) setSrcTime(formatTime(r.time));
  };
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
      tags: [...new Set([...tags, ...(found ? ['found'] : []), `${spelled.notes.length}-note`])],
      lowest_register: null,
      notes_text: found ? noteText.trim() || null : null,
      sort_order: 30000 + t.voicings.length,
      updated_at: new Date().toISOString(),
      ...(found
        ? {
            source_url: src ? srcUrl.trim() : null,
            source_time: src ? time : null,
            source_label: srcLabel.trim() || null,
            source_tune_id: tune?.id ?? null,
            source_tune_title: tune?.title ?? null,
          }
        : {}),
    });
    onCreated(id);
  };

  return (
    <div className="vt-modal" role="dialog" aria-modal="true" aria-label={found ? 'log a voicing you heard' : 'new voicing'} onClick={onClose}>
      <div className="vt-sheet" onClick={e => e.stopPropagation()}>
        <div className="vt-sheet-head">
          <h2>{found ? 'Log a voicing you heard' : 'New voicing'}</h2>
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
          {!found && (
            <label className="vt-field vt-field-inline">
              <span className="vt-field-lbl">Family</span>
              <input className="vt-input" value={family} onChange={e => setFamily(e.target.value)} />
            </label>
          )}
        </div>
        {found && (
          <div className="fd-src">
            <TuneSearch value={tune} onPick={setTune} />
            <label className="vt-field">
              <span className="vt-field-lbl">Recording (who, what)</span>
              <input className="vt-input" value={srcLabel} onChange={e => setSrcLabel(e.target.value)} placeholder="Bill Evans — Peace Piece" />
            </label>
            <label className="vt-field">
              <span className="vt-field-lbl">Link (YouTube or Spotify)</span>
              <input className="vt-input" inputMode="url" value={srcUrl} onChange={e => onUrl(e.target.value)} placeholder="https://youtu.be/… or https://open.spotify.com/track/…" />
            </label>
            <div className="vt-row2">
              <label className="vt-field vt-field-inline">
                <span className="vt-field-lbl">At</span>
                <input className="vt-input fd-time" inputMode="numeric" value={srcTime} onChange={e => setSrcTime(e.target.value)} placeholder="1:23" />
              </label>
              <span className="vt-hint fd-src-hint">
                {srcUrl.trim() && !src
                  ? 'That isn’t a link.'
                  : src
                    ? `${SOURCE_NAME[src.kind]}${time != null ? ` at ${formatTime(time)}` : ''}${src.kind === 'youtube' && time != null ? ' — it’ll open right there' : ''}`
                    : 'A YouTube link opens at the time; a Spotify one shows it.'}
              </span>
            </div>
            {srcTime.trim() && time == null && <span className="vt-error">Write the time as 1:23.</span>}
          </div>
        )}
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
        {found && (
          <label className="vt-field">
            <span className="vt-field-lbl">Note</span>
            <textarea className="vt-input" rows={2} value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Left hand plays the 3 and 7; the top note is the melody…" />
          </label>
        )}
        <label className="vt-field">
          <span className="vt-field-lbl">Tags (comma separated)</span>
          <input className="vt-input" value={tagText} onChange={e => setTagText(e.target.value)} placeholder="rootless, left-hand" />
        </label>
        {dup && <p className="vt-error">That voicing is already in your voicings.</p>}
        <div className="vt-inline">
          <button type="button" className="vt-primary" disabled={!spelled || midis.length < 2 || !!dup || (srcTime.trim() !== '' && time == null)} onClick={create}>
            {found ? 'Log it' : 'Add voicing'}
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

// ── the diminished family ────────────────────────────────────────────────

const DIM_KIN = new Set(['7b9', 'dim7']);
const pcsOf = (x: Voicing) => [...new Set(x.notes.map(n => noteMidi(n) % 12))].sort((a, b) => a - b).join(',');
const keysOf = (x: Voicing) => x.notes.map(noteMidi).join(',');

interface DimFamilyView {
  /** Voicings on exactly these keys under another name. */
  same: Voicing[];
  /** The family's chords by quality, each with the voicing to open for it. */
  dims: { label: string; open: Voicing }[];
  doms: { label: string; open: Voicing }[];
  /** Every 7♭9 and °7 voicing of this type on these four notes. */
  all: Voicing[];
}

/**
 * A 7♭9 or °7 voicing's family (the owner: "connect this to the dominant 4
 * chords that have the same rootless shape"): its four notes are a °7, which
 * names four diminished chords and voices four 7♭9s (a major third below each
 * note), all on one hand shape. Not linked in the deck — each is its own chord.
 */
function useDimFamily(v: Voicing): DimFamilyView | null {
  const t = useTrainer();
  return useMemo(() => {
    if (!DIM_KIN.has(v.quality)) return null;
    const mine = pcsOf(v);
    const keys = keysOf(v);
    const all = t.voicings.filter(o => DIM_KIN.has(o.quality) && o.family === v.family && pcsOf(o) === mine);
    const pick = (q: string) => {
      const labels = [...new Set(all.filter(o => o.quality === q).map(o => o.chord_label))];
      const order = (l: string) => CYCLE_OF_FOURTHS.indexOf(all.find(o => o.chord_label === l)!.root);
      return labels
        .sort((a, b) => order(a) - order(b))
        .map(label => {
          const vs = all.filter(o => o.chord_label === label);
          return { label, open: vs.find(o => keysOf(o) === keys) ?? vs[0] };
        });
    };
    return { same: all.filter(o => o.id !== v.id && keysOf(o) === keys), dims: pick('dim7'), doms: pick('7b9'), all };
  }, [t.voicings, v]);
}

function DimFamily({ v, fam, onOpen }: { v: Voicing; fam: DimFamilyView; onOpen?: (id: string) => void }) {
  const t = useTrainer();
  const inDeck = (id: string) => MODES.some(m => t.srs.has(srsKey(id, m)));
  const out = fam.all.filter(o => !inDeck(o.id));
  const chip = (label: string, o: Voicing) => (
    <button
      type="button"
      key={label}
      className={`df-chip ${o.chord_label === v.chord_label ? 'on' : ''} ${inDeck(o.id) ? 'in' : ''}`}
      disabled={!onOpen || o.id === v.id}
      onClick={() => onOpen?.(o.id)}
      title={inDeck(o.id) ? 'In your deck' : 'Not in your deck'}
    >
      {prettyLabel(label)}
    </button>
  );
  return (
    <section className="df" aria-label="Diminished family">
      <span className="vt-field-lbl">Diminished family — one hand shape</span>
      {fam.same.length > 0 && (
        <p className="vt-hint">
          Same keys as {fam.same.map(o => prettyLabel(o.chord_label)).join(', ')}.
        </p>
      )}
      <div className="df-row">
        <span className="df-q">°7</span>
        {fam.dims.map(d => chip(d.label, d.open))}
      </div>
      <div className="df-row">
        <span className="df-q">7♭9</span>
        {fam.doms.map(d => chip(d.label, d.open))}
      </div>
      <p className="vt-hint">These four notes are a °7 on any of them, and a rootless 7♭9 a major third below any of them. Tap one to see it; underlined ones are in your deck.</p>
      {t.canEdit && out.length > 0 && (
        <button type="button" className="vt-secondary" onClick={() => void t.addToDeck(out.map(o => o.id))}>
          + Add the whole family to my deck ({out.length} voicing{out.length === 1 ? '' : 's'})
        </button>
      )}
    </section>
  );
}

/**
 * Voicing cards with each pair of inversions framed together (the owner:
 * "make it more obvious when cards are connected by an inversion"; their pick,
 * "rails with rounded lines"): each card's thick bottom edge forks, with
 * rounded corners, into one deck button for them all, since they're added and
 * removed together. A voicing with no partner stands alone with its own button.
 */
export function VoicingGrid({ voicings, onOpen }: { voicings: Voicing[]; onOpen: (id: string) => void }) {
  const t = useTrainer();
  const { gapKeys } = useCardStats();
  const inDeck = (id: string) => MODES.some(m => t.srs.has(srsKey(id, m)));
  // Partners (same chord, same voicing type), in the order they come.
  const groups: Voicing[][] = [];
  const at = new Map<string, number>();
  for (const v of voicings) {
    const k = `${v.chord_label}|${v.family}|${v.tags.includes('iii')}`;
    if (!at.has(k)) {
      at.set(k, groups.length);
      groups.push([]);
    }
    groups[at.get(k)!].push(v);
  }
  const card = (v: Voicing, ownButton: boolean) => (
    <VoicingCard
      key={v.id}
      v={v}
      inDeck={inDeck(v.id)}
      canEdit={t.canEdit && ownButton}
      status={MODES.map(m => cardStatus(t.srs.get(srsKey(v.id, m)), gapKeys.has(srsKey(v.id, m))))}
      gap={MODES.some(m => gapKeys.has(srsKey(v.id, m)))}
      onOpen={() => onOpen(v.id)}
    />
  );
  return (
    <div className="lb-cards">
      {groups.map(g => {
        if (g.length < 2) return card(g[0], true);
        const all = g.every(v => inDeck(v.id));
        return (
          <div key={g[0].id} className={`lb-pair ${all ? 'lb-pair-in' : ''} ${g.length > 2 ? 'lb-pair-grid' : ''}`} role="group" aria-label={`${g[0].chord_label} ${g[0].family}: ${g.length} inversions, in the deck together`}>
            <div className="lb-pair-cards">{g.map(v => card(v, false))}</div>
            <div className="lb-rail" aria-hidden />
            {t.canEdit && (
              <button
                type="button"
                className={`lb-deck lb-pair-deck ${all ? 'on' : ''}`}
                aria-pressed={all}
                onClick={() => void (all ? t.removeFromDeck(g.map(v => v.id)) : t.addToDeck(g.map(v => v.id)))}
              >
                {g.length === 2 ? (all ? '✓ Both in deck' : '+ Deck both') : all ? `✓ All ${g.length} in deck` : `+ Deck all ${g.length}`}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * A map tile's voicings — one chord in one key, both names of a black key — to
 * see them and put them in the deck (inversions on their rails, as in the list).
 */
function CellSheet({ ids, title, onClose, onOpen }: { ids: string[]; title: string; onClose: () => void; onOpen: (id: string) => void }) {
  const t = useTrainer();
  useBackClose(true, onClose);
  const vs = ids.map(id => t.voicings.find(v => v.id === id)).filter((v): v is Voicing => !!v).sort((a, b) => a.sort_order - b.sort_order);
  const labels = [...new Set(vs.map(v => v.chord_label))];
  return (
    <div className="vt-modal" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="vt-sheet pk-sheet" onClick={e => e.stopPropagation()}>
        <div className="vt-sheet-head">
          <h2>{title}</h2>
          <span className="vt-hint">
            {vs.length} voicing{vs.length === 1 ? '' : 's'} · {vs.filter(v => MODES.some(m => t.srs.has(srsKey(v.id, m)))).length} in your deck
          </span>
          <button type="button" className="vt-x" onClick={onClose} aria-label="close">
            ×
          </button>
        </div>
        {labels.map(label => (
          <section key={label} className="pk-chord">
            {labels.length > 1 && <h3>{prettyLabel(label)}</h3>}
            <VoicingGrid voicings={vs.filter(v => v.chord_label === label)} onOpen={onOpen} />
          </section>
        ))}
      </div>
    </div>
  );
}

/** Where a found voicing was heard: the song, and a link that opens at the time (YouTube) or shows it (Spotify). */
export function SourceLine({ v }: { v: Voicing }) {
  const src = v.source_url ? readSource(v.source_url) : null;
  const at = v.source_time != null ? formatTime(v.source_time) : null;
  return (
    <>
    {v.source_tune_title && (
      <span className="fd-tune">
        <span aria-hidden>𝄞</span> {v.source_tune_title}
      </span>
    )}
    {(v.source_url || v.source_label) && (
    <div className="fd-line">
      <span className="fd-ear" aria-hidden>
        ♪
      </span>
      <span className="fd-what">
        <b>{v.source_label || 'Heard in the wild'}</b>
        {at && <span> at {at}</span>}
      </span>
      {v.source_url && src && (
        <a className="fd-open" href={sourceHref(v.source_url, v.source_time)} target="_blank" rel="noreferrer">
          ▶ {SOURCE_NAME[src.kind]}
          {src.kind !== 'youtube' && at ? ` · ${at}` : ''}
        </a>
      )}
    </div>
    )}
    </>
  );
}

/** Pick a standard (or one of the owner's iFake Pro songs) by name. */
function TuneSearch({ value, onPick }: { value: { id: string; title: string } | null; onPick: (t: { id: string; title: string } | null) => void }) {
  const t = useTrainer();
  const [tunes, setTunes] = useState<{ id: string; title: string; sub: string }[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => {
    void t.loadTunes().then(list =>
      setTunes([
        ...t.charts.flatMap(p => p.songs.map(s => ({ id: s.id, title: s.title, sub: `iFake Pro · ${p.title}` }))),
        ...list.map(x => ({ id: x.id, title: x.title, sub: x.composer ?? '' })),
      ]),
    );
  }, [t.loadTunes, t.charts]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = q.trim().toLowerCase();
  const hits = s ? tunes.filter(x => x.title.toLowerCase().includes(s)).slice(0, 8) : [];
  return (
    <div className="vt-field">
      <span className="vt-field-lbl">Standard (optional)</span>
      {value ? (
        <span className="fd-picked">
          <span aria-hidden>𝄞</span> <b>{value.title}</b>
          <button type="button" onClick={() => onPick(null)} aria-label="remove the standard">
            ×
          </button>
        </span>
      ) : (
        <>
          <input className="vt-input" value={q} onChange={e => setQ(e.target.value)} placeholder={tunes.length ? `Search ${tunes.length.toLocaleString()} tunes` : 'Tunes download with the next sync'} />
          {hits.length > 0 && (
            <ul className="pr-hits">
              {hits.map(x => (
                <li key={x.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick({ id: x.id, title: x.title });
                      setQ('');
                    }}
                  >
                    <b>{x.title}</b> <span>{x.sub}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Voicings heard in the wild (the owner: "log extra voicings I hear in the wild … linked to a certain
 * time in a YouTube video or a Spotify song"), newest first, each with where it came from.
 */
function FoundView({ onLog, onOpen }: { onLog: () => void; onOpen: (id: string) => void }) {
  const t = useTrainer();
  const all = t.voicings.filter(v => v.family === FOUND).sort((a, b) => b.sort_order - a.sort_order);
  // Narrowed to one standard, if one's picked.
  const [tune, setTune] = useState<string | null>(null);
  const tunes = [...new Map(all.filter(v => v.source_tune_id).map(v => [v.source_tune_id!, v.source_tune_title ?? v.source_tune_id!])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const found = tune ? all.filter(v => v.source_tune_id === tune) : all;
  return (
    <section className="fd">
      {t.canEdit && (
        <button type="button" className="fd-log" onClick={onLog}>
          <span aria-hidden>♪</span>
          <span>
            <b>Log a voicing you heard</b>
            <span>In a song or a video — with the link and the time, so you can go back to it.</span>
          </span>
        </button>
      )}
      {tunes.length > 0 && (
        <div className="fd-tunes" role="group" aria-label="By standard">
          <button type="button" className={tune == null ? 'on' : ''} onClick={() => setTune(null)}>
            All {all.length}
          </button>
          {tunes.map(([id, title]) => (
            <button type="button" key={id} className={tune === id ? 'on' : ''} onClick={() => setTune(tune === id ? null : id)}>
              𝄞 {title} <span>{all.filter(v => v.source_tune_id === id).length}</span>
            </button>
          ))}
        </div>
      )}
      {!found.length ? (
        <p className="vt-empty">Nothing logged yet. Heard a voicing you love? Log it here, with where you heard it.</p>
      ) : (
        <div className="fd-list">
          {found.map(v => (
            <div key={v.id} className="fd-item">
              <h3 className="lb-group-h">{prettyLabel(v.chord_label)}</h3>
              <SourceLine v={v} />
              {v.notes_text && <p className="fd-note">{v.notes_text}</p>}
              <VoicingGrid voicings={[v]} onOpen={onOpen} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * The deck to look through (the owner: "a way to explore all the cards in my
 * deck"): a playing card per chord — its inversions stacked, its modes as
 * tabs — under its most urgent mode's status: Shaky (weakest first), Due a
 * check, New (in the order added), Solid (next check soonest first), narrowed
 * by the filter above and a mode. Tap one for its page.
 */
function DeckView({ voicings, onOpen }: { voicings: Voicing[]; onOpen: (id: string) => void }) {
  const t = useTrainer();
  const { grouped, gapKeys } = useCardStats();
  const [mode, setMode] = useState<Mode | 'all'>('all');
  const groups = useMemo(
    () =>
      deckGroups({
        pool: voicings,
        srs: t.srs,
        grouped,
        gapKeys,
        modes: mode === 'all' ? [...MODES] : [mode],
        targetOf: (v, m) => targetFor(t.srs.get(srsKey(v.id, m)), m, t.settings),
      }),
    [voicings, t.srs, t.settings, grouped, gapKeys, mode],
  );
  const now = Date.now();
  // One card per chord, each mode a tab: shaky, due a check, new, or solid (with its next check).
  const chords = useMemo(() => {
    const score = new Map<string, number>();
    const added = new Map<string, string>();
    const entries = groups.flatMap(g => {
      const k = g.group.slice(0, g.group.lastIndexOf('|'));
      score.set(k, Math.min(score.get(k) ?? 1, g.status === 'shaky' ? g.score : 1));
      if (!added.has(k) || g.added < added.get(k)!) added.set(k, g.added);
      const state: ModeState = g.status === 'solid' ? (g.at <= now ? 'check' : 'solid') : g.status;
      return g.cards.map(card => ({ card, state, at: g.at }));
    });
    return chordCards(entries).map(c => ({ c, score: score.get(c.key) ?? 1, added: added.get(c.key) ?? '' }));
  }, [groups]); // eslint-disable-line react-hooks/exhaustive-deps
  const short = (at: number) => relTime(new Date(at).toISOString()).replace(/ days?/, 'd').replace(/ hours?/, 'h').replace(/ minutes?/, 'm');
  type Row = (typeof chords)[number];
  const sections: { key: string; title: string; hint: string; list: Row[]; foot?: (r: Row) => string }[] = [
    { key: 'shaky', title: 'Shaky', hint: 'lead your next sets, weakest first', list: chords.filter(r => worstOf(r.c) === 'shaky').sort((a, b) => a.score - b.score) },
    { key: 'check', title: 'Due a check', hint: 'in your next set', list: chords.filter(r => worstOf(r.c) === 'check') },
    { key: 'new', title: 'New', hint: 'join two at a time', list: chords.filter(r => worstOf(r.c) === 'new').sort((a, b) => a.added.localeCompare(b.added)) },
    { key: 'solid', title: 'Solid', hint: 'next check soonest first', list: chords.filter(r => worstOf(r.c) === 'solid').sort((a, b) => (a.c.at ?? 0) - (b.c.at ?? 0)), foot: r => (r.c.at ? short(r.c.at) : 'solid') },
  ];
  const cards = groups.reduce((n, g) => n + g.cards.length, 0);
  return (
    <div className="dk">
      <div className="dk-head">
        <p className="dk-count">
          <b>{chords.length}</b> chord{chords.length === 1 ? '' : 's'} · {cards} card{cards === 1 ? '' : 's'}
        </p>
        <p className="rv-legend dk-key">
          <ModeKey />
        </p>
        <div className="vt-seg dk-modes" role="radiogroup" aria-label="Mode">
          {(['all', ...MODES] as const).map(m => (
            <button type="button" key={m} role="radio" aria-checked={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
              {m === 'all' ? 'All' : MODE_LABEL[m]}
            </button>
          ))}
        </div>
      </div>
      {!groups.length ? (
        <p className="vt-empty">Nothing in your deck{voicings.length < t.voicings.length ? ' with this filter' : ''} yet — add voicings from the Map or the List.</p>
      ) : (
        sections
          .filter(sec => sec.list.length)
          .map(sec => (
            <section key={sec.key} className={`dk-sec dk-${sec.key}`}>
              <h3 className="lb-group-h">
                {sec.title} <span>{sec.list.length}</span>
                <em>{sec.hint}</em>
              </h3>
              <ul className="rv-set">
                {sec.list.map(r => (
                  <PlayingCard key={r.c.key} c={r.c} foot={sec.foot?.(r)} onOpen={onOpen} />
                ))}
              </ul>
            </section>
          ))
      )}
    </div>
  );
}
