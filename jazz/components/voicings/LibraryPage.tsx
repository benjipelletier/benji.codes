'use client';

// Voicing Library: browse, search and filter every voicing by chord, key,
// family and tag, grouped by chord. Open one to see it on the keyboard, edit
// its tags, mark it muddy, set its lowest playable register, set a card's
// target time, and see its stats per mode — accuracy, average time, and
// isolated against in-context speed.

import { useMemo, useState } from 'react';
import { Keyboard, rangeAround } from './Keyboard';
import { fmtPct, fmtSecs, relTime, useCardStats } from './TrainerShell';
import { newId, useTrainer } from './TrainerProvider';
import { midisOf } from '@jazz/lib/voicings/practice';
import { newState, targetFor } from '@jazz/lib/voicings/srs';
import { chordLabel, midiName, PC_FLAT, pitchName, pretty, QUALITIES, QUALITY, spellMidis, type Quality } from '@jazz/lib/voicings/theory';
import { MODES, MODE_LABEL, srsKey, type Voicing } from '@jazz/lib/voicings/types';

const PAGE = 120;

export function LibraryPage() {
  const t = useTrainer();
  const { voicings, srs, canEdit } = t;
  const { gapKeys } = useCardStats();
  const [q, setQ] = useState('');
  const [root, setRoot] = useState<number | null>(null);
  const [quality, setQuality] = useState<Quality | ''>('');
  const [family, setFamily] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [gapOnly, setGapOnly] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const families = useMemo(() => [...new Set(voicings.map(v => v.family))].sort(), [voicings]);
  const allTags = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of voicings) for (const tag of v.tags) m.set(tag, (m.get(tag) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [voicings]);
  const qualities = useMemo(() => QUALITIES.filter(x => voicings.some(v => v.quality === x.id)), [voicings]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/♭/g, 'b').replace(/♯/g, '#');
    return voicings.filter(v => {
      if (root != null && v.root !== root) return false;
      if (quality && v.quality !== quality) return false;
      if (family && v.family !== family) return false;
      if (!tags.every(tag => v.tags.includes(tag))) return false;
      if (gapOnly && !MODES.some(m => gapKeys.has(srsKey(v.id, m)))) return false;
      if (s) {
        const hay = `${v.chord_label} ${v.family} ${v.tags.join(' ')} ${v.notes.map(pitchName).join(' ')} ${v.notes_text ?? ''}`.toLowerCase();
        if (!s.split(/\s+/).every(w => hay.includes(w))) return false;
      }
      return true;
    });
  }, [voicings, q, root, quality, family, tags, gapOnly, gapKeys]);

  // Voicings of the same chord together, in library order.
  const groups = useMemo(() => {
    const out = new Map<string, Voicing[]>();
    for (const v of filtered.slice(0, shown)) {
      let g = out.get(v.chord_label);
      if (!g) out.set(v.chord_label, (g = []));
      g.push(v);
    }
    return [...out];
  }, [filtered, shown]);

  const openV = open ? voicings.find(v => v.id === open) ?? null : null;

  return (
    <div className="vt-page">
      <section className="lb-filters">
        <input className="vt-input lb-search" placeholder="Search: Fm7, drop-2, Eb, muddy…" value={q} onChange={e => { setQ(e.target.value); setShown(PAGE); }} />
        <div className="lb-selects">
          <select value={root ?? ''} onChange={e => setRoot(e.target.value === '' ? null : Number(e.target.value))} aria-label="key">
            <option value="">any key</option>
            {PC_FLAT.map((n, pc) => (
              <option key={pc} value={pc}>
                {pretty(n)}
              </option>
            ))}
          </select>
          <select value={quality} onChange={e => setQuality(e.target.value as Quality | '')} aria-label="chord">
            <option value="">any chord</option>
            {qualities.map(x => (
              <option key={x.id} value={x.id}>
                {x.display}
              </option>
            ))}
          </select>
          <select value={family} onChange={e => setFamily(e.target.value)} aria-label="family">
            <option value="">any family</option>
            {families.map(f => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <label className="vt-check">
            <input type="checkbox" checked={gapOnly} onChange={e => setGapOnly(e.target.checked)} />
            context gap only
          </label>
        </div>
        <div className="vt-chips">
          {allTags.map(([tag, n]) => (
            <button type="button" key={tag} className={tags.includes(tag) ? 'vt-chip on' : 'vt-chip'} onClick={() => setTags(tags.includes(tag) ? tags.filter(x => x !== tag) : [...tags, tag])}>
              {tag} <span>{n}</span>
            </button>
          ))}
        </div>
        <div className="lb-count">
          <span>
            {filtered.length} of {voicings.length} voicings
          </span>
          {canEdit && (
            <button type="button" className="vt-secondary" onClick={() => setAdding(true)}>
              + New voicing
            </button>
          )}
        </div>
      </section>

      <div className="lb-groups">
        {groups.map(([label, vs]) => (
          <section key={label} className="lb-group">
            <h3 className="lb-group-h">
              {pretty(label)} <span>{vs.length}</span>
            </h3>
            <div className="lb-cards">
              {vs.map(v => (
                <VoicingCard key={v.id} v={v} learned={MODES.map(m => !!srs.get(srsKey(v.id, m))?.learned)} gap={MODES.some(m => gapKeys.has(srsKey(v.id, m)))} onOpen={() => setOpen(v.id)} />
              ))}
            </div>
          </section>
        ))}
        {filtered.length > shown && (
          <button type="button" className="vt-secondary lb-more" onClick={() => setShown(s => s + PAGE * 2)}>
            Show more ({filtered.length - shown} left)
          </button>
        )}
        {!filtered.length && <p className="vt-empty">No voicings match.</p>}
      </div>

      {openV && <VoicingDetail v={openV} onClose={() => setOpen(null)} />}
      {adding && <NewVoicing onClose={() => setAdding(false)} onCreated={id => { setAdding(false); setOpen(id); }} />}
    </div>
  );
}

function VoicingCard({ v, learned, gap, onOpen }: { v: Voicing; learned: boolean[]; gap: boolean; onOpen: () => void }) {
  const m = midisOf(v);
  const [lo, hi] = rangeAround(m, 10);
  const muddy = v.tags.includes('muddy');
  return (
    <button type="button" className={`lb-card ${muddy ? 'lb-muddy' : ''}`} onClick={onOpen}>
      <Keyboard compact low={lo} high={hi} marks={Object.fromEntries(m.map(x => [x, 'on']))} />
      <span className="lb-notes">{v.notes.map(n => pretty(pitchName(n))).join(' ')}</span>
      <span className="lb-meta">
        <span className="lb-fam">{v.family}</span>
        {muddy && <span className="lb-flag">muddy</span>}
        {gap && <span className="lb-flag lb-flag-gap" title="Fast in context, slow on its own">gap</span>}
        <span className="lb-learned" title={MODES.map((md, i) => `${MODE_LABEL[md]}: ${learned[i] ? 'learned' : 'not yet'}`).join(' · ')}>
          {learned.map((l, i) => (
            <i key={i} className={l ? 'on' : ''} />
          ))}
        </span>
      </span>
    </button>
  );
}

function VoicingDetail({ v, onClose }: { v: Voicing; onClose: () => void }) {
  const t = useTrainer();
  const { canEdit, srs, settings } = t;
  const { stats, gapKeys } = useCardStats();
  const [tagDraft, setTagDraft] = useState('');
  const [notesDraft, setNotesDraft] = useState(v.notes_text ?? '');
  const m = midisOf(v);
  const [lo, hi] = rangeAround(m, 15);
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
          <h2>{pretty(v.chord_label)}</h2>
          <span className="vt-hint">
            {v.family} · top {pretty(pitchName(v.top_note))}
          </span>
          <button type="button" className="vt-x" onClick={onClose} aria-label="close">
            ×
          </button>
        </div>
        <div className="dt-kb">
          <Keyboard low={lo} high={hi} marks={Object.fromEntries(m.map(x => [x, 'on']))} labels={labels} />
        </div>
        <p className="dt-notes">{v.notes.map(pretty).join('  ')}</p>

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
                      disabled={!canEdit}
                      value={target / 1000}
                      onChange={e => {
                        const ms = Math.round(Number(e.target.value) * 1000);
                        if (ms < 500) return;
                        const base = st ?? newState(v.id, md, new Date());
                        void t.saveSrs([{ ...base, target_ms: ms === settings.target_ms[md] ? null : ms, updated_at: new Date().toISOString(), dirty: true }]);
                      }}
                    />
                    s
                  </td>
                  <td>{st ? relTime(st.due_at) : 'new'}</td>
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
          <span>{spelled ? `${pretty(label)}: ${spelled.notes.map(pretty).join(' ')}` : 'no notes yet'}</span>
          <button type="button" onClick={() => setLo(l => Math.min(84, l + 12))}>
            8va ▶
          </button>
        </div>
        <label className="vt-field">
          <span className="vt-field-lbl">Tags (comma separated)</span>
          <input className="vt-input" value={tagText} onChange={e => setTagText(e.target.value)} placeholder="rootless, left-hand" />
        </label>
        {dup && <p className="vt-error">That voicing is already in the library.</p>}
        <div className="vt-inline">
          <button type="button" className="vt-primary" disabled={!spelled || midis.length < 2 || !!dup} onClick={create}>
            Add to library
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
