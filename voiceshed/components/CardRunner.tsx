'use client';

// Shows a card in any mode, times it and records the attempt. The clock
// starts when the card is on screen and stops when the answer is in: Play
// and Spell submit themselves once as many notes are in as the voicing has,
// Name once chord, quality and top tone are all picked. A right answer moves
// on by itself; a wrong one stays up, with the right voicing on the
// keyboard, until you tap Next (or press Enter / Space).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, rangeAround, type KeyMark } from './Keyboard';
import { NotePad } from './NotePad';
import { gradeName, gradePlay, gradeSpell, midisOf, nameOf, type NameAnswer } from '@voiceshed/lib/practice';
import { chordDisplay, intervalDisplay, intervalName, mod12, parseChordLabel, pitchName, pretty, PC_FLAT, QUALITIES, QUALITY, rootNames, type Quality } from '@voiceshed/lib/theory';
import type { ContextType, Mode, Voicing } from '@voiceshed/lib/types';
import { MODE_LABEL } from '@voiceshed/lib/types';

export interface RunnerStep {
  voicing: Voicing;
  mode: Mode;
  target: number;
  context_type: ContextType;
  context_id: string | null;
  symbol?: string | null;
  group?: string | null;
}

export interface RunnerResult {
  step: RunnerStep;
  correct: boolean;
  slow: boolean;
  ms: number;
  /** A missed card asked again later in the same session. */
  repeat: boolean;
  at: string;
}

interface Props {
  steps: RunnerStep[];
  library: Voicing[];
  strictSpelling: boolean;
  /** Review: a missed card comes round again a few cards later, once. */
  requeueMisses?: boolean;
  /** A progression or tune: show where the card falls in it. */
  showSequence?: boolean;
  onAttempt: (r: RunnerResult) => void;
  onFinish: (results: RunnerResult[]) => void;
}

type Given =
  | { kind: 'play'; midis: number[] }
  | { kind: 'spell'; names: string[]; enharmonic: boolean }
  | { kind: 'name'; answer: NameAnswer }
  | { kind: 'skip' };

const REQUEUE_GAP = 4;
const ADVANCE_RIGHT_MS = 550;
const ADVANCE_SLOW_MS = 1100;

const secs = (ms: number) => `${(ms / 1000).toFixed(2)} s`;

/** How many white keys fit, at no less than 22px a key: two octaves on a phone, up to four. */
function useWhiteKeys(ref: React.RefObject<HTMLElement | null>) {
  const [n, setN] = useState(15);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setN(Math.max(15, Math.min(29, Math.floor(e.contentRect.width / 30)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return n;
}

const WHITE_MIDIS = Array.from({ length: 88 }, (_, i) => i + 21).filter(m => ![1, 3, 6, 8, 10].includes(m % 12));

/** A window of `whites` white keys around the voicing, starting on a C or an F, moved by whole octaves. */
export function playWindow(midis: number[], whites: number, octaves: number): [number, number] {
  const last = WHITE_MIDIS.length - 1;
  // The white keys at or just outside the voicing's lowest and highest notes.
  let lowIdx = WHITE_MIDIS.findIndex(m => m >= Math.min(...midis)) - (WHITE_MIDIS.includes(Math.min(...midis)) ? 0 : 1);
  let highIdx = WHITE_MIDIS.findIndex(m => m >= Math.max(...midis));
  if (highIdx < 0) highIdx = last;
  lowIdx = Math.max(0, lowIdx);
  const isEdge = (i: number) => WHITE_MIDIS[i] % 12 === 0 || WHITE_MIDIS[i] % 12 === 5;
  const fits = (s: number) => s >= 0 && s <= lowIdx && s + whites - 1 >= highIdx && s + whites - 1 <= last;
  // Centred on the voicing, then onto a C or an F — whichever way keeps it all in view.
  const centred = Math.round((lowIdx + highIdx) / 2 - (whites - 1) / 2);
  let start = centred;
  let down = centred;
  while (down > 0 && !isEdge(down)) down--;
  let up = centred;
  while (up < last && !isEdge(up)) up++;
  if (fits(down)) start = down;
  else if (fits(up)) start = up;
  start = Math.max(0, Math.min(last - whites + 1, start + octaves * 7));
  return [WHITE_MIDIS[start], WHITE_MIDIS[Math.min(last, start + whites - 1)]];
}

function Prompt({ step }: { step: RunnerStep }) {
  const v = step.voicing;
  const p = parseChordLabel(v.chord_label);
  const d = p ? chordDisplay(p.rootName, p.quality) : { root: v.chord_label, quality: '' };
  const top = mod12(midisOf(v)[v.notes.length - 1] - v.root);
  return (
    <div className="cr-prompt">
      <div className="cr-chord">
        <span className="cr-root">{d.root}</span>
        <span className="cr-qual">{d.quality}</span>
      </div>
      <div className="cr-sub">
        <span>
          top <b>{pretty(pitchName(v.top_note))}</b> <span className="cr-iv">({intervalDisplay(intervalName(v.quality, top))})</span>
        </span>
        <span className="cr-dot">·</span>
        <span className="cr-family">{v.family}</span>
        <span className="cr-dot">·</span>
        <span>{v.notes.length} notes</span>
      </div>
    </div>
  );
}

function NamePicker({ qualities, onAnswer, disabled }: { qualities: Quality[]; onAnswer: (a: NameAnswer) => void; disabled: boolean }) {
  const [root, setRoot] = useState<number | null>(null);
  const [quality, setQuality] = useState<Quality | null>(null);
  const [top, setTop] = useState<number | null>(null);
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current || root == null || quality == null || top == null) return;
    sent.current = true;
    onAnswer({ root, quality, top });
  }, [root, quality, top, onAnswer]);
  const pick =
    <T,>(set: (x: T) => void, x: T) =>
    (e: React.PointerEvent) => {
      e.preventDefault();
      if (!disabled && !sent.current) set(x);
    };
  const q = quality ?? 'maj7';
  return (
    <div className="nm">
      <div className="nm-row nm-roots" role="group" aria-label="root">
        {/* A black key under both its names: either counts. */}
        {PC_FLAT.map((_, pc) => (
          <button type="button" key={pc} className={`nm-btn nm-root ${root === pc ? 'nm-on' : ''}`} onPointerDown={pick(setRoot, pc)} aria-pressed={root === pc} aria-label={rootNames(pc).join(' or ')}>
            {rootNames(pc).map(n => (
              <span key={n}>{pretty(n)}</span>
            ))}
          </button>
        ))}
      </div>
      <div className="nm-row nm-quals" role="group" aria-label="quality">
        {qualities.map(id => (
          <button type="button" key={id} className={`nm-btn ${quality === id ? 'nm-on' : ''}`} onPointerDown={pick(setQuality, id)} aria-pressed={quality === id}>
            {QUALITY[id].display}
          </button>
        ))}
      </div>
      <div className="nm-label">on top</div>
      <div className="nm-row nm-tops" role="group" aria-label="chord tone on top">
        {Array.from({ length: 12 }, (_, semis) => (
          <button type="button" key={semis} className={`nm-btn ${top === semis ? 'nm-on' : ''}`} onPointerDown={pick(setTop, semis)} aria-pressed={top === semis}>
            {intervalDisplay(intervalName(q, semis))}
          </button>
        ))}
      </div>
    </div>
  );
}

function nameText(a: NameAnswer, rootName?: string): string {
  const root = rootName ? pretty(rootName) : rootNames(a.root).map(pretty).join('/');
  return `${root}${QUALITY[a.quality].display}, ${intervalDisplay(intervalName(a.quality, a.top))} on top`;
}

export function CardRunner({ steps, library, strictSpelling, requeueMisses = false, showSequence = false, onAttempt, onFinish }: Props) {
  const [queue, setQueue] = useState<(RunnerStep & { repeat?: boolean })[]>(steps);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<'ask' | 'feedback'>('ask');
  const [given, setGiven] = useState<Given | null>(null);
  const [result, setResult] = useState<RunnerResult | null>(null);
  const [tapped, setTapped] = useState<number[]>([]);
  const [octaves, setOctaves] = useState(0);
  const results = useRef<RunnerResult[]>([]);
  const t0 = useRef(0);
  /** The card already answered: one answer a card, however fast the taps. */
  const answered = useRef(-1);
  const kbWrap = useRef<HTMLDivElement>(null);
  const whites = useWhiteKeys(kbWrap);

  const step = queue[index];
  const v = step?.voicing;
  const midis = useMemo(() => (v ? midisOf(v) : []), [v]);
  const qualities = useMemo(() => {
    const present = new Set(library.map(x => x.quality));
    return QUALITIES.map(q => q.id).filter(id => present.has(id));
  }, [library]);

  // The clock starts once the card is painted.
  useEffect(() => {
    if (phase !== 'ask') return;
    const id = requestAnimationFrame(() => {
      t0.current = performance.now();
    });
    return () => cancelAnimationFrame(id);
  }, [index, phase]);

  const finish = useCallback(() => onFinish(results.current), [onFinish]);

  const next = useCallback(() => {
    if (index + 1 >= queue.length) {
      finish();
      return;
    }
    setIndex(i => i + 1);
    setPhase('ask');
    setGiven(null);
    setResult(null);
    setTapped([]);
    setOctaves(0);
  }, [index, queue.length, finish]);

  const submit = useCallback(
    (g: Given) => {
      if (phase !== 'ask' || !step || answered.current === index) return;
      answered.current = index;
      const ms = Math.max(0, Math.round(performance.now() - t0.current));
      let correct = false;
      if (g.kind === 'play') correct = gradePlay(step.voicing, g.midis);
      else if (g.kind === 'spell') correct = gradeSpell(step.voicing, g.names, strictSpelling).correct;
      else if (g.kind === 'name') correct = gradeName(step.voicing, g.answer, library);
      const r: RunnerResult = { step, correct, slow: correct && ms > step.target, ms, repeat: !!step.repeat, at: new Date().toISOString() };
      results.current.push(r);
      setGiven(g);
      setResult(r);
      setPhase('feedback');
      onAttempt(r);
      if (!correct && requeueMisses && !step.repeat) {
        setQueue(q => {
          const copy = [...q];
          copy.splice(Math.min(copy.length, index + 1 + REQUEUE_GAP), 0, { ...step, repeat: true });
          return copy;
        });
      }
    },
    [phase, step, strictSpelling, library, onAttempt, requeueMisses, index],
  );

  // A right answer moves on by itself.
  useEffect(() => {
    if (phase !== 'feedback' || !result?.correct) return;
    const id = setTimeout(next, result.slow ? ADVANCE_SLOW_MS : ADVANCE_RIGHT_MS);
    return () => clearTimeout(id);
  }, [phase, result, next]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase === 'feedback' && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, next]);

  const onKey = useCallback(
    (m: number) => {
      if (phase !== 'ask' || !v) return;
      const nextSet = tapped.includes(m) ? tapped.filter(x => x !== m) : [...tapped, m].sort((a, b) => a - b);
      setTapped(nextSet);
      if (nextSet.length >= v.notes.length) submit({ kind: 'play', midis: nextSet });
    },
    [phase, v, tapped, submit],
  );

  if (!step || !v) return null;

  const [pLo, pHi] = playWindow(midis, whites, octaves);
  const labels = Object.fromEntries(v.notes.map((n, i) => [midis[i], pretty(pitchName(n))]));

  // Feedback keyboard: the right voicing, with what was played over it.
  let fbMarks: Record<number, KeyMark> = {};
  let fbRange: [number, number] = rangeAround(midis, 15);
  if (phase === 'feedback') {
    if (given?.kind === 'play' && !result?.correct) {
      for (const m of midis) fbMarks[m] = 'missed';
      for (const m of given.midis) fbMarks[m] = midis.includes(m) ? 'right' : 'wrong';
      fbRange = rangeAround([...midis, ...given.midis], 15);
    } else {
      fbMarks = Object.fromEntries(midis.map(m => [m, result?.correct ? 'right' : 'missed']));
    }
  }

  const pos = queue.length > 1 ? `${index + 1} / ${queue.length}` : '';
  const seq = showSequence ? sequenceAround(queue, index, step.mode === 'name' && phase === 'ask') : null;

  return (
    <div className={`cr cr-${step.mode} cr-${phase}`} data-voicing-id={v.id}>
      <div className="cr-top">
        <span className="cr-mode">{MODE_LABEL[step.mode]}</span>
        {step.group && <span className="cr-group">{step.group}</span>}
        <span className="cr-pos">{pos}</span>
        <button type="button" className="cr-end" onClick={finish}>
          End
        </button>
      </div>

      {seq && (
        <div className="cr-seq" aria-label="where this chord falls">
          {seq.map((s, i) => (
            <span key={i} className={`cr-seq-chord ${s.current ? 'cr-seq-on' : ''}`}>
              {s.label}
            </span>
          ))}
        </div>
      )}

      <div className="cr-clock" key={`${index}-${phase}`}>
        {phase === 'ask' ? (
          <span className="cr-clock-bar" style={{ animationDuration: `${step.target}ms` }} />
        ) : (
          <span className={`cr-clock-done ${result?.correct ? (result.slow ? 'slow' : 'good') : 'fail'}`} style={{ width: `${Math.min(100, (result!.ms / step.target) * 100)}%` }} />
        )}
      </div>

      <div className="cr-card">
        {step.mode !== 'name' && <Prompt step={step} />}
        {step.mode === 'name' && (
          <div className="cr-name-kb">
            <Keyboard low={fbRange[0]} high={fbRange[1]} marks={phase === 'ask' ? Object.fromEntries(midis.map(m => [m, 'on'])) : fbMarks} labels={phase === 'feedback' ? labels : undefined} />
          </div>
        )}

        {phase === 'feedback' && result && (
          <div className={`cr-verdict ${result.correct ? (result.slow ? 'slow' : 'good') : 'fail'}`} role="status">
            <span className="cr-verdict-mark">{result.correct ? '✓' : '✗'}</span>
            <span className="cr-verdict-time">{given?.kind === 'skip' ? 'skipped' : secs(result.ms)}</span>
            {result.slow && <span className="cr-verdict-note">slow · target {secs(step.target)}</span>}
            {given?.kind === 'spell' && given.enharmonic && (
              <span className="cr-verdict-note">
                {result.correct ? 'right notes, ' : ''}written {v.notes.map(n => pretty(pitchName(n))).join(' ')}
              </span>
            )}
            {!result.correct && given?.kind === 'spell' && !given.enharmonic && (
              <span className="cr-verdict-note">
                you: {given.names.map(pretty).join(' ')} · answer: {v.notes.map(n => pretty(pitchName(n))).join(' ')}
              </span>
            )}
            {!result.correct && given?.kind === 'name' && (
              <span className="cr-verdict-note">
                you: {nameText(given.answer)} · answer: {nameText(nameOf(v), parseChordLabel(v.chord_label)?.rootName)}
              </span>
            )}
            {!result.correct && given?.kind === 'play' && <span className="cr-verdict-note">{v.notes.map(n => pretty(n)).join(' ')}</span>}
          </div>
        )}
      </div>

      <div className="cr-input" ref={kbWrap}>
        {step.mode === 'play' &&
          (phase === 'ask' ? (
            <>
              <div className="cr-kb">
                <Keyboard low={pLo} high={pHi} marks={Object.fromEntries(tapped.map(m => [m, 'on']))} onKey={onKey} />
              </div>
              <div className="cr-kb-shift">
                <button type="button" onClick={() => setOctaves(o => o - 1)} aria-label="octave down">
                  ◀ 8va
                </button>
                <span>
                  {tapped.length} / {v.notes.length}
                </span>
                <button type="button" onClick={() => setOctaves(o => o + 1)} aria-label="octave up">
                  8va ▶
                </button>
              </div>
            </>
          ) : (
            <div className="cr-kb">
              <Keyboard low={fbRange[0]} high={fbRange[1]} marks={fbMarks} labels={labels} />
            </div>
          ))}
        {step.mode === 'spell' && (
          <>
            {phase === 'feedback' && (
              <div className="cr-kb cr-kb-small">
                <Keyboard low={fbRange[0]} high={fbRange[1]} marks={fbMarks} labels={labels} />
              </div>
            )}
            {phase === 'ask' && <NotePad key={index} count={v.notes.length} onSubmit={names => submit({ kind: 'spell', names, enharmonic: gradeSpell(v, names, true).enharmonic })} />}
          </>
        )}
        {step.mode === 'name' && phase === 'ask' && <NamePicker key={index} qualities={qualities} onAnswer={answer => submit({ kind: 'name', answer })} disabled={false} />}
      </div>

      <div className="cr-actions">
        {phase === 'ask' ? (
          <button type="button" className="cr-skip" onClick={() => submit({ kind: 'skip' })}>
            Don’t know
          </button>
        ) : (
          <button type="button" className="cr-next" onClick={next} autoFocus={!result?.correct}>
            {index + 1 >= queue.length ? 'Finish' : 'Next'} <kbd>↵</kbd>
          </button>
        )}
      </div>
    </div>
  );
}

/** The chords either side of this one in its progression or tune; in Name mode the one asked is hidden. */
function sequenceAround(queue: RunnerStep[], index: number, hideCurrent: boolean): { label: string; current: boolean }[] {
  const group = queue[index].group;
  const out: { label: string; current: boolean }[] = [];
  for (let i = Math.max(0, index - 3); i <= Math.min(queue.length - 1, index + 3); i++) {
    if (queue[i].group !== group) continue;
    if (hideCurrent && i > index) break;
    const p = parseChordLabel(queue[i].voicing.chord_label);
    const label = p ? `${pretty(p.rootName)}${QUALITY[p.quality].display}` : queue[i].voicing.chord_label;
    out.push({ label: i === index && hideCurrent ? '?' : label, current: i === index });
  }
  return out;
}
