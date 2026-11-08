'use client';

// How a voicing stands, mode by mode, and what moved it (the owner: "is it
// clear how all the different review types are affecting its retention?"):
// solid, shaky or new, with why; its fluency score (what ranks it for today's
// set); its last answers as dots marked by where they came from — Review's
// drill, Review's ii–V–I, a Practice run, a tune — and tap one for its detail.

import { useMemo, useState } from 'react';
import { partnersOf, useTrainer } from './TrainerProvider';
import { fmtSecs, relTime, useCardStats } from './TrainerShell';
import { targetFor } from '@voiceshed/lib/srs';
import { cardStatus, fastStreak, FLUENT_STREAK, fluencyScore, SOURCE_NAME, sourceOf, type Source } from '@voiceshed/lib/drill';
import { MODES, MODE_LABEL, srsKey, type Attempt, type Mode, type Voicing } from '@voiceshed/lib/types';
import { degreesOf } from '@voiceshed/lib/practice';
import { pitchName, pretty } from '@voiceshed/lib/theory';
import { LEVEL_NAME, type Level } from './ListenPage';

const SHOWN = 12;
const verdict = (a: Attempt) => (!a.correct ? 'miss' : a.slow ? 'slow' : 'fast');
const VERDICT: Record<string, string> = { fast: 'Right, in time', slow: 'Right but slow', miss: 'Missed' };


/** An inversion named by its bottom chord tone: "♭3", "♭7", "1". */
const bottomOf = (o: Voicing) => degreesOf(o)[0];

export function Retention({ v, onOpen }: { v: Voicing; onOpen?: (id: string) => void }) {
  const t = useTrainer();
  const { grouped, stats, gapKeys } = useCardStats();
  const runs = useMemo(() => new Map(t.runs.map(r => [r.id, r])), [t.runs]);
  const progs = useMemo(() => new Map(t.contexts.map(c => [c.id, c])), [t.contexts]);
  const src = (a: Attempt) => sourceOf(a, runs, progs);
  const [picked, setPicked] = useState<{ key: string; id: string } | null>(null);
  const where = (a: Attempt) => {
    const s = src(a);
    return `${SOURCE_NAME[s.src]}${s.what ? ` · ${s.what}` : ''}`;
  };
  // This page is one inversion's (the owner: "this page is about one specific inversion as
  // indicated by the piano at the top"), so its stats are its own; its other inversions — which
  // go solid with it — get a line each, tap to open theirs.
  const mates = useMemo(() => partnersOf(t.voicings, v).filter(o => o.id !== v.id), [t.voicings, v]);
  const spelled = (o: Voicing) => o.notes.map(n => pretty(pitchName(n))).join(' ');

  const cellOf = (o: Voicing, md: Mode) => {
    const key = srsKey(o.id, md);
    const st = t.srs.get(key);
    const list = grouped.get(key) ?? [];
    const target = targetFor(st, md, t.settings, o);
    const gap = gapKeys.has(key);
    return {
      o,
      key,
      st,
      list,
      target,
      usual: targetFor(undefined, md, t.settings, o),
      gap,
      status: cardStatus(st, gap),
      s: stats.get(key),
      score: fluencyScore(list, target),
      streak: fastStreak(list),
    };
  };
  type Cell = ReturnType<typeof cellOf>;

  const subOf = (c: Cell) => {
    if (c.status === 'out') return 'Not in your deck — answers still count';
    if (c.status === 'new') return 'Not answered yet — joins a set when nothing shakier waits';
    if (c.status === 'shaky') return 'Leads your next set';
    return new Date(c.st!.due_at).getTime() <= Date.now() ? 'Check due — in your next set' : `Next check ${relTime(c.st!.due_at)}`;
  };
  /** Why one card is shaky; fast enough itself, what it waits on (its inversions go solid with it). */
  const whyOf = (c: Cell, others: Cell[]): string | null => {
    if (c.status !== 'shaky') return null;
    if (c.gap) return 'Fast in a progression but slow on its own.';
    const slip = [...c.list].reverse().find(a => verdict(a) !== 'fast');
    if (slip && c.streak === 0) return `Last slip: ${VERDICT[verdict(slip)].toLowerCase()} in ${where(slip)}, ${relTime(slip.created_at)}.`;
    if (!c.list.length) return null;
    if (c.streak < FLUENT_STREAK) return `${c.streak} of ${FLUENT_STREAK} fast in a row so far — finish it in Review.`;
    const behind = others.filter(o => o.status === 'new' || (o.status === 'shaky' && (o.gap || o.streak < FLUENT_STREAK)));
    if (behind.length) return `Fast enough (${c.streak} in a row) — waiting on its other inversion${behind.length > 1 ? 's' : ''}: they go solid together, in Review.`;
    return `Fast enough (${c.streak} in a row) — goes solid when a Review set sees it through: ${FLUENT_STREAK} fast in a row there.`;
  };
  /** A few words on where an inversion stands. */
  const shortOf = (c: Cell): string => {
    if (c.status === 'out') return 'not in deck';
    if (c.status !== 'shaky') return c.status;
    if (c.gap) return 'slow alone';
    return c.streak >= FLUENT_STREAK ? 'ready ✓' : `${c.streak} of ${FLUENT_STREAK}`;
  };
  const body = (c: Cell, others: Cell[]) => {
    const recent = c.list.slice(-SHOWN);
    const sel = picked?.key === c.key ? recent.find(a => a.id === picked.id) : undefined;
    const why = whyOf(c, others);
    return (
      <>
        {why && <p className="rt-why">{why}</p>}
        {c.score != null && (
          <div className="rt-fluency" title="Each of the last 6 answers scores target ÷ time (1 if in time), a miss 0">
            <span className="rt-lbl">Fluency</span>
            <span className={`rt-bar ${c.score < 0.5 ? 'low' : c.score < 0.8 ? 'mid' : ''}`}>
              <i style={{ width: `${Math.round(c.score * 100)}%` }} />
            </span>
            <span className="rt-num">{Math.round(c.score * 100)}</span>
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
                    onClick={() => setPicked(sel?.id === a.id ? null : { key: c.key, id: a.id })}
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
          <span>Alone {fmtSecs(c.s?.isolatedMs)}</span>
          <span>In context {fmtSecs(c.s?.contextMs)}</span>
          <label className="rt-target">
            Target
            <input
              className="dt-target"
              type="number"
              min={0.5}
              max={20}
              step={0.1}
              disabled={!t.canEdit || !c.st}
              title={c.st ? undefined : 'Add it to your deck to set its target'}
              value={c.target / 1000}
              onChange={e => {
                const ms = Math.round(Number(e.target.value) * 1000);
                if (ms < 500 || !c.st) return;
                void t.saveSrs([{ ...c.st, target_ms: ms === c.usual ? null : ms, updated_at: new Date().toISOString(), dirty: true }]);
              }}
            />
            s
          </label>
        </div>
      </>
    );
  };

  return (
    <section className="rt" aria-label="How it’s holding up">
      {MODES.map(md => {
        const c = cellOf(v, md);
        const others = mates.map(o => cellOf(o, md));
        return (
          <div key={md} className={`rt-mode rt-${c.status}`}>
            <div className="rt-head">
              <b>{MODE_LABEL[md]}</b>
              <span className="rt-pill">{c.status === 'out' ? 'not in deck' : c.status}</span>
              <span className="rt-sub">{subOf(c)}</span>
            </div>
            {body(c, others)}
            {/* Its other inversions, a line each: they go solid with this one. */}
            {c.status !== 'out' &&
              others.map(o => (
                <button key={o.key} type="button" className={`rt-mate rt-${o.status}`} onClick={() => onOpen?.(o.o.id)} disabled={!onOpen}>
                  <span>
                    With <b>{bottomOf(o.o)}</b> on the bottom ({spelled(o.o)})
                  </span>
                  <span className="rt-mate-st">
                    {shortOf(o)}
                    {onOpen ? ' ›' : ''}
                  </span>
                </button>
              ))}
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
