'use client';

// Practice in Context: pick a set, then a timed run through it. In a
// progression or a tune you step through the chords in order, each voicing
// the one that moves least from the last. Every run is saved, so a set's
// speed can be compared over time; the cards right but slow (and the
// misses) go into the next review.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CardRunner, type RunnerResult, type RunnerStep } from './CardRunner';
import { Summary } from './ReviewPage';
import { fmtPct, fmtSecs, relTime } from './TrainerShell';
import { VoicingDetail, VoicingGrid } from './VoicingsPage';
import { newId, useTrainer } from './TrainerProvider';
import { buildSet, type OrderEntry, type SetSource, type SetSpec, type Skipped } from '@voiceshed/lib/practice';
import { dueNow, targetFor } from '@voiceshed/lib/srs';
import { keyLabel, PC_FLAT, pretty, prettyLabel } from '@voiceshed/lib/theory';
import { MODES, MODE_LABEL, srsKey, type ChartPlaylist, type ChartTune, type Mode, type Run, type SrsState, type Tune, type Voicing } from '@voiceshed/lib/types';

const SOURCES: { id: SetSource; label: string; hint: string }[] = [
  { id: 'ii-v-i', label: 'ii–V–Is', hint: 'Major and minor, in one key or all twelve.' },
  { id: 'key', label: 'One key', hint: 'The diatonic chords of a major key, shuffled.' },
  { id: 'tune', label: 'A tune', hint: 'Search the standards and your iFake Pro songs; the changes in order, in any key.' },
  { id: 'charts', label: 'My charts', hint: 'A song from your iFake Pro playlists, in order, in any key.' },
];

/** Which voicings a set uses (the owner: "just switch between right-hand rootless and drop-2s"), as the tag each type carries. */
const TYPES: { tag: string; label: string }[] = [
  { tag: 'drop-2', label: 'Drop-2 two-hand' },
  { tag: 'right-hand', label: 'Right-hand rootless' },
];

const SPEC_KEY = 'vt-practice-spec';

function loadSpec(): SetSpec {
  const fallback: SetSpec = { source: 'ii-v-i', key: null, tuneId: null, tags: ['drop-2'], mode: 'play', limit: 40 };
  try {
    const raw = localStorage.getItem(SPEC_KEY);
    const spec: SetSpec = raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
    // One voicing type, drop-2 unless right-hand was picked; the tag filter set is gone.
    return { ...spec, source: spec.source === 'tags' ? 'ii-v-i' : spec.source, tags: [spec.tags?.includes('right-hand') ? 'right-hand' : 'drop-2'] };
  } catch {
    return fallback;
  }
}

export function PracticePage() {
  const t = useTrainer();
  const { voicings, contexts, settings, runs } = t;
  const [spec, setSpecState] = useState<SetSpec>(() => ({ source: 'ii-v-i', key: null, tuneId: null, tags: ['drop-2'], mode: 'play', limit: 40 }));
  const [tunes, setTunes] = useState<Tune[]>([]);
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [steps, setSteps] = useState<RunnerStep[]>([]);
  const [results, setResults] = useState<RunnerResult[]>([]);
  const [ranSet, setRanSet] = useState<{ label: string; setKey: string } | null>(null);
  const runRef = useRef<{ id: string; started: string; setKey: string; label: string; contextType: RunnerStep['context_type'] } | null>(null);

  useEffect(() => setSpecState(loadSpec()), []);
  useEffect(() => {
    void t.loadTunes().then(setTunes);
    // Tunes arrive with the first sync on a new device.
  }, [t.loadTunes, t.offline.tunesAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const setSpec = (p: Partial<SetSpec>) =>
    setSpecState(s => {
      const next = { ...s, ...p };
      try {
        localStorage.setItem(SPEC_KEY, JSON.stringify(next));
      } catch {
        // Not remembered: fine.
      }
      return next;
    });

  // Standards and the owner's iFake Pro songs, looked up the same way.
  const chartTunes = useMemo(() => t.charts.flatMap(p => p.songs), [t.charts]);
  const allTunes = useMemo<Tune[]>(() => [...chartTunes, ...tunes], [chartTunes, tunes]);
  const built = useMemo(() => buildSet(spec, { voicings, contexts, tunes: allTunes }), [spec, voicings, contexts, allTunes]);
  const isTune = spec.source === 'tune' || spec.source === 'charts';
  const skippedN = built.skipped.reduce((n, x) => n + x.count, 0);
  const history = useMemo(() => runs.filter(r => r.set_key === built.setKey).slice(-12), [runs, built.setKey]);


  const start = () => {
    const fresh = buildSet(spec, { voicings, contexts, tunes: allTunes });
    runRef.current = { id: newId(), started: new Date().toISOString(), setKey: fresh.setKey, label: fresh.label, contextType: fresh.context_type };
    setRanSet({ label: fresh.label, setKey: fresh.setKey });
    setSteps(
      fresh.steps.map(s => ({
        voicing: s.voicing,
        mode: spec.mode,
        target: targetFor(t.srs.get(srsKey(s.voicing.id, spec.mode)), spec.mode, settings),
        context_type: s.context_type,
        context_id: s.context_id,
        symbol: s.symbol,
        group: s.group,
      })),
    );
    setResults([]);
    setPhase('running');
  };

  const onAttempt = useCallback(
    (r: RunnerResult) => {
      void t.recordAttempts([
        {
          id: newId(),
          voicing_id: r.step.voicing.id,
          mode: r.step.mode,
          context_type: r.step.context_type,
          context_id: r.step.context_id,
          run_id: runRef.current?.id ?? null,
          correct: r.correct,
          slow: r.slow,
          response_ms: r.ms,
          created_at: r.at,
        },
      ]);
    },
    [t],
  );

  const onFinish = useCallback(
    (rs: RunnerResult[]) => {
      const run = runRef.current;
      setResults(rs);
      setPhase('done');
      if (!run || !rs.length) return;
      const right = rs.filter(r => r.correct);
      const avg = right.length ? Math.round(right.reduce((s, r) => s + r.ms, 0) / right.length) : 0;
      const saved: Omit<Run, 'synced' | 'local_only'> = {
        id: run.id,
        set_key: run.setKey,
        set_label: run.label,
        mode: rs[0].step.mode,
        context_type: run.contextType,
        started_at: run.started,
        finished_at: new Date().toISOString(),
        cards: rs.length,
        correct: right.length,
        avg_ms: avg,
        slow: right.filter(r => r.slow).length,
      };
      void t.saveRun(saved);
      // Right but slow, and missed: into the next review — cards in the deck
      // only. One that isn't is offered in the results, never added on its own.
      const now = new Date();
      const rows = new Map<string, SrsState>();
      for (const r of rs) {
        if (r.correct && !r.slow) continue;
        const key = srsKey(r.step.voicing.id, r.step.mode);
        const prev = rows.get(key) ?? t.srs.get(key);
        if (!prev) continue;
        rows.set(key, { ...dueNow(prev, now), dirty: true });
      }
      void t.saveSrs([...rows.values()]).then(() => t.sync());
    },
    [t],
  );

  if (phase === 'running') {
    return (
      <CardRunner
        steps={steps}
        library={voicings}
        strictSpelling={settings.strict_spelling}
        showSequence={steps[0]?.context_type !== 'isolated'}
        onAttempt={onAttempt}
        onFinish={onFinish}
      />
    );
  }
  if (phase === 'done') {
    const prev = runs.filter(r => r.set_key === ranSet?.setKey && r.id !== runRef.current?.id).slice(-1)[0];
    return <Summary results={results} onAgain={() => setPhase('idle')} extra={<RunResults results={results} label={ranSet?.label ?? ''} prev={prev} />} />;
  }

  const tune = allTunes.find(x => x.id === spec.tuneId) ?? null;
  return (
    <div className="vt-page">
      <section className="vt-panel pr-builder">
        <div className="vt-field">
          <span className="vt-field-lbl">Set</span>
          <div className="vt-seg" role="radiogroup">
            {SOURCES.map(s => (
              <button type="button" key={s.id} role="radio" aria-checked={spec.source === s.id} className={spec.source === s.id ? 'on' : ''} onClick={() => setSpec({ source: s.id, key: s.id === 'key' ? spec.key ?? 0 : spec.key })}>
                {s.label}
              </button>
            ))}
          </div>
          <span className="vt-hint">{SOURCES.find(s => s.id === spec.source)?.hint}</span>
        </div>

        {spec.source === 'tune' && <TunePicker tunes={allTunes} value={tune} onPick={x => setSpec({ tuneId: x.id, key: x.home_key })} />}
        {spec.source === 'charts' && (
          <ChartsPicker playlists={t.charts} syncedAt={t.chartsAt} value={tune?.id.startsWith('ifp-') ? (tune as ChartTune) : null} tags={spec.tags} onPick={x => setSpec({ tuneId: x.id, key: x.home_key })} />
        )}

        <div className="vt-field">
          <span className="vt-field-lbl">Key</span>
          <div className="vt-keys">
            {spec.source !== 'key' && !isTune && (
              <button type="button" className={spec.key == null ? 'on' : ''} onClick={() => setSpec({ key: null })}>
                {spec.source === 'tags' ? 'any root' : 'all'}
              </button>
            )}
            {PC_FLAT.map((_, pc) => (
              <button type="button" key={pc} className={spec.key === pc ? 'on' : ''} onClick={() => setSpec({ key: pc })}>
                {keyLabel(pc)}
                {isTune && tune?.home_key === pc ? '•' : ''}
              </button>
            ))}
          </div>
          {spec.source === 'tags' && <span className="vt-hint">For a tag filter, the key is the chord’s root.</span>}
        </div>

        <div className="vt-field">
          <span className="vt-field-lbl">Voicings</span>
          <div className="vt-seg" role="radiogroup" aria-label="Voicing type">
            {TYPES.map(ty => (
              <button type="button" key={ty.tag} role="radio" aria-checked={spec.tags.includes(ty.tag)} className={spec.tags.includes(ty.tag) ? 'on' : ''} onClick={() => setSpec({ tags: [ty.tag] })}>
                {ty.label}
              </button>
            ))}
          </div>
        </div>

        <div className="vt-row2">
          <div className="vt-field">
            <span className="vt-field-lbl">Answer by</span>
            <div className="vt-seg" role="radiogroup">
              {MODES.map(m => (
                <button type="button" key={m} role="radio" aria-checked={spec.mode === m} className={spec.mode === m ? 'on' : ''} onClick={() => setSpec({ mode: m as Mode })}>
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
          </div>
          {(spec.source === 'key' || spec.source === 'tags') && (
            <div className="vt-field">
              <span className="vt-field-lbl">Cards</span>
              <div className="vt-seg">
                {[20, 40, 0].map(n => (
                  <button type="button" key={n} className={spec.limit === n ? 'on' : ''} onClick={() => setSpec({ limit: n })}>
                    {n || 'all'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="pr-go">
          <div className="pr-preview">
            <b>{built.label}</b>
            <span>
              {built.steps.length} cards
              {built.chords > 0 && skippedN > 0 ? ` · ${skippedN} of ${built.chords} chords skipped` : ''}
            </span>
            <SkippedList skipped={built.skipped} />
            {t.canEdit && built.order.length > 0 && <ToDeck order={built.order} tags={spec.tags} what={isTune ? 'this tune’s' : 'this set’s'} title={isTune ? tune?.title ?? 'This tune' : built.label} />}
          </div>
          <button type="button" className="vt-primary" onClick={start} disabled={!built.steps.length}>
            Start run
          </button>
        </div>
      </section>

      <RunHistory runs={history} />
    </div>
  );
}

/** Several sets' chords merged, in the order they first come, counts added (a playlist's songs). */
function mergeOrders(orders: OrderEntry[][]): OrderEntry[] {
  const m = new Map<string, OrderEntry>();
  for (const o of orders)
    for (const [l, n, iii] of o) {
      const k = `${l}|${iii}`;
      const e = m.get(k);
      if (e) e[1] += n;
      else m.set(k, [l, n, iii]);
    }
  return [...m.values()];
}

/**
 * A tune's (or a whole playlist's) voicings into the deck, for learning a set:
 * all of them (with the tags picked) of every chord it plays, in its spelling,
 * or chosen one by one in a sheet — pairs come in together, as everywhere.
 */
function ToDeck({ order, tags, what, title }: { order: OrderEntry[]; tags: string[]; what: string; title: string }) {
  const t = useTrainer();
  const [choosing, setChoosing] = useState(false);
  const keys = new Set(order.map(([l, , iii]) => `${l}|${iii}`));
  const labels = new Set(order.map(([l]) => l));
  // The voicings the set plays: a iii's iii ones, every other chord's own.
  const all = t.voicings.filter(v => keys.has(`${v.chord_label}|${v.tags.includes('iii')}`) && tags.every(tag => v.tags.includes(tag)));
  const have = all.filter(v => MODES.some(m => t.srs.has(srsKey(v.id, m)))).length;
  if (!all.length) return null;
  // One obvious way in (the owner: "make choose voicings a bit more obvious"); Add all is in the sheet.
  return (
    <div className="pr-tunedeck">
      <button type="button" className="pr-choose" onClick={() => setChoosing(true)} aria-label={`Add ${what} voicings to your deck`}>
        <span className="pr-choose-icon" aria-hidden>
          +
        </span>
        <span className="pr-choose-text">
          <b>Add {what} voicings to your deck</b>
          <span>
            {labels.size} chord{labels.size === 1 ? '' : 's'} · {have} of {all.length} voicings in your deck
          </span>
        </span>
        <span className="pr-choose-go" aria-hidden>
          ›
        </span>
      </button>
      {choosing && <ChooseVoicings title={title} order={order} tags={tags} onClose={() => setChoosing(false)} />}
    </div>
  );
}

/**
 * Pick a tune's voicings one at a time: its chords in the order played, each
 * with every voicing the library has for it (tags picked), + Deck on each.
 * A voicing's other inversion comes and goes with it. Tap a voicing to see it.
 */
const BLOCK = 'closed (block)';

function ChooseVoicings({ title, order, tags, onClose }: { title: string; order: OrderEntry[]; tags: string[]; onClose: () => void }) {
  const t = useTrainer();
  const [open, setOpen] = useState<string | null>(null);
  // m7s not played as the iii can show their iii voicings too, on request (the owner: "a little hidden button").
  const [asIii, setAsIii] = useState<Set<string>>(new Set());
  const inDeck = (id: string) => MODES.some(m => t.srs.has(srsKey(id, m)));
  const ofType = (v: Voicing) => tags.every(tag => v.tags.includes(tag));
  // The voicings the set plays: a iii's iii ones only, every other chord's own (the owner: "only show
  // the iii voicing when it's the iii of that key").
  const groups = order
    .map(([label, n, iii]) => ({
      label,
      n,
      iii,
      vs: t.voicings.filter(v => v.chord_label === label && ofType(v) && v.tags.includes('iii') === iii),
      // Block chords, whatever the type picked (the owner: "add block chords to the sheet"): offered,
      // not played in runs, so outside Add all — the iii's (5 ♭7 1 ♭3 5) and the m7♭5's here…
      block: t.voicings.filter(v => v.chord_label === label && v.family === BLOCK && v.tags.includes('iii') === iii),
      // …and another m7's iii voicings, block included, behind its toggle.
      extra: iii ? [] : t.voicings.filter(v => v.chord_label === label && v.tags.includes('iii') && (ofType(v) || v.family === BLOCK)),
    }))
    .filter(g => g.vs.length);
  const total = groups.reduce((n, g) => n + g.vs.length, 0);
  const have = groups.reduce((n, g) => n + g.vs.filter(v => inDeck(v.id)).length, 0);
  const openV = open ? t.voicings.find(v => v.id === open) : null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !open && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <div className="vt-modal" role="dialog" aria-modal="true" aria-label={`Choose voicings for ${title}`} onClick={onClose}>
      <div className="vt-sheet pk-sheet" onClick={e => e.stopPropagation()}>
        <div className="vt-sheet-head">
          <h2>{title}</h2>
          <span className="vt-hint">
            {have} of {total} in your deck{tags.length ? ` · ${tags.map(tag => TYPES.find(ty => ty.tag === tag)?.label ?? tag).join(', ')}` : ''}
          </span>
          <button type="button" className="vt-x" onClick={onClose} aria-label="close">
            ×
          </button>
        </div>
        <p className="vt-hint">In the order they come. Inversions are framed together and go into the deck together.</p>
        {groups.map(g => {
          const k = g.vs.filter(v => inDeck(v.id)).length;
          return (
            <section key={`${g.label}|${g.iii}`} className="pk-chord">
              <h3>
                {prettyLabel(g.label)}
                {g.iii && <em className="pk-iii">as iii</em>}
                <span>
                  {g.n > 1 ? `×${g.n} · ` : ''}
                  {k}/{g.vs.length} in deck
                </span>
              </h3>
              <VoicingGrid voicings={g.vs} onOpen={setOpen} />
              {g.block.length > 0 && (
                <div className="pk-extra">
                  <span className="pk-sub">Block chord</span>
                  <VoicingGrid voicings={g.block} onOpen={setOpen} />
                </div>
              )}
              {g.extra.length > 0 &&
                (asIii.has(g.label) ? (
                  <div className="pk-extra">
                    <button type="button" className="pk-more" onClick={() => setAsIii(s => new Set([...s].filter(x => x !== g.label)))}>
                      Hide {prettyLabel(g.label)} as iii
                    </button>
                    <VoicingGrid voicings={g.extra} onOpen={setOpen} />
                  </div>
                ) : (
                  <button type="button" className="pk-more" onClick={() => setAsIii(s => new Set(s).add(g.label))}>
                    Show {prettyLabel(g.label)} as iii (8 for 9) ▾
                  </button>
                ))}
            </section>
          );
        })}
        <div className="pk-foot">
          {t.canEdit && total > have ? (
            <button type="button" className="vt-secondary" onClick={() => void t.addToDeck(groups.flatMap(g => g.vs).filter(v => !inDeck(v.id)).map(v => v.id))}>
              + Add all {total - have}
            </button>
          ) : (
            <span className="vt-hint">{total ? `All ${total} in your deck.` : ''}</span>
          )}
          <button type="button" className="vt-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
      {openV && (
        <div onClick={e => e.stopPropagation()}>
          <VoicingDetail v={openV} onClose={() => setOpen(null)} onOpen={setOpen} />
        </div>
      )}
    </div>
  );
}

/** The chords a run leaves out, each with how often: none of that chord type yet, or none in the tags picked. */
function SkippedList({ skipped }: { skipped: Skipped[] }) {
  if (!skipped.length) return null;
  const groups: [Skipped['why'], string][] = [
    ['no-voicing', 'Skipped — no voicing yet'],
    ['tags', 'Skipped — none of this voicing type yet'],
  ];
  return (
    <div className="pr-skipped">
      {groups.map(([why, title]) => {
        const list = skipped.filter(x => x.why === why);
        if (!list.length) return null;
        return (
          <div key={why} className="pr-skipped-group">
            <span className="vt-field-lbl">{title}</span>
            <div className="pr-skipped-chips">
              {list.map(x => (
                <span key={x.symbol} className="pr-skip">
                  {x.symbol}
                  {x.count > 1 && <em>×{x.count}</em>}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The owner's iFake Pro playlists, each song with how many of its chords the
 * library plays (exact chords only, in its written key), a link to the chart,
 * and the playlist's voicings into the deck in one go — for a show's set.
 */
function ChartsPicker({ playlists, syncedAt, value, tags, onPick }: { playlists: ChartPlaylist[]; syncedAt: string | null; value: ChartTune | null; tags: string[]; onPick: (t: ChartTune) => void }) {
  const t = useTrainer();
  const { voicings, contexts } = t;
  // Per song, in its own key: chords played and the voicings it uses.
  const cover = useMemo(() => {
    const m = new Map<string, { played: number; chords: number; order: OrderEntry[] }>();
    for (const p of playlists)
      for (const s of p.songs) {
        const b = buildSet({ source: 'charts', key: s.home_key, tuneId: s.id, tags, mode: 'play', limit: 0 }, { voicings, contexts, tunes: [s] });
        m.set(s.id, { played: b.steps.length, chords: b.chords, order: b.order });
      }
    return m;
  }, [playlists, voicings, contexts, tags]);
  if (!playlists.length) {
    return (
      <div className="vt-field">
        <span className="vt-field-lbl">Song</span>
        <span className="vt-hint">
          {syncedAt
            ? t.canEdit
              ? 'No iFake Pro playlists of yours yet — songs in playlists you own or edit show up here.'
              : 'Sign in to see your iFake Pro playlists.'
            : 'Your iFake Pro charts download with the next sync.'}
        </span>
      </div>
    );
  }
  return (
    <div className="vt-field">
      <span className="vt-field-lbl">Song</span>
      {playlists.map(p => {
        const order = mergeOrders(p.songs.map(s => cover.get(s.id)?.order ?? []));
        return (
          <details key={p.id} className="pr-pl" open={playlists.length <= 2 || p.songs.some(s => s.id === value?.id)}>
            <summary>
              <b>{p.title}</b> <span>{p.songs.length} song{p.songs.length === 1 ? '' : 's'}</span>
            </summary>
            <ul className="pr-songs">
              {p.songs.map(s => {
                const c = cover.get(s.id);
                return (
                  <li key={s.id} className={value?.id === s.id ? 'on' : ''}>
                    <button type="button" onClick={() => onPick(s)} aria-pressed={value?.id === s.id}>
                      <b>{s.title}</b>
                      <span>
                        {pretty(s.key_name ?? '') || keyLabel(s.home_key)}
                        {s.is_minor ? 'm' : ''}
                        {c && c.chords ? ` · ${c.played}/${c.chords} chords` : ' · no chords'}
                      </span>
                    </button>
                    <a href={s.href} className="pr-open" aria-label={`Open ${s.title} in iFake Pro`} title="Open in iFake Pro">
                      ↗
                    </a>
                  </li>
                );
              })}
            </ul>
            {t.canEdit && order.length > 0 && <ToDeck order={order} tags={tags} what={`${p.title}’s`} title={p.title} />}
          </details>
        );
      })}
      <span className="vt-hint">
        Read from iFake Pro{syncedAt ? `, ${relTime(syncedAt)}` : ''}; edit charts there. “x/y chords”: how many the library plays.
      </span>
    </div>
  );
}

function TunePicker({ tunes, value, onPick }: { tunes: Tune[]; value: Tune | null; onPick: (t: Tune) => void }) {
  const [q, setQ] = useState('');
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    // Your iFake Pro songs come first (they lead the list), then the standards.
    return tunes.filter(t => t.title.toLowerCase().includes(s) || (t.composer ?? '').toLowerCase().includes(s)).slice(0, 12);
  }, [q, tunes]);
  return (
    <div className="vt-field">
      <span className="vt-field-lbl">Tune</span>
      {!tunes.length ? (
        <span className="vt-hint">No tunes on this device yet — they download with the next sync.</span>
      ) : (
        <>
          <input className="vt-input" placeholder={value ? value.title : `Search ${tunes.length.toLocaleString()} tunes`} value={q} onChange={e => setQ(e.target.value)} />
          {value && !q && (
            <span className="vt-hint">
              <b>{value.title}</b>
              {value.composer ? ` · ${value.composer}` : ''} · {value.chords.length} chord changes, home key {pretty(PC_FLAT[value.home_key])}
              {value.is_minor ? ' minor' : ''}
            </span>
          )}
          {hits.length > 0 && (
            <ul className="pr-hits">
              {hits.map(t => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(t);
                      setQ('');
                    }}
                  >
                    <b>{t.title}</b> <span>{'playlist' in t ? `iFake Pro · ${(t as ChartTune).playlist}` : t.composer}</span>
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

function RunResults({ results, label, prev }: { results: RunnerResult[]; label: string; prev?: Run }) {
  const t = useTrainer();
  const [added, setAdded] = useState(false);
  const inDeck = (r: RunnerResult) => MODES.some(m => t.srs.has(srsKey(r.step.voicing.id, m)));
  const right = results.filter(r => r.correct);
  const avg = right.length ? Math.round(right.reduce((s, r) => s + r.ms, 0) / right.length) : null;
  const slow = results.filter(r => r.correct && r.slow);
  const missed = results.filter(r => !r.correct);
  const delta = prev && avg != null && prev.avg_ms ? avg - prev.avg_ms : null;
  return (
    <div className="pr-results">
      <p className="pr-set">{label}</p>
      {delta != null && (
        <p className={`pr-delta ${delta <= 0 ? 'good' : 'slow'}`}>
          {delta <= 0 ? '▼' : '▲'} {fmtSecs(Math.abs(delta))} {delta <= 0 ? 'faster' : 'slower'} than last run ({relTime(prev!.finished_at)}, {fmtSecs(prev!.avg_ms)} avg)
        </p>
      )}
      {[
        { title: 'Into your next review', list: [...slow, ...missed].filter(r => inDeck(r)), out: false },
        { title: 'Not in your deck', list: [...slow, ...missed].filter(r => !inDeck(r)), out: true },
      ].map(g =>
        g.list.length ? (
          <div key={g.title} className="pr-group">
            <h3 className="sm-h">{g.title}</h3>
            <div className="pr-slow">
              {g.list.map((r, i) => (
                <span key={i} className={`pr-card ${r.correct ? 'slow' : 'fail'}`} title={r.correct ? 'right but slow' : 'missed'}>
                  {prettyLabel(r.step.voicing.chord_label)} <em>{r.correct ? fmtSecs(r.ms) : '✗'}</em>
                </span>
              ))}
            </div>
            {g.out && t.canEdit && (
              <button
                type="button"
                className="vt-secondary pr-add"
                disabled={added}
                onClick={async () => {
                  await t.addToDeck([...new Set(g.list.map(r => r.step.voicing.id))]);
                  setAdded(true);
                }}
              >
                {added ? 'Added to your deck' : `Add ${new Set(g.list.map(r => r.step.voicing.id)).size} to deck`}
              </button>
            )}
          </div>
        ) : null,
      )}
      {(slow.length > 0 || missed.length > 0) && <p className="vt-hint">Right but slow in amber, missed in red.</p>}
    </div>
  );
}

function RunHistory({ runs }: { runs: Run[] }) {
  if (!runs.length) return <p className="vt-hint pr-nohist">No runs of this set yet. Each run is saved, so you can compare speed over time.</p>;
  const max = Math.max(...runs.map(r => r.avg_ms), 1);
  const w = 280;
  const h = 60;
  const pts = runs.map((r, i) => [runs.length === 1 ? w / 2 : (i / (runs.length - 1)) * (w - 12) + 6, h - 6 - (r.avg_ms / max) * (h - 16)] as const);
  return (
    <section className="vt-panel">
      <h3 className="vt-panel-title">This set, run by run</h3>
      <svg className="pr-spark" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="average time per run">
        <polyline points={pts.map(p => p.join(',')).join(' ')} />
        {pts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r={3} />
        ))}
      </svg>
      <table className="vt-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Cards</th>
            <th>Accuracy</th>
            <th>Avg time</th>
            <th>Slow</th>
          </tr>
        </thead>
        <tbody>
          {[...runs].reverse().map(r => (
            <tr key={r.id}>
              <td>{relTime(r.finished_at)}</td>
              <td>{r.cards}</td>
              <td>{fmtPct(r.correct, r.cards)}</td>
              <td>{fmtSecs(r.avg_ms)}</td>
              <td>{r.slow}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
