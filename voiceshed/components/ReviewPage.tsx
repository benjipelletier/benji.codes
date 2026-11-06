'use client';

// SRS Review: the cards due today, one at a time, with feedback that shows
// the right voicing on the keyboard — narrowed to the run you want with the
// session set-up (ReviewSetup: modes, chord and voicing types, keys,
// spellings, due / new / ahead of schedule, length). A summary at the end:
// accuracy, average time and the slowest cards.

import { useCallback, useMemo, useState } from 'react';
import { CardRunner, type RunnerResult, type RunnerStep } from './CardRunner';
import { fmtPct, fmtSecs, relTime, signIn, signOut, useCardStats } from './TrainerShell';
import { newId, useTrainer } from './TrainerProvider';
import { Keyboard, rangeAround } from './Keyboard';
import { describe, ReviewSetup, useReviewConfig, voicingIn } from './ReviewSetup';
import { buildQueue, newState, outcomeOf, schedule, shuffle, targetFor } from '@voiceshed/lib/srs';
import { midisOf } from '@voiceshed/lib/practice';
import { pretty, prettyLabel } from '@voiceshed/lib/theory';
import { MODES, MODE_LABEL, srsKey, type Mode, type Settings } from '@voiceshed/lib/types';

export function ReviewPage() {
  const t = useTrainer();
  const { voicings, srs, settings } = t;
  const { gapKeys } = useCardStats();
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [steps, setSteps] = useState<RunnerStep[]>([]);
  const [results, setResults] = useState<RunnerResult[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [config, setConfig] = useReviewConfig();

  // The session's voicings, and its queue (the day's new-card limit still counts every card).
  const pool = useMemo(() => voicings.filter(v => voicingIn(v, config)), [voicings, config]);
  const queue = useMemo(
    () => buildQueue({ voicings: pool, srs, gapKeys, settings: { ...settings, review_modes: config.modes }, now: new Date() }),
    [pool, srs, gapKeys, settings, config.modes],
  );
  // Not due yet, soonest first: extra rounds when there's time.
  const ahead = useMemo(() => {
    const ids = new Map(pool.map(v => [v.id, v]));
    const gap = new Set(queue.gap.map(c => srsKey(c.voicing.id, c.mode)));
    const now = Date.now();
    return [...srs.values()]
      .filter(s => config.modes.includes(s.mode) && ids.has(s.voicing_id) && new Date(s.due_at).getTime() > now && !gap.has(srsKey(s.voicing_id, s.mode)))
      .sort((a, b) => a.due_at.localeCompare(b.due_at))
      .map(s => ({ voicing: ids.get(s.voicing_id)!, mode: s.mode }));
  }, [pool, srs, config.modes, queue.gap]);
  // Everything due now, for the set-up's counts.
  const dueAll = useMemo(() => {
    const ids = new Map(voicings.map(v => [v.id, v]));
    const now = Date.now();
    return [...srs.values()].filter(s => ids.has(s.voicing_id) && new Date(s.due_at).getTime() <= now).map(s => ({ voicing: ids.get(s.voicing_id)!, mode: s.mode }));
  }, [voicings, srs]);

  const learned = useMemo(() => [...srs.values()].filter(s => s.learned).length, [srs]);
  const dueByMode = useMemo(() => {
    const out: Record<Mode, number> = { play: 0, spell: 0, name: 0 };
    for (const c of queue.due) out[c.mode]++;
    return out;
  }, [queue]);

  /** The cards the session deals, in order. */
  const deal = useMemo(() => {
    const max = config.length || Infinity;
    const cards = [
      ...(config.include.due ? [...queue.due, ...shuffle([...queue.gap])] : []),
      ...(config.include.ahead ? ahead : []),
    ].slice(0, max);
    const fresh = config.include.fresh ? queue.fresh.slice(0, Math.max(0, max - cards.length)) : [];
    // New cards spread through the session rather than all at the end.
    fresh.forEach((c, i) => cards.splice(Math.round(((i + 1) * cards.length) / (fresh.length + 1)) + i, 0, c));
    return cards;
  }, [queue, ahead, config]);

  const start = () => {
    setSteps(
      deal.map(c => ({
        voicing: c.voicing,
        mode: c.mode,
        target: targetFor(srs.get(srsKey(c.voicing.id, c.mode)), c.mode, settings),
        context_type: 'isolated',
        context_id: null,
      })),
    );
    setResults([]);
    setPhase('running');
  };

  const onAttempt = useCallback(
    (r: RunnerResult) => {
      const { voicing, mode, target } = r.step;
      void t.recordAttempts([
        {
          id: newId(),
          voicing_id: voicing.id,
          mode,
          context_type: 'isolated',
          context_id: null,
          run_id: null,
          correct: r.correct,
          slow: r.slow,
          response_ms: r.ms,
          created_at: r.at,
        },
      ]);
      // A card asked again after a miss is practice: its schedule was set by the miss.
      if (r.repeat) return;
      const key = srsKey(voicing.id, mode);
      const now = new Date(r.at);
      const prev = t.srs.get(key) ?? newState(voicing.id, mode, now);
      void t.saveSrs([schedule(prev, outcomeOf(r.correct, r.ms, target), r.ms, target, now, gapKeys.has(key))]);
    },
    [t, gapKeys],
  );

  const onFinish = useCallback(
    (rs: RunnerResult[]) => {
      setResults(rs);
      setPhase('done');
      void t.sync();
    },
    [t],
  );

  if (phase === 'running') {
    return <CardRunner steps={steps} library={voicings} strictSpelling={settings.strict_spelling} requeueMisses onAttempt={onAttempt} onFinish={onFinish} />;
  }
  if (phase === 'done') return <Summary results={results} onAgain={() => setPhase('idle')} />;

  const total = deal.length;
  const filtered = describe(config);
  return (
    <div className="vt-page">
      <section className="rv-hero">
        <div className="rv-big">
          <span className="rv-num">{queue.due.length}</span>
          <span className="rv-lbl">due</span>
        </div>
        <div className="rv-big">
          <span className="rv-num rv-num-2">{queue.fresh.length}</span>
          <span className="rv-lbl">new today</span>
        </div>
        {queue.gap.length > 0 && (
          <div className="rv-big" title="Fast in a progression, slow on its own: shown more often here">
            <span className="rv-num rv-num-3">{queue.gap.length}</span>
            <span className="rv-lbl">context gap</span>
          </div>
        )}
        <div className="rv-modes">
          {config.modes.map(m => (
            <span key={m} className="rv-mode">
              {MODE_LABEL[m]} <b>{dueByMode[m]}</b>
            </span>
          ))}
        </div>
        <p className="rv-what">{filtered}</p>
        <button type="button" className="vt-primary" onClick={start} disabled={!total}>
          {total
            ? `Start · ${total} card${total === 1 ? '' : 's'}`
            : !config.include.due && !config.include.fresh && !config.include.ahead
              ? 'Pick which cards below'
              : ahead.length && !config.include.ahead
                ? 'Nothing due — add “Not due yet” below'
                : 'Nothing to review with this set-up'}
        </button>
        <p className="rv-note">
          A card is learned once it’s right <em>and</em> under its target time. {learned} of {voicings.length * MODES.length} cards learned.
        </p>
      </section>

      <ReviewSetup config={config} onChange={setConfig} voicings={voicings} srs={srs} due={dueAll} />

      <section className="vt-panel">
        <button type="button" className="vt-panel-head" onClick={() => setShowSettings(s => !s)} aria-expanded={showSettings}>
          Settings <span>{showSettings ? '−' : '+'}</span>
        </button>
        {showSettings && <SettingsForm settings={settings} onSave={s => void t.saveSettings(s)} />}
      </section>

      <OfflinePanel />
    </div>
  );
}

function SettingsForm({ settings, onSave }: { settings: Settings; onSave: (s: Settings) => void }) {
  return (
    <div className="vt-form">
      <div className="vt-field">
        <span className="vt-field-lbl">Target time</span>
        <div className="vt-inline">
          {MODES.map(m => (
            <label key={m} className="vt-mini">
              {MODE_LABEL[m]}
              <input
                type="number"
                min={0.5}
                max={20}
                step={0.1}
                value={settings.target_ms[m] / 1000}
                onChange={e => {
                  const v = Math.round(Number(e.target.value) * 1000);
                  if (v >= 500) onSave({ ...settings, target_ms: { ...settings.target_ms, [m]: v } });
                }}
              />
              s
            </label>
          ))}
        </div>
        <span className="vt-hint">Each card can have its own, set on the Voicings page.</span>
      </div>
      <label className="vt-field">
        <span className="vt-field-lbl">New cards a day</span>
        <input type="number" min={0} max={200} value={settings.new_per_day} onChange={e => onSave({ ...settings, new_per_day: Math.max(0, Math.min(200, Number(e.target.value) || 0)) })} />
      </label>
      <label className="vt-check">
        <input type="checkbox" checked={settings.strict_spelling} onChange={e => onSave({ ...settings, strict_spelling: e.target.checked })} />
        Strict spelling (G♯ isn’t A♭ in Spell mode)
      </label>
    </div>
  );
}

export function Summary({ results, onAgain, extra }: { results: RunnerResult[]; onAgain: () => void; extra?: React.ReactNode }) {
  const first = results.filter(r => !r.repeat);
  const right = first.filter(r => r.correct);
  const inTime = right.filter(r => !r.slow);
  const avg = right.length ? Math.round(right.reduce((s, r) => s + r.ms, 0) / right.length) : null;
  const slowest = [...first].sort((a, b) => b.ms - a.ms).slice(0, 6);
  return (
    <div className="vt-page">
      <section className="sm">
        <h2 className="sm-title">Session done</h2>
        <div className="sm-stats">
          <div>
            <span className="sm-num">{fmtPct(right.length, first.length)}</span>
            <span className="sm-lbl">accuracy · {right.length}/{first.length}</span>
          </div>
          <div>
            <span className="sm-num">{fmtSecs(avg)}</span>
            <span className="sm-lbl">average (right answers)</span>
          </div>
          <div>
            <span className="sm-num">{fmtPct(inTime.length, first.length)}</span>
            <span className="sm-lbl">right and in time</span>
          </div>
        </div>
        {extra}
        {slowest.length > 0 && (
          <>
            <h3 className="sm-h">Slowest cards</h3>
            <ul className="sm-list">
              {slowest.map((r, i) => (
                <li key={i} className={`sm-row ${r.correct ? (r.slow ? 'slow' : 'good') : 'fail'}`}>
                  <span className="sm-mark">{r.correct ? '✓' : '✗'}</span>
                  <span className="sm-chord">{prettyLabel(r.step.voicing.chord_label)}</span>
                  <span className="sm-meta">
                    {MODE_LABEL[r.step.mode]} · {r.step.voicing.family}
                  </span>
                  <span className="sm-kb">
                    <Keyboard compact low={rangeAround(midisOf(r.step.voicing), 8)[0]} high={rangeAround(midisOf(r.step.voicing), 8)[1]} marks={Object.fromEntries(midisOf(r.step.voicing).map(m => [m, 'on']))} />
                  </span>
                  <span className="sm-time">{fmtSecs(r.ms)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <button type="button" className="vt-primary" onClick={onAgain}>
          Done
        </button>
      </section>
    </div>
  );
}

export function OfflinePanel() {
  const { offline, voicings, srs, pending, sync, status, lastSyncAt, viewer } = useTrainer();
  const swOk = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  const rows: [boolean, string, string][] = [
    [!!offline.appSavedAt, 'App saved for offline', offline.appSavedAt ? relTime(offline.appSavedAt) : swOk ? 'after the next sync (production only)' : 'this browser can’t'],
    [voicings.length > 0, `${voicings.length} voicings, progressions, ${srs.size} schedules`, offline.dataAt ? relTime(offline.dataAt) : 'not yet'],
    [offline.tunes > 0, `${offline.tunes.toLocaleString()} tunes`, offline.tunesAt ? relTime(offline.tunesAt) : 'not yet'],
    [pending === 0, pending ? `${pending} changes waiting to upload` : 'Nothing waiting to upload', lastSyncAt ? `last sync ${relTime(lastSyncAt)}` : ''],
  ];
  return (
    <section className="vt-panel vt-offline">
      <h3 className="vt-panel-title">✈ Offline</h3>
      <ul className="of-list">
        {rows.map(([ok, what, when], i) => (
          <li key={i} className={ok ? 'of-ok' : 'of-no'}>
            <span className="of-mark">{ok ? '✓' : '○'}</span>
            <span className="of-what">{what}</span>
            <span className="of-when">{when}</span>
          </li>
        ))}
      </ul>
      {!viewer?.isOwner && <p className="vt-hint">Not signed in as the owner: answers here stay on this device and aren’t uploaded.</p>}
      <p className="vt-hint">
        <b>Before the flight:</b> turn on airplane mode and do a full practice run on every page.
      </p>
      <div className="vt-inline">
        <button type="button" className="vt-secondary" onClick={() => void sync()} disabled={status === 'syncing'}>
          Sync now
        </button>
        <button type="button" className="vt-secondary" onClick={() => void sync({ tunes: true })} disabled={status === 'syncing'}>
          Refresh tunes
        </button>
        {viewer?.isOwner ? (
          <button type="button" className="vt-secondary" onClick={() => void signOut()}>
            Sign out
          </button>
        ) : (
          <button type="button" className="vt-secondary" onClick={() => void signIn()}>
            Sign in
          </button>
        )}
      </div>
    </section>
  );
}
