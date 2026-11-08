'use client';

// How a voicing stands, mode by mode, and what moved it (the owner: "is it
// clear how all the different review types are affecting its retention?"):
// solid, shaky or new, with why; its fluency score (what ranks it for today's
// set); its last answers as dots marked by where they came from — Review's
// drill, Review's ii–V–I, a Practice run, a tune — and tap one for its detail.

import { useMemo, useState } from 'react';
import { useTrainer } from './TrainerProvider';
import { fmtSecs, relTime, useCardStats } from './TrainerShell';
import { targetFor } from '@voiceshed/lib/srs';
import { cardStatus, fastStreak, FLUENT_STREAK, fluencyScore, SOURCE_NAME, sourceOf, type Source } from '@voiceshed/lib/drill';
import { MODES, MODE_LABEL, srsKey, type Attempt, type Mode, type Voicing } from '@voiceshed/lib/types';
import { LEVEL_NAME, type Level } from './ListenPage';

const SHOWN = 12;
const verdict = (a: Attempt) => (!a.correct ? 'miss' : a.slow ? 'slow' : 'fast');
const VERDICT: Record<string, string> = { fast: 'Right, in time', slow: 'Right but slow', miss: 'Missed' };

export function Retention({ v }: { v: Voicing }) {
  const t = useTrainer();
  const { grouped, stats, gapKeys } = useCardStats();
  const runs = useMemo(() => new Map(t.runs.map(r => [r.id, r])), [t.runs]);
  const progs = useMemo(() => new Map(t.contexts.map(c => [c.id, c])), [t.contexts]);
  const src = (a: Attempt) => sourceOf(a, runs, progs);
  const [picked, setPicked] = useState<{ mode: Mode; id: string } | null>(null);
  const where = (a: Attempt) => {
    const s = src(a);
    return `${SOURCE_NAME[s.src]}${s.what ? ` · ${s.what}` : ''}`;
  };

  return (
    <section className="rt" aria-label="How it’s holding up">
      {MODES.map(md => {
        const key = srsKey(v.id, md);
        const st = t.srs.get(key);
        const list = grouped.get(key) ?? [];
        const target = targetFor(st, md, t.settings, v);
        const usual = targetFor(undefined, md, t.settings, v);
        const s = stats.get(key);
        const gap = gapKeys.has(key);
        const status = cardStatus(st, gap);
        const score = fluencyScore(list, target);
        const streak = fastStreak(list);
        const recent = list.slice(-SHOWN);
        const slip = [...list].reverse().find(a => verdict(a) !== 'fast');
        const check = st && status === 'solid' ? new Date(st.due_at).getTime() <= Date.now() : false;
        const sub =
          status === 'out'
            ? 'Not in your deck — answers still count'
            : status === 'new'
              ? 'Not answered yet — joins a set when nothing shakier waits'
              : status === 'solid'
                ? check
                  ? 'Check due — in your next set'
                  : `Next check ${relTime(st!.due_at)}`
                : 'Leads your next set';
        const why =
          status !== 'shaky'
            ? null
            : gap
              ? 'Fast in a progression but slow on its own.'
              : slip && streak === 0
                ? `Last slip: ${VERDICT[verdict(slip)].toLowerCase()} in ${where(slip)}, ${relTime(slip.created_at)}.`
                : `${streak} of ${FLUENT_STREAK} fast in a row so far — finish it in Review.`;
        const sel = picked?.mode === md ? recent.find(a => a.id === picked.id) : undefined;
        return (
          <div key={md} className={`rt-mode rt-${status}`}>
            <div className="rt-head">
              <b>{MODE_LABEL[md]}</b>
              <span className="rt-pill">{status === 'out' ? 'not in deck' : status}</span>
              <span className="rt-sub">{sub}</span>
            </div>
            {why && <p className="rt-why">{why}</p>}
            {score != null && (
              <div className="rt-fluency" title="Each of the last 6 answers scores target ÷ time (1 if in time), a miss 0">
                <span className="rt-lbl">Fluency</span>
                <span className={`rt-bar ${score < 0.5 ? 'low' : score < 0.8 ? 'mid' : ''}`}>
                  <i style={{ width: `${Math.round(score * 100)}%` }} />
                </span>
                <span className="rt-num">{Math.round(score * 100)}</span>
              </div>
            )}
            {recent.length > 0 ? (
              <>
                <div className="rt-strip" role="list" aria-label={`Last ${recent.length} answers, oldest first`}>
                  {recent.map(a => {
                    const s2 = src(a);
                    return (
                      <button
                        type="button"
                        role="listitem"
                        key={a.id}
                        className={`rt-dot rt-${verdict(a)} ${sel?.id === a.id ? 'on' : ''}`}
                        onClick={() => setPicked(sel?.id === a.id ? null : { mode: md, id: a.id })}
                        aria-label={`${VERDICT[verdict(a)]}, ${fmtSecs(a.response_ms)}, ${where(a)}, ${relTime(a.created_at)}`}
                      >
                        <i />
                        <span>{s2.src === 'C' ? 'ii–V' : s2.src}</span>
                      </button>
                    );
                  })}
                </div>
                {sel && (
                  <p className="rt-pick">
                    <b className={`rt-${verdict(sel)}-ink`}>{VERDICT[verdict(sel)]}</b> · {fmtSecs(sel.response_ms)} · {where(sel)} · {relTime(sel.created_at)}
                  </p>
                )}
              </>
            ) : (
              <p className="rt-none">No answers yet.</p>
            )}
            <div className="rt-foot">
              <span>Alone {fmtSecs(s?.isolatedMs)}</span>
              <span>In context {fmtSecs(s?.contextMs)}</span>
              <label className="rt-target">
              Target
              <input
                className="dt-target"
                type="number"
                min={0.5}
                max={20}
                step={0.1}
                disabled={!t.canEdit || !st}
                title={st ? undefined : 'Add it to your deck to set its target'}
                value={target / 1000}
                onChange={e => {
                  const ms = Math.round(Number(e.target.value) * 1000);
                  if (ms < 500 || !st) return;
                  void t.saveSrs([{ ...st, target_ms: ms === usual ? null : ms, updated_at: new Date().toISOString(), dirty: true }]);
                }}
              />
              s
            </label>
            </div>
          </div>
        );

      })}
      <ListenBlock v={v} />
      <p className="vt-hint rt-key">
        Dots, oldest first: <i className="rt-k rt-fast" /> fast <i className="rt-k rt-slow" /> slow <i className="rt-k rt-miss" /> missed. Under each, where:{' '}
        {(['R', 'C', 'P', 'T'] as Source[]).map(k => (
          <span key={k}>
            <b>{k === 'C' ? 'ii–V' : k}</b> {SOURCE_NAME[k]}{' '}
          </span>
        ))}
        — tap one for its detail. Alone and in context are medians of the last ten right answers.
      </p>
    </section>
  );
}

/**
 * Listen's answers for this voicing (the owner: "why doesn't listen show up on
 * a voicings card page"): each level's accuracy, and the last sounds as dots —
 * green when every level asked was right, red at the level it went wrong.
 * Listen schedules nothing, so there's no status here.
 */
function ListenBlock({ v }: { v: Voicing }) {
  const t = useTrainer();
  const list = useMemo(() => t.attempts.filter(a => a.mode === 'listen' && a.voicing_id === v.id).sort((a, b) => a.created_at.localeCompare(b.created_at)), [t.attempts, v.id]);
  if (!list.length) {
    return (
      <div className="rt-mode rt-listen rt-out">
        <div className="rt-head">
          <b>Listen</b>
          <span className="rt-sub">Not heard yet — it comes up in Listen once it’s in your deck.</span>
        </div>
      </div>
    );
  }
  // A sound: its level answers, which come within seconds of each other, from level 1.
  const sounds: Attempt[][] = [];
  for (const a of list) {
    if (a.listen_level === 1 || !sounds.length) sounds.push([a]);
    else sounds[sounds.length - 1].push(a);
  }
  const levels = ([1, 2, 3] as Level[])
    .map(l => {
      const xs = list.filter(a => a.listen_level === l);
      return { l, n: xs.length, right: xs.filter(a => a.correct).length };
    })
    .filter(x => x.n);
  const recent = sounds.slice(-12);
  return (
    <div className="rt-mode rt-listen">
      <div className="rt-head">
        <b>Listen</b>
        <span className="rt-sub">
          {sounds.length} time{sounds.length === 1 ? '' : 's'} heard, last {relTime(list[list.length - 1].created_at)}
        </span>
      </div>
      <ul className="rt-levels">
        {levels.map(x => (
          <li key={x.l}>
            <span>{LEVEL_NAME[x.l]}</span>
            <span className="rt-bar">
              <i style={{ width: `${(x.right / x.n) * 100}%` }} />
            </span>
            <b>
              {x.right}/{x.n}
            </b>
          </li>
        ))}
      </ul>
      <div className="rt-strip" role="list" aria-label={`Last ${recent.length} times heard, oldest first`}>
        {recent.map(s => {
          const miss = s.find(a => !a.correct);
          return (
            <span key={s[0].id} role="listitem" className={`rt-dot ${miss ? 'rt-miss' : 'rt-fast'}`} title={miss ? `wrong at ${LEVEL_NAME[miss.listen_level as Level]}` : 'every level right'}>
              <i />
              <span>{miss ? `✗${miss.listen_level}` : '✓'}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
