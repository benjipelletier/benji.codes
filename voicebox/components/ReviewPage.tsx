'use client';

// SRS Review: the cards due today across all modes, one at a time, with
// feedback that shows the right voicing on the keyboard. A summary at the
// end: accuracy, average time and the slowest cards.

import { useCallback, useMemo, useState } from 'react';
import { CardRunner, type RunnerResult, type RunnerStep } from './CardRunner';
import { fmtPct, fmtSecs, relTime, signIn, signOut, useCardStats } from './TrainerShell';
import { newId, useTrainer } from './TrainerProvider';
import { Keyboard, rangeAround } from './Keyboard';
import { buildQueue, newState, outcomeOf, schedule, shuffle, targetFor } from '@voicebox/lib/srs';
import { midisOf } from '@voicebox/lib/practice';
import { pretty } from '@voicebox/lib/theory';
import { MODES, MODE_LABEL, srsKey, type Mode, type Settings } from '@voicebox/lib/types';

/** Most cards a session deals; what's left stays due for the next. */
const SESSION_MAX = 60;

export function ReviewPage() {
  const t = useTrainer();
  const { voicings, srs, settings } = t;
  const { gapKeys } = useCardStats();
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [steps, setSteps] = useState<RunnerStep[]>([]);
  const [results, setResults] = useState<RunnerResult[]>([]);
  const [showSettings, setShowSettings] = useState(false);

  const queue = useMemo(() => buildQueue({ voicings, srs, gapKeys, settings, now: new Date() }), [voicings, srs, gapKeys, settings]);
  const learned = useMemo(() => [...srs.values()].filter(s => s.learned).length, [srs]);
  const dueByMode = useMemo(() => {
    const out: Record<Mode, number> = { play: 0, spell: 0, name: 0 };
    for (const c of queue.due) out[c.mode]++;
    return out;
  }, [queue]);

  const start = () => {
    // Due first (soonest first), then the context-gap cards, then new ones mixed in.
    const due = [...queue.due, ...shuffle([...queue.gap])].slice(0, SESSION_MAX);
    const fresh = queue.fresh.slice(0, Math.max(0, SESSION_MAX - due.length));
    const cards = [...due];
    // New cards spread through the session rather than all at the end.
    fresh.forEach((c, i) => cards.splice(Math.round(((i + 1) * cards.length) / (fresh.length + 1)) + i, 0, c));
    setSteps(
      cards.map(c => ({
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

  const total = Math.min(SESSION_MAX, queue.due.length + queue.gap.length + queue.fresh.length);
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
          {settings.review_modes.map(m => (
            <span key={m} className="rv-mode">
              {MODE_LABEL[m]} <b>{dueByMode[m]}</b>
            </span>
          ))}
        </div>
        <button type="button" className="vt-primary" onClick={start} disabled={!total}>
          {total ? `Start review · ${total} cards` : 'Nothing due — come back later'}
        </button>
        <p className="rv-note">
          A card is learned once it’s right <em>and</em> under its target time. {learned} of {voicings.length * settings.review_modes.length} cards learned.
        </p>
      </section>

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
        <span className="vt-hint">Each card can have its own, set in the Library.</span>
      </div>
      <label className="vt-field">
        <span className="vt-field-lbl">New cards a day</span>
        <input type="number" min={0} max={200} value={settings.new_per_day} onChange={e => onSave({ ...settings, new_per_day: Math.max(0, Math.min(200, Number(e.target.value) || 0)) })} />
      </label>
      <div className="vt-field">
        <span className="vt-field-lbl">Review modes</span>
        <div className="vt-inline">
          {MODES.map(m => (
            <label key={m} className="vt-check">
              <input
                type="checkbox"
                checked={settings.review_modes.includes(m)}
                onChange={e => {
                  const modes = e.target.checked ? MODES.filter(x => x === m || settings.review_modes.includes(x)) : settings.review_modes.filter(x => x !== m);
                  if (modes.length) onSave({ ...settings, review_modes: modes });
                }}
              />
              {MODE_LABEL[m]}
            </label>
          ))}
        </div>
      </div>
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
                  <span className="sm-chord">{pretty(r.step.voicing.chord_label)}</span>
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
