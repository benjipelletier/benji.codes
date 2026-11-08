'use client';

// Listen: ear training on the deck (the owner: "play a bass note (bass
// guitar) and then one of the chords in my deck on piano. I need to click
// which type of chord it is … just go through the whole deck"). Its own
// session: every deck voicing once, shuffled, no new-card limits, nothing
// scheduled. A miss comes back once a few chords later. After a wrong answer,
// "Hear yours" plays the type you picked on the same bass note, to compare.
// The summary: accuracy, each chord type, and what was heard as what.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTrainer } from './TrainerProvider';
import { useBackClose } from './useBackClose';
import { Keyboard, rangeAround } from './Keyboard';
import { PianoLoader, fmtPct } from './TrainerShell';
import { midisOf } from '@voiceshed/lib/practice';
import { shuffle } from '@voiceshed/lib/srs';
import { audio, loadSounds, playCue, soundsReady } from '@voiceshed/lib/sound';
import { isIii, parseChordLabel, prettyLabel, pretty, QUALITIES, QUALITY, type Quality } from '@voiceshed/lib/theory';
import type { Voicing } from '@voiceshed/lib/types';

/** A missed chord comes back this many chords later, once. */
const AGAIN_GAP = 4;
const RIGHT_ADVANCE_MS = 1300;

interface Item {
  v: Voicing;
  again: boolean;
}
interface Answer {
  v: Voicing;
  said: Quality;
  again: boolean;
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
  const [said, setSaid] = useState<Quality | null>(null);
  const answers = useRef<Answer[]>([]);
  // Stable, so a re-render (a sync, say) doesn't restart the move-on timer.
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  const finish = useCallback(() => onFinishRef.current(answers.current), []);
  useBackClose(true, finish);
  const item = queue[index];
  const v = item?.v;
  const right = said != null && said === v?.quality;

  const play = useCallback((x: Voicing) => playCue(x.root, midisOf(x)), []);
  // Each chord sounds as it comes up — once, however often the effect runs.
  const played = useRef(-1);
  useEffect(() => {
    if (!v || played.current === index) return;
    played.current = index;
    play(v);
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  const next = useCallback(() => {
    if (index + 1 >= queue.length) return finish();
    setIndex(i => i + 1);
    setSaid(null);
  }, [index, queue.length, finish]);

  const answer = (q: Quality) => {
    if (said != null || !v) return;
    setSaid(q);
    answers.current.push({ v, said: q, again: item.again });
    if (q !== v.quality && !item.again) {
      setQueue(list => {
        const copy = [...list];
        copy.splice(Math.min(copy.length, index + 1 + AGAIN_GAP), 0, { v, again: true });
        return copy;
      });
    }
  };
  // A right answer moves on by itself.
  useEffect(() => {
    if (!right) return;
    const id = setTimeout(next, RIGHT_ADVANCE_MS);
    return () => clearTimeout(id);
  }, [right, next]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (said != null && !right && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [said, right, next]);

  // What the type picked sounds like on the same bass note: the deck's voicing of it on this root, else the library's.
  const yours = useMemo(() => {
    if (!v || said == null || said === v.quality) return null;
    const on = (list: Voicing[]) => list.filter(x => x.root === v.root && x.quality === said && !isIii(x));
    const ids = new Set([...t.srs.values()].map(s => s.voicing_id));
    const all = on(t.voicings);
    return all.find(x => ids.has(x.id)) ?? all[0] ?? null;
  }, [v, said, t.voicings, t.srs]);

  if (!v) return null;
  const m = midisOf(v);
  const [lo, hi] = rangeAround(m, 12);
  return (
    <div className={`ls-run ${said == null ? 'ls-ask' : right ? 'ls-right' : 'ls-wrong'}`} data-voicing-id={v.id}>
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

      <div className="ls-stage">
        {said == null ? (
          <button type="button" className="ls-play" onClick={() => play(v)} aria-label="Play it again">
            <span aria-hidden>▶</span>
            <b>Play again</b>
          </button>
        ) : (
          <div className="ls-answer">
            <span className="ls-mark">{right ? '✓' : '✗'}</span>
            <b className="ls-chord">{prettyLabel(v.chord_label)}</b>
            <span className="ls-sub">
              {right ? 'right' : `you said ${QUALITY[said].display}`} · bass {pretty(parseChordLabel(v.chord_label)?.rootName ?? '')}
            </span>
            <div className="ls-kb">
              <Keyboard compact low={lo} high={hi} marks={Object.fromEntries(m.map(x => [x, 'on']))} />
            </div>
          </div>
        )}
      </div>

      <div className="ls-types-pick" role="group" aria-label="What kind of chord">
        {types.map(q => (
          <button
            type="button"
            key={q}
            className={`nm-btn ${said === q ? (right ? 'ls-good' : 'ls-bad') : said != null && q === v.quality ? 'ls-good' : ''}`}
            onPointerDown={e => {
              e.preventDefault();
              answer(q);
            }}
            disabled={said != null}
          >
            {QUALITY[q].display}
          </button>
        ))}
      </div>

      {said != null && !right && (
        <div className="ls-actions">
          <button type="button" className="vt-secondary" onClick={() => play(v)}>
            ▶ {QUALITY[v.quality].display}
          </button>
          {yours && (
            <button type="button" className="vt-secondary" onClick={() => play(yours)}>
              ▶ Hear yours ({QUALITY[said].display})
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
  const right = first.filter(a => a.said === a.v.quality);
  const byType = new Map<Quality, { n: number; right: number }>();
  const mixed = new Map<string, { heard: Quality; as: Quality; n: number }>();
  for (const a of first) {
    const e = byType.get(a.v.quality) ?? { n: 0, right: 0 };
    e.n++;
    if (a.said === a.v.quality) e.right++;
    byType.set(a.v.quality, e);
    if (a.said !== a.v.quality) {
      const k = `${a.v.quality}>${a.said}`;
      const x = mixed.get(k) ?? { heard: a.v.quality, as: a.said, n: 0 };
      x.n++;
      mixed.set(k, x);
    }
  }
  const order = QUALITIES.map(q => q.id).filter(q => byType.has(q));
  return (
    <div className="vt-page">
      <section className="sm">
        <PianoLoader rounds={2} small />
        <h2 className="sm-title">Listened</h2>
        <div className="sm-stats">
          <div>
            <span className="sm-num">{fmtPct(right.length, first.length)}</span>
            <span className="sm-lbl">first time · {right.length}/{first.length}</span>
          </div>
        </div>
        {order.length > 0 && (
          <>
            <h3 className="sm-h">By chord type</h3>
            <ul className="ls-sum">
              {order.map(q => {
                const e = byType.get(q)!;
                return (
                  <li key={q}>
                    <b>{QUALITY[q].display}</b>
                    <span className="ls-sum-bar">
                      <i style={{ width: `${(e.right / e.n) * 100}%` }} />
                    </span>
                    <span className="ls-sum-n">
                      {e.right}/{e.n}
                    </span>
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
                    <b>{QUALITY[x.heard].display}</b> heard as <b>{QUALITY[x.as].display}</b>
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
