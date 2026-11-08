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
/** Answers shown in an inversion's column, beside the others. */
const SHOWN_SHORT = 6;
const verdict = (a: Attempt) => (!a.correct ? 'miss' : a.slow ? 'slow' : 'fast');
const VERDICT: Record<string, string> = { fast: 'Right, in time', slow: 'Right but slow', miss: 'Missed' };

type Status = ReturnType<typeof cardStatus>;

/** An inversion named by its bottom chord tone: "♭3", "♭7", "1". */
const bottomOf = (o: Voicing) => degreesOf(o)[0];

export function Retention({ v }: { v: Voicing }) {
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
  // The chord's inversions side by side in each mode (the owner: "I would like to see the
  // inversions side by side on the sheet"): Review drills them together and they go solid
  // together, so one alone doesn't say where the chord stands. The one opened is outlined.
  const invs = useMemo(() => {
    const ps = partnersOf(t.voicings, v);
    return ps.length > 1 ? ps : [v];
  }, [t.voicings, v]);
  const many = invs.length > 1;
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

  /** As Review groups them: shaky if any is (or one is new beside answered ones), solid only if all are. */
  const groupStatus = (cells: Cell[]): Status => {
    const inDeck = cells.filter(c => c.status !== 'out');
    if (!inDeck.length) return 'out';
    if (inDeck.every(c => c.status === 'new')) return 'new';
    if (inDeck.every(c => c.status === 'solid')) return 'solid';
    return 'shaky';
  };
  const subOf = (status: Status, cells: Cell[]) => {
    if (status === 'out') return 'Not in your deck — answers still count';
    if (status === 'new') return 'Not answered yet — joins a set when nothing shakier waits';
    if (status === 'shaky') return many ? 'Leads your next set · its inversions go solid together' : 'Leads your next set';
    const due = cells.map(c => c.st!.due_at).sort()[0];
    return new Date(due).getTime() <= Date.now() ? 'Check due — in your next set' : `Next check ${relTime(due)}`;
  };
  /** Why one card is shaky, in full (one inversion) or in a few words (a column). */
  const whyOf = (c: Cell, cells: Cell[], short: boolean): string | null => {
    if (c.status !== 'shaky') return null;
    if (c.gap) return short ? 'Slow alone' : 'Fast in a progression but slow on its own.';
    const slip = [...c.list].reverse().find(a => verdict(a) !== 'fast');
    if (slip && c.streak === 0) {
      return short
        ? `Last: ${VERDICT[verdict(slip)].toLowerCase()} · ${relTime(slip.created_at)}`
        : `Last slip: ${VERDICT[verdict(slip)].toLowerCase()} in ${where(slip)}, ${relTime(slip.created_at)}.`;
    }
    if (!c.list.length) return null;
    if (c.streak < FLUENT_STREAK) return short ? `${c.streak} of ${FLUENT_STREAK} fast in a row` : `${c.streak} of ${FLUENT_STREAK} fast in a row so far — finish it in Review.`;
    if (short) return `Fast enough · ${c.streak} in a row`;
    return `Fast enough (${c.streak} in a row) — goes solid when a Review set sees it through: ${FLUENT_STREAK} fast in a row there.`;
  };
  /** A chord whose inversions stand apart: who's ready and who it waits on. */
  const groupWhy = (cells: Cell[]): string | null => {
    const inDeck = cells.filter(c => c.status !== 'out');
    const ready = inDeck.filter(c => c.status === 'shaky' && !c.gap && c.streak >= FLUENT_STREAK);
    const behind = inDeck.filter(c => c.status === 'new' || (c.status === 'shaky' && (c.gap || c.streak < FLUENT_STREAK)));
    if (!ready.length || !behind.length) return null;
    const names = (xs: Cell[]) => xs.map(c => `${bottomOf(c.o)} on the bottom`).join(' and ');
    return `${names(ready)} ${ready.length > 1 ? 'are' : 'is'} fast enough — waiting on ${names(behind)}. They go solid together, in Review.`;
  };

  const body = (c: Cell, cells: Cell[], short: boolean) => {
    const recent = c.list.slice(short ? -SHOWN_SHORT : -SHOWN);
    const sel = picked?.key === c.key ? recent.find(a => a.id === picked.id) : undefined;
    const why = whyOf(c, cells, short);
    return (
      <>
        {why && <p className={short ? `rt-inv-why ${c.streak >= FLUENT_STREAK ? 'ready' : ''}` : 'rt-why'}>{why}</p>}
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
        const cells = invs.map(o => cellOf(o, md));
        const status = groupStatus(cells);
        const gw = many ? groupWhy(cells) : null;
        return (
          <div key={md} className={`rt-mode rt-${status}`}>
            <div className="rt-head">
              <b>{MODE_LABEL[md]}</b>
              <span className="rt-pill">{status === 'out' ? 'not in deck' : status}</span>
              <span className="rt-sub">{subOf(status, cells)}</span>
            </div>
            {status === 'out' && many ? null : !many ? (
              body(cells[0], cells, false)
            ) : (
              <>
                {gw && <p className="rt-why">{gw}</p>}
                <div className={`rt-invs ${cells.length > 2 ? 'rt-invs-4' : ''}`}>
                  {cells.map(c => (
                    <div key={c.key} className={`rt-inv rt-${c.status} ${c.o.id === v.id ? 'on' : ''}`} aria-label={`${bottomOf(c.o)} on the bottom: ${spelled(c.o)}`}>
                      <div className="rt-inv-head">
                        <b>{bottomOf(c.o)}</b>
                        <span className="rt-inv-lbl">bottom</span>
                        <span className="rt-pill">{c.status === 'out' ? 'out' : c.status}</span>
                        <span className="rt-inv-notes">{spelled(c.o)}</span>
                      </div>
                      {body(c, cells, true)}
                    </div>
                  ))}
                </div>
              </>
            )}
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
