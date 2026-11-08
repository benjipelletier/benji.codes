'use client';

// Listen: ear training on the deck (the owner: "play a bass note (bass
// guitar) and then one of the chords in my deck on piano. I need to click
// which type of chord it is … just go through the whole deck"). Its own
// session: every deck voicing once, shuffled, no new-card limits, nothing
// scheduled. Each sound asks in levels (the owner: "first is which type of
// chord, next is drop 2 spread or block, next is which inversion"): a level
// is skipped when there's nothing to choose (one voicing type for that chord,
// no other inversion), and a wrong answer ends the sound — the full answer
// shown, "Hear yours" playing what was picked — and brings it back once a few
// sounds later. Every level answered is an attempt (mode 'listen', its
// `listen_level`), shown on the voicing's sheet. The summary: each level's
// accuracy, each chord type, and what was heard as what.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { newId, partnersOf, useTrainer } from './TrainerProvider';
import { useBackClose } from './useBackClose';
import { Keyboard, rangeAround } from './Keyboard';
import { PianoLoader, fmtPct } from './TrainerShell';
import { midisOf } from '@voiceshed/lib/practice';
import { shuffle } from '@voiceshed/lib/srs';
import { audio, loadSounds, playCue, soundsReady } from '@voiceshed/lib/sound';
import { FOUND, intervalDisplay, intervalName, isIii, mod12, parseChordLabel, prettyLabel, pretty, QUALITIES, QUALITY, type Quality } from '@voiceshed/lib/theory';
import type { Voicing } from '@voiceshed/lib/types';

/** A missed sound comes back this many sounds later, once. */
const AGAIN_GAP = 4;
const RIGHT_ADVANCE_MS = 1300;
const LEVEL_ADVANCE_MS = 450;

export type Level = 1 | 2 | 3;
export const LEVEL_NAME: Record<Level, string> = { 1: 'Chord type', 2: 'Voicing type', 3: 'Inversion' };
const LEVEL_ASK: Record<Level, string> = { 1: 'What kind of chord?', 2: 'Which voicing type?', 3: 'Which inversion?' };

/** A voicing type as Listen names it. */
export const familyShort = (f: string) => (f === 'drop-2 two-hand' ? 'Drop 2' : f === 'closed (block)' ? 'Block' : f === 'quartal two-hand' ? 'Quartal' : f);

/** A chord tone as a number: "♭3", "9", "1" for the root. */
export function toneOf(v: Voicing, midi: number): string {
  const semis = mod12(midi - v.root);
  return semis === 0 ? '1' : intervalDisplay(intervalName(v.quality, semis));
}

interface Item {
  v: Voicing;
  again: boolean;
}
interface Option {
  key: string;
  label: string;
  sub?: string;
  /** What it sounds like on the same bass note, for "Hear yours". */
  voicing: Voicing | null;
}
interface Picked {
  level: Level;
  key: string;
  label: string;
  right: boolean;
}
export interface Answer {
  v: Voicing;
  again: boolean;
  picks: Picked[];
}

export function ListenPage() {
  const t = useTrainer();
  // The deck: each voicing with a schedule in any mode, once.
  const deck = useMemo(() => {
    const ids = new Set([...t.srs.values()].map(s => s.voicing_id));
    return t.voicings.filter(v => ids.has(v.id));
  }, [t.srs, t.voicings]);
  const types = useMemo(() => QUALITIES.map(q => q.id).filter(q => deck.some(v => v.quality === q)), [deck]);
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [answers, setAnswers] = useState<Answer[]>([]);
  useBackClose(phase === 'done', () => setPhase('idle'));
  // The piano and bass samples: fetched and decoded before the first chord.
  const [sounds, setSounds] = useState<'loading' | 'ready' | 'failed'>(soundsReady() ? 'ready' : 'loading');
  const load = useCallback(() => {
    setSounds('loading');
    void loadSounds().then(ok => setSounds(ok ? 'ready' : 'failed'));
  }, []);
  useEffect(() => {
    if (!soundsReady()) load();
  }, [load]);

  if (phase === 'running') return <ListenRun deck={deck} types={types} onFinish={a => (setAnswers(a), setPhase('done'))} />;
  if (phase === 'done') return <ListenSummary answers={answers} onDone={() => setPhase('idle')} />;

  return (
    <div className="vt-page">
      <section className="rv-hero ls-hero">
        <h2 className="sm-title">Listen</h2>
        <p className="rv-note ls-what">
          A bass note, then a chord from your deck on piano. Tap what kind of chord it is. Every voicing in your deck once, shuffled; a miss comes back a few chords later.
        </p>
        <div className="ls-types" aria-label="The chord types you'll choose from">
          {types.map(q => (
            <span key={q}>{QUALITY[q].display}</span>
          ))}
        </div>
        <button
          type="button"
          className="vt-primary"
          disabled={!deck.length || sounds !== 'ready'}
          onClick={() => {
            audio(); // woken on this tap, so the first chord sounds
            setPhase('running');
          }}
        >
          {!deck.length ? 'Your deck is empty' : sounds === 'loading' ? 'Loading the piano and bass…' : sounds === 'failed' ? 'Sounds didn’t load' : `Start · ${deck.length} chord${deck.length === 1 ? '' : 's'}`}
        </button>
        {sounds === 'failed' && (
          <button type="button" className="vt-secondary" onClick={load}>
            Try again
          </button>
        )}
        <p className="rv-note">Turn your sound on. Nothing here changes your Review schedule.</p>
        <p className="rv-note ls-credit">
          Piano: Salamander Grand Piano by Alexander Holm. Bass: FluidR3 by Frank Wen. Both{' '}
          <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noreferrer">
            CC BY 3.0
          </a>
          .
        </p>
      </section>
    </div>
  );
}

function ListenRun({ deck, types, onFinish }: { deck: Voicing[]; types: Quality[]; onFinish: (a: Answer[]) => void }) {
  const t = useTrainer();
  const [queue, setQueue] = useState<Item[]>(() => shuffle(deck.map(v => ({ v, again: false }))));
  const [index, setIndex] = useState(0);
  const [level, setLevel] = useState<Level>(1);
  const [picks, setPicks] = useState<Picked[]>([]);
  /** The sound is over: every level right, or one wrong. */
  const [over, setOver] = useState(false);
  const answers = useRef<Answer[]>([]);
  const asked = useRef(0);
  // Stable, so a re-render (a sync, say) doesn't restart the move-on timers.
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  const finish = useCallback(() => onFinishRef.current(answers.current), []);
  useBackClose(true, finish);
  const item = queue[index];
  const v = item?.v;
  const inDeck = useMemo(() => new Set([...t.srs.values()].map(s => s.voicing_id)), [t.srs]);

  // The choices at each level for this sound; a level with one choice is skipped.
  const options = useMemo((): Record<Level, Option[]> => {
    if (!v) return { 1: [], 2: [], 3: [] };
    const iii = isIii(v);
    const onRoot = (q: Quality) => {
      const all = t.voicings.filter(x => x.root === v.root && x.quality === q && !isIii(x) && x.family !== FOUND);
      return all.find(x => inDeck.has(x.id)) ?? all[0] ?? null;
    };
    const l1 = types.map(q => ({ key: q, label: QUALITY[q].display, voicing: q === v.quality ? v : onRoot(q) }));
    if (v.family === FOUND) return { 1: l1, 2: [], 3: [] };
    const fams = [...new Set(t.voicings.filter(x => x.quality === v.quality && isIii(x) === iii && x.family !== FOUND).map(x => x.family))];
    const l2 = fams.map(f => ({
      key: f,
      label: familyShort(f),
      voicing: f === v.family ? v : (t.voicings.find(x => x.chord_label === v.chord_label && x.family === f && isIii(x) === iii) ?? null),
    }));
    const l3 = partnersOf(t.voicings, v)
      .sort((a, b) => midisOf(a)[0] - midisOf(b)[0])
      .map(x => {
        const m = midisOf(x);
        return { key: x.id, label: toneOf(x, m[0]), sub: `top ${toneOf(x, m[m.length - 1])}`, voicing: x };
      });
    return { 1: l1, 2: l2.length > 1 ? l2 : [], 3: l3.length > 1 ? l3 : [] };
  }, [v, types, t.voicings, inDeck]);
  const rightKey = (l: Level) => (l === 1 ? v?.quality : l === 2 ? v?.family : v?.id);
  const nextLevel = (from: Level): Level | null => ([2, 3] as Level[]).find(l => l > from && options[l].length > 1) ?? null;

  const play = useCallback((x: Voicing) => playCue(x.root, midisOf(x)), []);
  // Each sound plays as it comes up — once, however often the effect runs.
  const played = useRef(-1);
  useEffect(() => {
    if (!v || played.current === index) return;
    played.current = index;
    asked.current = performance.now();
    play(v);
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  const next = useCallback(() => {
    if (index + 1 >= queue.length) return finish();
    setIndex(i => i + 1);
    setLevel(1);
    setPicks([]);
    setOver(false);
  }, [index, queue.length, finish]);

  const answer = (o: Option) => {
    if (over || !v || picks.some(p => p.level === level)) return;
    const right = o.key === rightKey(level);
    const pick: Picked = { level, key: o.key, label: o.label, right };
    const all = [...picks, pick];
    setPicks(all);
    void t.recordAttempts([
      {
        id: newId(),
        voicing_id: v.id,
        mode: 'listen',
        listen_level: level,
        context_type: 'isolated',
        context_id: null,
        run_id: null,
        correct: right,
        slow: false,
        response_ms: Math.round(performance.now() - asked.current),
        created_at: new Date().toISOString(),
      },
    ]);
    const after = right ? nextLevel(level) : null;
    if (after) {
      setTimeout(() => {
        setLevel(after);
        asked.current = performance.now();
      }, LEVEL_ADVANCE_MS);
      return;
    }
    setOver(true);
    answers.current.push({ v, again: item.again, picks: all });
    if (!right && !item.again) {
      setQueue(list => {
        const copy = [...list];
        copy.splice(Math.min(copy.length, index + 1 + AGAIN_GAP), 0, { v, again: true });
        return copy;
      });
    }
  };
  const allRight = over && picks.every(p => p.right);
  // All right: on by itself.
  useEffect(() => {
    if (!allRight) return;
    const id = setTimeout(next, RIGHT_ADVANCE_MS);
    return () => clearTimeout(id);
  }, [allRight, next]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (over && !allRight && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [over, allRight, next]);

  if (!v) return null;
  const m = midisOf(v);
  const [lo, hi] = rangeAround(m, 12);
  const levels = ([1, 2, 3] as Level[]).filter(l => l === 1 || options[l].length > 1);
  const wrong = picks.find(p => !p.right);
  const yours = wrong ? options[wrong.level].find(o => o.key === wrong.key)?.voicing : null;
  const shown = options[level];
  const mine = picks.find(p => p.level === level);
  return (
    <div className={`ls-run ${!over ? 'ls-ask' : allRight ? 'ls-right' : 'ls-wrong'}`} data-voicing-id={v.id} data-level={level}>
      <div className="cr-top">
        <span className="cr-mode">Listen</span>
        {item.again && <span className="cr-group">again</span>}
        <span className="cr-pos">
          {index + 1} / {queue.length}
        </span>
        <button type="button" className="cr-end" onClick={finish}>
          End
        </button>
      </div>

      <ol className="ls-levels" aria-label="Levels for this sound">
        {levels.map((l, i) => {
          const p = picks.find(x => x.level === l);
          return (
            <li key={l} className={p ? (p.right ? 'ok' : 'bad') : l === level && !over ? 'on' : ''}>
              <span>{i + 1}</span>
              {p ? (p.right ? p.label : `✗ ${p.label}`) : LEVEL_NAME[l]}
            </li>
          );
        })}
      </ol>

      <div className="ls-stage">
        {!over ? (
          <button type="button" className="ls-play" onClick={() => play(v)} aria-label="Play it again">
            <span aria-hidden>▶</span>
            <b>Play again</b>
          </button>
        ) : (
          <div className="ls-answer">
            <span className="ls-mark">{allRight ? '✓' : '✗'}</span>
            <b className="ls-chord">{prettyLabel(v.chord_label)}</b>
            <span className="ls-sub">
              {v.family !== FOUND ? `${familyShort(v.family)} · ${toneOf(v, m[0])} on the bottom · ` : ''}bass {pretty(parseChordLabel(v.chord_label)?.rootName ?? '')}
            </span>
            <div className="ls-kb">
              <Keyboard compact low={lo} high={hi} marks={Object.fromEntries(m.map(x => [x, 'on']))} />
            </div>
          </div>
        )}
      </div>

      {!over && <h3 className="ls-ask-q">{LEVEL_ASK[level]}</h3>}
      {(!over || wrong) && (
        <div className={`ls-types-pick ls-pick-${(wrong?.level ?? level)}`} role="group" aria-label={LEVEL_ASK[wrong?.level ?? level]}>
          {(wrong ? options[wrong.level] : shown).map(o => {
            const lv = wrong?.level ?? level;
            const p = picks.find(x => x.level === lv);
            const isRight = o.key === rightKey(lv);
            const cls = p?.key === o.key ? (p.right ? 'ls-good' : 'ls-bad') : p && !p.right && isRight ? 'ls-good' : '';
            return (
              <button
                type="button"
                key={o.key}
                data-key={o.key}
                className={`nm-btn ${cls}`}
                onPointerDown={e => {
                  e.preventDefault();
                  answer(o);
                }}
                disabled={over || !!mine}
              >
                {o.label}
                {o.sub && <small>{o.sub}</small>}
              </button>
            );
          })}
        </div>
      )}

      {over && !allRight && (
        <div className="ls-actions">
          <button type="button" className="vt-secondary" onClick={() => play(v)}>
            ▶ The answer
          </button>
          {yours && yours.id !== v.id && (
            <button type="button" className="vt-secondary" onClick={() => play(yours)}>
              ▶ Hear yours ({wrong!.label})
            </button>
          )}
          <button type="button" className="vt-primary" onClick={next} autoFocus>
            Next <kbd>↵</kbd>
          </button>
        </div>
      )}
    </div>
  );
}

function ListenSummary({ answers, onDone }: { answers: Answer[]; onDone: () => void }) {
  const first = answers.filter(a => !a.again);
  const all = first.filter(a => a.picks.every(p => p.right));
  const perLevel = ([1, 2, 3] as Level[])
    .map(l => {
      const ps = first.flatMap(a => a.picks.filter(p => p.level === l));
      return { l, n: ps.length, right: ps.filter(p => p.right).length };
    })
    .filter(x => x.n > 0);
  const byType = new Map<Quality, { n: number; right: number }>();
  const mixed = new Map<string, { heard: string; as: string; n: number }>();
  for (const a of first) {
    const p1 = a.picks.find(p => p.level === 1);
    if (!p1) continue;
    const e = byType.get(a.v.quality) ?? { n: 0, right: 0 };
    e.n++;
    if (p1.right) e.right++;
    byType.set(a.v.quality, e);
    if (!p1.right) {
      const k = `${a.v.quality}>${p1.key}`;
      const x = mixed.get(k) ?? { heard: QUALITY[a.v.quality].display, as: p1.label, n: 0 };
      x.n++;
      mixed.set(k, x);
    }
  }
  const order = QUALITIES.map(q => q.id).filter(q => byType.has(q));
  const bar = (right: number, n: number) => (
    <>
      <span className="ls-sum-bar">
        <i style={{ width: `${(right / n) * 100}%` }} />
      </span>
      <span className="ls-sum-n">
        {right}/{n}
      </span>
    </>
  );
  return (
    <div className="vt-page">
      <section className="sm">
        <PianoLoader rounds={2} small />
        <h2 className="sm-title">Listened</h2>
        <div className="sm-stats">
          <div>
            <span className="sm-num">{fmtPct(all.length, first.length)}</span>
            <span className="sm-lbl">every level, first time · {all.length}/{first.length}</span>
          </div>
        </div>
        {perLevel.length > 0 && (
          <>
            <h3 className="sm-h">By level</h3>
            <ul className="ls-sum ls-sum-levels">
              {perLevel.map(x => (
                <li key={x.l}>
                  <b>{LEVEL_NAME[x.l]}</b>
                  {bar(x.right, x.n)}
                </li>
              ))}
            </ul>
          </>
        )}
        {order.length > 0 && (
          <>
            <h3 className="sm-h">Chord type, by chord</h3>
            <ul className="ls-sum">
              {order.map(q => {
                const e = byType.get(q)!;
                return (
                  <li key={q}>
                    <b>{QUALITY[q].display}</b>
                    {bar(e.right, e.n)}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {mixed.size > 0 && (
          <>
            <h3 className="sm-h">Heard as</h3>
            <ul className="ls-mixed">
              {[...mixed.values()]
                .sort((a, b) => b.n - a.n)
                .map(x => (
                  <li key={`${x.heard}>${x.as}`}>
                    <b>{x.heard}</b> heard as <b>{x.as}</b>
                    {x.n > 1 ? ` ×${x.n}` : ''}
                  </li>
                ))}
            </ul>
          </>
        )}
        <button type="button" className="vt-primary" onClick={onDone}>
          Done
        </button>
      </section>
    </div>
  );
}
