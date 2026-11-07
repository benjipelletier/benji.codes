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
import { useBackClose } from './useBackClose';
import { useTrainer } from './TrainerProvider';
import { whiteKeyPx } from '@voiceshed/lib/scale';
import { gradeName, gradePlay, gradeSpell, hasRoot, midisOf, nameOf, spellNames, type NameAnswer } from '@voiceshed/lib/practice';
import { chordDisplay, intervalDisplay, intervalName, mod12, parseChordLabel, pitchName, pretty, PC_FLAT, QUALITIES, QUALITY, rootNames, prettyLabel, noteMidi, type Quality } from '@voiceshed/lib/theory';
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
  | { kind: 'play'; midis: number[]; moveTo: number | null }
  | { kind: 'spell'; names: string[]; enharmonic: boolean }
  | { kind: 'name'; answer: NameAnswer }
  | { kind: 'skip' };

const REQUEUE_GAP = 4;
const ADVANCE_RIGHT_MS = 550;
const ADVANCE_SLOW_MS = 1100;

/** The answer as notes: "C G♭ B♭ F → E♭" for a voicing whose top moves. */
const answerText = (v: Voicing) => {
  const names = spellNames(v).map(pretty);
  return v.top_move ? `${names.slice(0, -1).join(' ')} → ${names[names.length - 1]}` : names.join(' ');
};

const secs = (ms: number) => `${(ms / 1000).toFixed(2)} s`;

/**
 * How many white keys the Play keyboard shows, and how tall it is. Fit: as
 * many as fit at no less than 30px a key (two octaves on a phone, up to
 * four). Real size: keys a real piano's width (`keyPx`), as many as fit —
 * about ten on an iPad held sideways — as long as the screen leaves room for
 * (up to a real key's length, never under three widths).
 */
function useKeyboardFit(ref: React.RefObject<HTMLElement | null>, keyPx: number | null) {
  const [box, setBox] = useState({ width: 0, height: 800 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox({ width: el.getBoundingClientRect().width, height: window.innerHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [ref]);
  if (!keyPx) return { whites: box.width ? Math.max(15, Math.min(29, Math.floor(box.width / 30))) : 15, aspect: undefined, width: undefined };
  const whites = Math.max(5, Math.floor((box.width || keyPx * 10) / keyPx));
  // Height: what the screen spares beside the card (half of it), up to a real key's 6.4 widths.
  const height = Math.max(keyPx * 3, Math.min(keyPx * 6.4, box.height * 0.5));
  return { whites, aspect: height / keyPx, width: whites * keyPx };
}

const WHITE_MIDIS = Array.from({ length: 88 }, (_, i) => i + 21).filter(m => ![1, 3, 6, 8, 10].includes(m % 12));

/** A window of `whites` white keys around the voicing, starting on a C or an F, moved by `shift` white keys. */
export function playWindow(midis: number[], whites: number, shift: number): [number, number] {
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
  // Too wide to show whole (real-size keys): start from its bottom note, so you
  // play up from the left hand and move right once, rather than both ends cut.
  else if (highIdx - lowIdx + 1 > whites) start = lowIdx;
  start = Math.max(0, Math.min(last - whites + 1, start + shift));
  return [WHITE_MIDIS[start], WHITE_MIDIS[Math.min(last, start + whites - 1)]];
}

/** Where the top voice moves: " → ♭3" while it's asked (the note is the answer), " → E♭ (♭3)" after. */
function MoveText({ v, reveal }: { v: Voicing; reveal: boolean }) {
  if (!v.top_move) return null;
  const iv = intervalDisplay(intervalName(v.quality, mod12(noteMidi(v.top_move) - v.root)));
  return (
    <span className="cr-move">
      {' '}→{' '}
      {reveal ? (
        <>
          <b>{pretty(pitchName(v.top_move))}</b> <span className="cr-iv">({iv})</span>
        </>
      ) : (
        <b>{iv}</b>
      )}
    </span>
  );
}

/**
 * Sideways only while cards run (the owner: "allow me to play in landscape
 * mode on my phone but only … when I'm reviewing cards"). The installed app is
 * portrait (its manifest); a run unlocks it, and leaving the run locks it back.
 * In a browser tab, where a page can't lock, `vt-running` lets the "turn it
 * upright" cover (TrainerShell) stand aside during the run.
 */
function useRunOrientation() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('vt-running');
    const o = typeof screen !== 'undefined' ? (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }) : null;
    o?.lock?.('any').catch(() => undefined);
    return () => {
      root.classList.remove('vt-running');
      try {
        o?.unlock?.();
      } catch {
        // Not locked: nothing to undo.
      }
    };
  }, []);
}

/** A voicing type as a card's header: a short name and what qualifies it. */
function typeCue(v: Voicing): [string, string] {
  // Root or not, always said (the owner: "is it obvious when a chord is rootless versus has a root").
  const root = hasRoot(v) ? 'has root' : 'rootless';
  if (v.family === 'drop-2 two-hand') return ['Drop-2', `two-hand · ${root}`];
  if (v.family === 'right-hand rootless') return ['Right-hand', root];
  if (v.family === 'closed (block)') return ['Block', `${v.notes.length} notes · ${root}`];
  return [v.family, `${v.notes.length} notes · ${root}`];
}

/**
 * The chord, then three headers, easy to see (the owner: "bottom note, what
 * kind of voicing, and then the top note … three big headers"): the bottom
 * note (it's built from the bottom up), the voicing type, the top note and
 * where it moves. Settings choose which notes show (`cues`).
 */
function Prompt({ step, reveal = false }: { step: RunnerStep; reveal?: boolean }) {
  const { settings } = useTrainer();
  const v = step.voicing;
  const p = parseChordLabel(v.chord_label);
  const d = p ? chordDisplay(p.rootName, p.quality) : { root: v.chord_label, quality: '' };
  const m = midisOf(v);
  const iv = (midi: number) => intervalDisplay(intervalName(v.quality, mod12(midi - v.root)));
  /** A chord tone as a number: "♭3", "5", "1" for the root. */
  const tone = (midi: number) => (mod12(midi - v.root) === 0 ? '1' : iv(midi));
  const cues = reveal ? 'both' : (settings.cues ?? 'both');
  const [type, typeSub] = typeCue(v);
  return (
    <div className="cr-prompt">
      <div className="cr-chord">
        <span className="cr-root">{d.root}</span>
        <span className="cr-qual">{d.quality}</span>
      </div>
      {v.tags.includes('iii') && (
        // The iii's rule as a little sticker (the owner: "a big warning sign that says
        // no 9!" … "make the no 9 warning cuter"): a 9 crossed out, a wiggle.
        <div className="cr-no9" role="note" aria-label="No 9: iii of the key, play the 8 instead">
          <span className="cr-no9-nine" aria-hidden>
            9
          </span>
          <span className="cr-no9-text">
            <b>No 9!</b>
            <span>it's the iii · play the 8</span>
          </span>
        </div>
      )}
      <div className="cr-cues">
        {cues !== 'top' && (
          <div className="cr-cue">
            <span className="cr-cue-lbl">Bottom</span>
            {/* The chord tone only, while asked (the owner: "showing the note is giving too much away"); the note with the answer. */}
            <b>{tone(m[0])}</b>
            {reveal && <span className="cr-iv">{pretty(pitchName(v.notes[0]))}</span>}
          </div>
        )}
        <div className="cr-cue cr-cue-type">
          <span className="cr-cue-lbl">Voicing</span>
          <b>{type}</b>
          <span className="cr-iv">{typeSub}</span>
        </div>
        {cues !== 'bottom' && (
          <div className="cr-cue">
            <span className="cr-cue-lbl">Top</span>
            <b>{tone(m[m.length - 1])}</b>
            <span className="cr-iv">
              {reveal && pretty(pitchName(v.top_note))}
              {v.top_move && <MoveText v={v} reveal={reveal} />}
            </span>
          </div>
        )}
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
  /** White keys the Play keyboard has been moved by (an octave is 7). */
  const [shift, setShift] = useState(0);
  const results = useRef<RunnerResult[]>([]);
  const t0 = useRef(0);
  useRunOrientation();
  /** The card already answered: one answer a card, however fast the taps. */
  const answered = useRef(-1);
  const kbWrap = useRef<HTMLDivElement>(null);
  const { settings } = useTrainer();
  const keyPx = settings.keyboard_size === 'real' ? whiteKeyPx(settings.px_per_inch, settings.key_scale) : null;
  const fit = useKeyboardFit(kbWrap, keyPx);
  const whites = fit.whites;

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
  // Back ends the run, as END does.
  useBackClose(true, finish);

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
    setShift(0);
  }, [index, queue.length, finish]);

  /** `at`: when the answer was in (the note pad's last tap), if not now. */
  const submit = useCallback(
    (g: Given, at?: number) => {
      if (phase !== 'ask' || !step || answered.current === index) return;
      answered.current = index;
      const ms = Math.max(0, Math.round((at ?? performance.now()) - t0.current));
      let correct = false;
      if (g.kind === 'play') correct = gradePlay(step.voicing, g.midis, g.moveTo);
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
      // The chord is down and the top voice moves: the next new key is where it goes.
      // Lifting the old top (or touching any held key) on the way is fine.
      if (v.top_move && tapped.length >= v.notes.length) {
        if (!tapped.includes(m)) submit({ kind: 'play', midis: tapped, moveTo: m });
        return;
      }
      const nextSet = tapped.includes(m) ? tapped.filter(x => x !== m) : [...tapped, m].sort((a, b) => a - b);
      setTapped(nextSet);
      if (nextSet.length >= v.notes.length && !v.top_move) submit({ kind: 'play', midis: nextSet, moveTo: null });
    },
    [phase, v, tapped, submit],
  );

  if (!step || !v) return null;

  const [pLo, pHi] = playWindow(midis, whites, shift);
  const moveMidi = v.top_move ? noteMidi(v.top_move) : null;
  const labels = Object.fromEntries([...v.notes.map((n, i) => [midis[i], pretty(pitchName(n))]), ...(v.top_move ? [[moveMidi!, `→${pretty(pitchName(v.top_move))}`]] : [])]);
  const moving = step.mode === 'play' && !!v.top_move && tapped.length >= v.notes.length && phase === 'ask';

  // Feedback keyboard: the right voicing, with what was played over it.
  let fbMarks: Record<number, KeyMark> = {};
  let fbRange: [number, number] = rangeAround(midis, 15);
  if (phase === 'feedback') {
    if (given?.kind === 'play' && !result?.correct) {
      for (const m of midis) fbMarks[m] = 'missed';
      if (moveMidi != null) fbMarks[moveMidi] = 'move';
      for (const m of given.midis) fbMarks[m] = midis.includes(m) ? 'right' : 'wrong';
      if (given.moveTo != null) fbMarks[given.moveTo] = given.moveTo === moveMidi ? 'right' : 'wrong';
      fbRange = rangeAround([...midis, ...given.midis, ...(moveMidi != null ? [moveMidi] : []), ...(given.moveTo != null ? [given.moveTo] : [])], 15);
    } else {
      fbMarks = Object.fromEntries(midis.map(m => [m, result?.correct ? 'right' : 'missed']));
      if (moveMidi != null) fbMarks[moveMidi] = 'move';
      if (moveMidi != null) fbRange = rangeAround([...midis, moveMidi], 15);
    }
  }

  // Real size: Play's answer stays on the same keys, at the same size, when it fits there.
  const shown = step.mode === 'play' && keyPx && Object.keys(fbMarks).map(Number).every(m => m >= pLo && m <= pHi);
  if (shown) fbRange = [pLo, pHi];
  const kbStyle = keyPx && step.mode === 'play' ? { width: fit.width, margin: '0 auto' } : undefined;
  const kbAspect = keyPx && step.mode === 'play' && shown !== false ? fit.aspect : undefined;

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
        {/* Name mode hides the chord until it's answered; then it's shown like any prompt. */}
        {(step.mode !== 'name' || phase === 'feedback') && <Prompt step={step} reveal={phase === 'feedback'} />}
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
                {result.correct ? 'right notes, ' : ''}written {answerText(v)}
              </span>
            )}
            {!result.correct && given?.kind === 'spell' && !given.enharmonic && (
              <span className="cr-verdict-note">
                you: {given.names.map(pretty).join(' ')} · answer: {answerText(v)}
              </span>
            )}
            {!result.correct && given?.kind === 'name' && (
              <span className="cr-verdict-note">
                you: {nameText(given.answer)} · answer: {nameText(nameOf(v), parseChordLabel(v.chord_label)?.rootName)}
              </span>
            )}
            {!result.correct && (given?.kind === 'play' || given?.kind === 'skip') && (
              <span className="cr-verdict-note">
                answer: {prettyLabel(v.chord_label)} · {answerText(v)}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="cr-input" ref={kbWrap}>
        {step.mode === 'play' &&
          (phase === 'ask' ? (
            <>
              <div className={`cr-kb ${keyPx ? 'cr-kb-real' : ''}`} style={kbStyle}>
                <Keyboard low={pLo} high={pHi} marks={Object.fromEntries(tapped.map(m => [m, moving && m === tapped[tapped.length - 1] ? 'lift' : 'on']))} onKey={onKey} aspect={fit.aspect} />
              </div>
              <div className="cr-kb-shift">
                <span className="cr-kb-move">
                  <button type="button" onClick={() => setShift(o => o - 7)} aria-label="octave down">
                    ◀ 8va
                  </button>
                  {keyPx && (
                    <button type="button" onClick={() => setShift(o => o - 1)} aria-label="one key down">
                      ‹
                    </button>
                  )}
                </span>
                <span className={moving ? 'cr-moving' : ''}>{moving ? 'now move the top' : `${tapped.length} / ${v.notes.length}`}</span>
                <span className="cr-kb-move">
                  {keyPx && (
                    <button type="button" onClick={() => setShift(o => o + 1)} aria-label="one key up">
                      ›
                    </button>
                  )}
                  <button type="button" onClick={() => setShift(o => o + 7)} aria-label="octave up">
                    8va ▶
                  </button>
                </span>
              </div>
            </>
          ) : (
            <div className={`cr-kb ${keyPx ? 'cr-kb-real' : ''}`} style={shown ? kbStyle : undefined}>
              <Keyboard low={fbRange[0]} high={fbRange[1]} marks={fbMarks} labels={labels} aspect={kbAspect} />
            </div>
          ))}
        {step.mode === 'spell' && (
          <>
            {phase === 'feedback' && (
              <div className="cr-kb cr-kb-small">
                <Keyboard low={fbRange[0]} high={fbRange[1]} marks={fbMarks} labels={labels} />
              </div>
            )}
            {phase === 'ask' && <NotePad key={index} count={spellNames(v).length} moveSlot={!!v.top_move} onSubmit={(names, at) => submit({ kind: 'spell', names, enharmonic: gradeSpell(v, names, true).enharmonic }, at)} />}
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
