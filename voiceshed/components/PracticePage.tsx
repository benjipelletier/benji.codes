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
import { newId, useTrainer } from './TrainerProvider';
import { buildSet, filterTags, type SetSource, type SetSpec, type Skipped } from '@voiceshed/lib/practice';
import { dueNow, newState, targetFor } from '@voiceshed/lib/srs';
import { keyLabel, PC_FLAT, pretty, prettyLabel } from '@voiceshed/lib/theory';
import { MODES, MODE_LABEL, srsKey, type Mode, type Run, type SrsState, type Tune } from '@voiceshed/lib/types';

const SOURCES: { id: SetSource; label: string; hint: string }[] = [
  { id: 'ii-v-i', label: 'ii–V–Is', hint: 'Major and minor, in one key or all twelve.' },
  { id: 'key', label: 'One key', hint: 'The diatonic chords of a major key, shuffled.' },
  { id: 'tune', label: 'A tune', hint: 'The changes of a standard, in order, in any key.' },
  { id: 'tags', label: 'Tag filter', hint: 'Any voicings with the tags you pick, shuffled.' },
];

const SPEC_KEY = 'vt-practice-spec';

function loadSpec(): SetSpec {
  const fallback: SetSpec = { source: 'ii-v-i', key: null, tuneId: null, tags: [], mode: 'play', limit: 40 };
  try {
    const raw = localStorage.getItem(SPEC_KEY);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export function PracticePage() {
  const t = useTrainer();
  const { voicings, contexts, settings, runs } = t;
  const [spec, setSpecState] = useState<SetSpec>(() => ({ source: 'ii-v-i', key: null, tuneId: null, tags: [], mode: 'play', limit: 40 }));
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

  const built = useMemo(() => buildSet(spec, { voicings, contexts, tunes }), [spec, voicings, contexts, tunes]);
  const skippedN = built.skipped.reduce((n, x) => n + x.count, 0);
  const history = useMemo(() => runs.filter(r => r.set_key === built.setKey).slice(-12), [runs, built.setKey]);

  const tagCounts = useMemo(() => filterTags(voicings), [voicings]);

  const start = () => {
    const fresh = buildSet(spec, { voicings, contexts, tunes });
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
      // Right but slow, and missed: into the next review.
      const now = new Date();
      const rows = new Map<string, SrsState>();
      for (const r of rs) {
        if (r.correct && !r.slow) continue;
        const key = srsKey(r.step.voicing.id, r.step.mode);
        const prev = rows.get(key) ?? t.srs.get(key) ?? newState(r.step.voicing.id, r.step.mode, now);
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

  const tune = tunes.find(x => x.id === spec.tuneId) ?? null;
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

        {spec.source === 'tune' && <TunePicker tunes={tunes} value={tune} onPick={x => setSpec({ tuneId: x.id, key: x.home_key })} />}

        <div className="vt-field">
          <span className="vt-field-lbl">Key</span>
          <div className="vt-keys">
            {spec.source !== 'key' && spec.source !== 'tune' && (
              <button type="button" className={spec.key == null ? 'on' : ''} onClick={() => setSpec({ key: null })}>
                {spec.source === 'tags' ? 'any root' : 'all'}
              </button>
            )}
            {PC_FLAT.map((_, pc) => (
              <button type="button" key={pc} className={spec.key === pc ? 'on' : ''} onClick={() => setSpec({ key: pc })}>
                {keyLabel(pc)}
                {spec.source === 'tune' && tune?.home_key === pc ? '•' : ''}
              </button>
            ))}
          </div>
          {spec.source === 'tags' && <span className="vt-hint">For a tag filter, the key is the chord’s root.</span>}
        </div>

        <div className="vt-field">
          <span className="vt-field-lbl">Tags {spec.source === 'ii-v-i' || spec.source === 'tune' ? '(which voicings to use)' : ''}</span>
          <div className="vt-chips">
            {tagCounts.map(([tag, n]) => (
              <button type="button" key={tag} className={spec.tags.includes(tag) ? 'vt-chip on' : 'vt-chip'} onClick={() => setSpec({ tags: spec.tags.includes(tag) ? spec.tags.filter(x => x !== tag) : [...spec.tags, tag] })}>
                {tag} <span>{n}</span>
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

/** The chords a run leaves out, each with how often: none of that chord type yet, or none in the tags picked. */
function SkippedList({ skipped }: { skipped: Skipped[] }) {
  if (!skipped.length) return null;
  const groups: [Skipped['why'], string][] = [
    ['no-voicing', 'Skipped — no voicing yet'],
    ['tags', 'Skipped — none with these tags'],
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

function TunePicker({ tunes, value, onPick }: { tunes: Tune[]; value: Tune | null; onPick: (t: Tune) => void }) {
  const [q, setQ] = useState('');
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return tunes.filter(t => t.title.toLowerCase().includes(s) || (t.composer ?? '').toLowerCase().includes(s)).slice(0, 12);
  }, [q, tunes]);
  return (
    <div className="vt-field">
      <span className="vt-field-lbl">Tune</span>
      {!tunes.length ? (
        <span className="vt-hint">No tunes on this device yet — they download with the next sync.</span>
      ) : (
        <>
          <input className="vt-input" placeholder={value ? value.title : `Search ${tunes.length.toLocaleString()} standards`} value={q} onChange={e => setQ(e.target.value)} />
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
                    <b>{t.title}</b> <span>{t.composer}</span>
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
      {(slow.length > 0 || missed.length > 0) && (
        <>
          <h3 className="sm-h">Added to your next review</h3>
          <div className="pr-slow">
            {slow.map((r, i) => (
              <span key={`s${i}`} className="pr-card slow" title="right but slow">
                {prettyLabel(r.step.voicing.chord_label)} <em>{fmtSecs(r.ms)}</em>
              </span>
            ))}
            {missed.map((r, i) => (
              <span key={`m${i}`} className="pr-card fail" title="missed">
                {prettyLabel(r.step.voicing.chord_label)} <em>✗</em>
              </span>
            ))}
          </div>
          <p className="vt-hint">Right but slow in amber, missed in red.</p>
        </>
      )}
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
