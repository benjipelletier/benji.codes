'use client';

// Review: today's set (lib/drill.ts). The shakiest cards in the deck, a few
// at a time, drilled until each is right and fast three times in a row, then
// each played once in a ii–V–I; solid cards come back for a spaced check.
// Driven by the deck alone — every card in it, all three modes; nothing to set
// up (the owner: "review session should be driven by whatever cards are in my
// deck. Configurable sessions is what practice is for"). A summary at the end:
// how each card came out, accuracy and the slowest cards.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { connectMidi, disconnectMidi, useMidi } from '@voiceshed/lib/midi';
import { CardRunner, type RunnerResult, type RunnerStep } from './CardRunner';
import { fmtPct, fmtSecs, PianoLoader, relTime, signIn, signOut, useCardStats } from './TrainerShell';
import { newId, useTrainer } from './TrainerProvider';
import { useBackClose } from './useBackClose';
import { VoicingDetail } from './VoicingsPage';
import { chips, PlayingCard } from './PlayingCard';
import { Keyboard, rangeAround } from './Keyboard';
import { MIDI_CHORD_MS, MIDI_MOVE_MS, midiShift, TAP_MS, tapsFor, targetFor } from '@voiceshed/lib/srs';
import {
  afterAnswer,
  afterSlot,
  answerDrill,
  demote,
  type Answer,
  chooseSet,
  contextSteps,
  FLUENT_STREAK,
  NEW_AT_ONCE,
  nextSlot,
  startDrill,
  WHY_LABEL,
  type Drill,
  type SetCard,
  type Slot,
} from '@voiceshed/lib/drill';
import { midisOf } from '@voiceshed/lib/practice';
import { FAMILY_SPAN, guessPxPerInch, OCTAVE_MM, WHITE_KEY_MM, whiteKeyPx } from '@voiceshed/lib/scale';
import { prettyLabel } from '@voiceshed/lib/theory';
import { MODES, MODE_LABEL, srsKey, type Mode, type Settings, type SrsState, type Voicing } from '@voiceshed/lib/types';

type DrillStep = RunnerStep & { repeat?: boolean; probe?: string | null };

const MODE_KEY = 'vs-review-mode';

/** Cards in play at once. */
const SET_SIZE = 6;

export function ReviewPage() {
  const t = useTrainer();
  const { voicings, contexts, srs, settings } = t;
  const { gapKeys, grouped } = useCardStats();
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  // Back from a run's summary returns to the set-up.
  useBackClose(phase === 'done', () => setPhase('idle'));
  const [steps, setSteps] = useState<RunnerStep[]>([]);
  const [results, setResults] = useState<RunnerResult[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [status, setStatus] = useState('');
  const [report, setReport] = useState<Slot[]>([]);
  /** A voicing's page, open over the set. */
  const [open, setOpen] = useState<string | null>(null);
  const openV = open ? voicings.find(v => v.id === open) : null;
  const drill = useRef<Drill | null>(null);
  const stage = useRef<'drill' | 'context' | 'over'>('drill');
  /** Schedules written this session, ahead of the provider's state catching up. */
  const written = useRef(new Map<string, SrsState>());

  const targetOf = useCallback((v: Voicing, mode: Mode) => targetFor(srs.get(srsKey(v.id, mode)), mode, settings, v), [srs, settings]);
  // One mode at a time, or all (the owner: "I want a way to only play one mode at a time"), kept on this device.
  const [only, setOnlyState] = useState<Mode | 'all'>('all');
  useEffect(() => {
    try {
      const m = localStorage.getItem(MODE_KEY);
      if (m === 'all' || (MODES as string[]).includes(m ?? '')) setOnlyState(m as Mode | 'all');
    } catch {
      // All, then.
    }
  }, []);
  const setOnly = (m: Mode | 'all') => {
    setOnlyState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      // Not remembered.
    }
  };
  const modes = useMemo(() => (only === 'all' ? [...MODES] : [only]), [only]);
  // The same rules on just that mode's cards: its shaky, its checks, its new ones; the other modes wait.
  const today = useMemo(
    () => chooseSet({ pool: voicings, srs, grouped, gapKeys, modes, targetOf, size: SET_SIZE, fresh: true, now: new Date() }),
    [voicings, srs, grouped, gapKeys, targetOf, modes],
  );
  const inModes = useMemo(() => [...srs.values()].filter(s => modes.includes(s.mode)), [srs, modes]);
  const solid = inModes.filter(s => s.learned).length;

  const stepOf = useCallback(
    (s: Slot): DrillStep => ({ voicing: s.card.voicing, mode: s.card.mode, target: targetOf(s.card.voicing, s.card.mode), context_type: 'isolated', context_id: null, repeat: s.asked > 0 }),
    [targetOf],
  );
  const statusOf = (d: Drill) => {
    const out = d.slots.filter(s => s.status !== 'active').length;
    return `${out} / ${d.slots.length + d.incoming.length} fluent`;
  };

  const start = () => {
    const d = startDrill(today.set, today.incoming, SET_SIZE);
    drill.current = d;
    stage.current = 'drill';
    written.current = new Map();
    const first = nextSlot(d);
    if (!first) return;
    setSteps([stepOf(first)]);
    setStatus(statusOf(d));
    setResults([]);
    setPhase('running');
  };

  // The next card: the drill's, then the set's ii–V–Is, then the end.
  const more = useCallback((): DrillStep[] => {
    const d = drill.current;
    if (!d) return [];
    if (stage.current === 'drill') {
      const s = nextSlot(d);
      if (s) return [stepOf(s)];
      stage.current = 'context';
      const cs = contextSteps(d.slots, contexts, voicings);
      if (cs.length) {
        setStatus('In a ii–V–I');
        return cs.map(c => ({ voicing: c.voicing, mode: c.mode, target: targetOf(c.voicing, c.mode), context_type: 'progression', context_id: c.context_id, symbol: c.symbol, group: c.group, probe: c.probe }));
      }
    }
    stage.current = 'over';
    return [];
  }, [contexts, voicings, stepOf, targetOf]);

  const onAttempt = useCallback(
    (r: RunnerResult) => {
      const step = r.step as DrillStep;
      const { voicing, mode, target } = step;
      void t.recordAttempts([
        {
          id: newId(),
          voicing_id: voicing.id,
          mode,
          context_type: step.context_type,
          context_id: step.context_id,
          run_id: null,
          correct: r.correct,
          slow: r.slow,
          response_ms: r.ms,
          created_at: r.at,
          input: r.input,
        },
      ]);
      const key = srsKey(voicing.id, mode);
      const now = new Date(r.at);
      // As the runner judged it: a keyboard answer against the keyboard's target.
      const a: Answer = !r.correct ? 'miss' : r.slow ? 'slow' : 'fast';
      const prev = written.current.get(key) ?? t.srs.get(key);
      const d = drill.current;
      if (step.context_type === 'isolated' && d) {
        const next = answerDrill(d, key, a);
        drill.current = next;
        setStatus(statusOf(next));
        const rows = new Map<string, SrsState>();
        const cur = (k: string) => rows.get(k) ?? written.current.get(k) ?? t.srs.get(k);
        if (prev) rows.set(key, afterAnswer(prev, a, now));
        const group = next.slots.find(s => s.key === key)?.group;
        // A slip: its inversions aren't solid either until the group graduates.
        if (a !== 'fast')
          for (const s of next.slots) {
            const r = s.group === group && s.key !== key ? cur(s.key) : undefined;
            if (r?.learned) rows.set(s.key, demote(r, now));
          }
        // The cards that left the set with this answer: the whole group.
        for (const s of next.slots) {
          const was = d.slots.find(x => x.key === s.key);
          const r = cur(s.key);
          if (r && was?.status === 'active' && s.status !== 'active') rows.set(s.key, afterSlot(r, s.status, now));
        }
        for (const [k, r] of rows) written.current.set(k, r);
        if (rows.size) void t.saveSrs([...rows.values()]);
        return;
      }
      // In a ii–V–I: the card it checks takes its result; any deck card slow or missed here isn't solid.
      if (step.probe && d) drill.current = { ...d, slots: d.slots.map(s => (s.key === step.probe ? { ...s, context: s.context ?? a } : s)) };
      if (!prev) return;
      const row = afterAnswer(prev, a, now);
      written.current.set(key, row);
      void t.saveSrs([row]);
    },
    [t], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const onFinish = useCallback(
    (rs: RunnerResult[]) => {
      setResults(rs);
      setReport(drill.current?.slots ?? []);
      setPhase('done');
      void t.sync();
    },
    [t],
  );

  if (phase === 'running') {
    return <CardRunner steps={steps} library={voicings} strictSpelling={settings.strict_spelling} showSequence more={more} status={status} onAttempt={onAttempt} onFinish={onFinish} />;
  }
  if (phase === 'done') return <Summary results={results} onAgain={() => setPhase('idle')} extra={<DrillReport slots={report} />} title="Set done" />;

  if (!srs.size) {
    return (
      <div className="vt-page">
        <section className="rv-hero rv-empty">
          <h2 className="sm-title">Your deck is empty</h2>
          <p className="rv-note">
            Review deals only the voicings you put in your deck. Pick some on the Voicings page — a key, a chord, a voicing type — and add them; each brings its
            Play, Spell and Name cards.
          </p>
          <a className="vt-primary rv-go" href="/voiceshed/voicings">
            Choose voicings
          </a>
        </section>
        <OfflinePanel />
      </div>
    );
  }
  const { set, incoming, counts } = today;
  const total = set.length + incoming.length;
  return (
    <div className="vt-page">
      <div className="vt-seg rv-only" role="radiogroup" aria-label="Which cards">
        {(['all', ...MODES] as const).map(m => (
          <button type="button" key={m} role="radio" aria-checked={only === m} className={only === m ? 'on' : ''} onClick={() => setOnly(m)}>
            {m === 'all' ? 'All' : MODE_LABEL[m]}
          </button>
        ))}
      </div>
      <section className="rv-hero">
        <div className="rv-big">
          <span className="rv-num">{counts.shaky}</span>
          <span className="rv-lbl">shaky</span>
        </div>
        <div className="rv-big" title="Solid cards due a check">
          <span className="rv-num rv-num-2">{counts.check}</span>
          <span className="rv-lbl">checks</span>
        </div>
        <div className="rv-big">
          <span className="rv-num rv-num-3">{counts.new}</span>
          <span className="rv-lbl">new</span>
        </div>
        {total > 0 && (
          <>
            <ul className="rv-set" aria-label="Today’s set">
              {chips(set).map(g => (
                <PlayingCard key={g.group} g={g} status={g.why} label={WHY_LABEL[g.why]} onOpen={setOpen} />
              ))}
              {chips(incoming).map((g, i) => (
                <PlayingCard key={g.group} g={g} status={i < NEW_AT_ONCE ? 'new' : 'later'} label={i < NEW_AT_ONCE ? 'new' : 'later'} onOpen={setOpen} />
              ))}
            </ul>
            <p className="rv-legend">
              <span>
                <i className="rv-k rv-k-stack" /> a stack is a chord’s inversions, learned together
              </span>
              <span>
                <i className="rv-k rv-k-shaky" /> shaky
              </span>
              <span>
                <i className="rv-k rv-k-check" /> check
              </span>
              <span>
                <i className="rv-k rv-k-new" /> new
              </span>
              {chips(incoming).length > NEW_AT_ONCE && (
                <span>
                  <i className="rv-k rv-k-later" /> joins when a new one is fast
                </span>
              )}
            </p>
          </>
        )}
        <button type="button" className="vt-primary" onClick={start} disabled={!total}>
          {total ? `Start today’s set · ${total} card${total === 1 ? '' : 's'}` : 'Nothing to review'}
        </button>
        <p className="rv-note">
          Each card stays until it’s right <em>and</em> fast {FLUENT_STREAK} times in a row, then it’s played in a ii–V–I. {solid} of {inModes.length} {only === 'all' ? '' : `${MODE_LABEL[only]} `}cards solid.
        </p>
        <a className="rv-deck-link" href="/voiceshed/voicings?view=deck">
          Your whole deck · {srs.size} cards ›
        </a>
      </section>

      <section className="vt-panel">
        <button type="button" className="vt-panel-head" onClick={() => setShowSettings(s => !s)} aria-expanded={showSettings}>
          Settings <span>{showSettings ? '−' : '+'}</span>
        </button>
        {showSettings && <SettingsForm settings={settings} onSave={s => void t.saveSettings(s)} />}
      </section>

      <OfflinePanel />
      {openV && <VoicingDetail v={openV} onClose={() => setOpen(null)} onOpen={setOpen} />}
    </div>
  );
}

/** How each card of the set came out. */
function DrillReport({ slots }: { slots: Slot[] }) {
  if (!slots.length) return null;
  const how = (s: Slot) =>
    s.status === 'checked'
      ? 'check passed'
      : s.status === 'fluent'
        ? `fluent in ${s.asked}`
        : s.status === 'stuck'
          ? `still shaky after ${s.asked}`
          : s.asked
            ? 'not finished'
            : 'not reached';
  const ctx = (s: Slot) => (s.context == null ? null : s.context === 'fast' ? '✓ in context' : s.context === 'slow' ? 'slow in context' : 'missed in context');
  return (
    <>
      <h3 className="sm-h">Your set</h3>
      <ul className="dr-list">
        {slots.map(s => {
          const ok = (s.status === 'fluent' || s.status === 'checked') && (s.context == null || s.context === 'fast');
          return (
            <li key={s.key} className={`dr-row ${ok ? 'good' : s.status === 'active' ? '' : 'fail'}`}>
              <span className="dr-chord">{prettyLabel(s.card.voicing.chord_label)}</span>
              <span className="dr-mode">{MODE_LABEL[s.card.mode]}</span>
              <span className="dr-how">
                {how(s)}
                {ctx(s) && <em> · {ctx(s)}</em>}
              </span>
              <span className="dr-dots" aria-label={`${s.misses} missed, ${s.slows} slow`}>
                {'●'.repeat(Math.min(10, s.asked - s.misses - s.slows))}
                <i>{'●'.repeat(Math.min(10, s.slows))}</i>
                <b>{'●'.repeat(Math.min(10, s.misses))}</b>
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Recent right answers looked at per mode, for the speed check. */
const SPEED_RECENT = 60;
const SPEED_MIN = 8;
/** Where the thinking time is headed: about a bar at ♩=120. */
const THINK_GOAL = 2000;

/**
 * How fast you think, per mode (the owner: "how do we know the target
 * suggester is suggesting an actual appropriate target and not based on my
 * shitty answers"): each recent right answer less its taps (`tapsFor` ×
 * `TAP_MS`), on solid cards (all right answers while there are too few), so
 * slow typing and cards still being learned don't count. Then a step toward
 * the goal, not a level set by the answers: when under half beat the
 * thinking time, ease it to where three in four do (rounded up to the half
 * second); tighten it 10% (to the tenth, never past the goal) once three in
 * four already beat that tighter time; otherwise it's right where it is.
 */
function SpeedCheck({ settings, onSave }: { settings: Settings; onSave: (s: Settings) => void }) {
  const { attempts, voicings, srs } = useTrainer();
  const byId = useMemo(() => new Map(voicings.map(v => [v.id, v])), [voicings]);
  const rows = useMemo(
    () =>
      MODES.map(m => {
        const right = attempts.filter(a => a.mode === m && a.correct && byId.has(a.voicing_id));
        const solid = right.filter(a => srs.get(srsKey(a.voicing_id, m))?.learned);
        const from = solid.length >= SPEED_MIN ? solid : right;
        const think = from
          .slice(-SPEED_RECENT)
          .map(a => Math.max(0, a.response_ms - tapsFor(byId.get(a.voicing_id)!, m) * TAP_MS[m] + (a.input === 'midi' ? midiShift(byId.get(a.voicing_id)!, m) : 0)))
          .sort((x, y) => x - y);
        const at = (q: number) => think[Math.min(think.length - 1, Math.floor(q * think.length))];
        const base = settings.target_ms[m];
        const within = think.length ? think.filter(x => x <= base).length / think.length : 0;
        let suggest: number | null = null;
        if (think.length >= SPEED_MIN) {
          if (within < 0.5) suggest = Math.max(500, Math.ceil(at(0.75) / 500) * 500);
          else if (base > THINK_GOAL) {
            // Tighten only to a time three in four already beat, so it never bounces back.
            const next = Math.max(THINK_GOAL, Math.round((base * 0.9) / 100) * 100);
            if (think.filter(x => x <= next).length / think.length >= 0.75) suggest = next;
          }
        }
        return { m, n: think.length, solidOnly: from === solid, median: think.length ? at(0.5) : null, p75: think.length ? at(0.75) : null, within, base, suggest };
      }),
    [attempts, byId, srs, settings.target_ms],
  );
  return (
    <div className="sp" aria-label="How fast you think">
      <span className="vt-field-lbl">How fast you think · last {SPEED_RECENT} right answers, less the tapping</span>
      {rows.map(r => (
        <div key={r.m} className="sp-row">
          <b>{MODE_LABEL[r.m]}</b>
          {r.n < SPEED_MIN ? (
            <span className="sp-none">not enough answers yet ({r.n})</span>
          ) : (
            <>
              <span className="sp-nums">
                typical {fmtSecs(r.median)} · 3 in 4 under {fmtSecs(r.p75)}
                <em className={r.within < 0.5 ? 'sp-low' : ''}>
                  {Math.round(r.within * 100)}% beat {fmtSecs(r.base)}
                  {r.solidOnly ? ' · solid cards' : ' · all cards'}
                </em>
              </span>
              {r.suggest != null && r.suggest !== r.base ? (
                <button type="button" className="vt-secondary sp-use" onClick={() => onSave({ ...settings, target_ms: { ...settings.target_ms, [r.m]: r.suggest! } })}>
                  {r.suggest > r.base ? 'Ease to' : 'Tighten to'} {(r.suggest / 1000).toFixed(1)}s
                </button>
              ) : (
                <span className="sp-ok">{r.base <= THINK_GOAL && r.within >= 0.75 ? 'at the goal' : 'about right'}</span>
              )}
            </>
          )}
        </div>
      ))}
      <span className="vt-hint">
        The goal is {fmtSecs(THINK_GOAL)}, about a bar at ♩=120: ease off while most answers miss, tighten as three in four beat it.
      </span>
    </div>
  );
}

function SettingsForm({ settings, onSave }: { settings: Settings; onSave: (s: Settings) => void }) {
  return (
    <div className="vt-form">
      <div className="vt-field">
        <span className="vt-field-lbl">Thinking time</span>
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
        <span className="vt-hint">
          How fast you should know it. Each card adds its typing: {TAP_MS.play / 1000}s a key (Play), {TAP_MS.spell / 1000}s a letter or accidental (Spell), {TAP_MS.name / 1000}s a pick (Name). Played on a MIDI keyboard, a Play card adds {MIDI_CHORD_MS / 1000}s for the whole chord ({MIDI_MOVE_MS / 1000}s more for a move) instead. A card can have its own target, on the Voicings page.
        </span>
        <SpeedCheck settings={settings} onSave={onSave} />
      </div>
      <div className="vt-field">
        <span className="vt-field-lbl">Play and Spell cards show</span>
        <div className="vt-seg" role="radiogroup" aria-label="Notes a card shows">
          {(
            [
              ['both', 'Bottom & top'],
              ['bottom', 'Bottom'],
              ['top', 'Top'],
            ] as const
          ).map(([c, label]) => (
            <button type="button" key={c} role="radio" aria-checked={(settings.cues ?? 'both') === c} className={(settings.cues ?? 'both') === c ? 'on' : ''} onClick={() => onSave({ ...settings, cues: c })}>
              {label}
            </button>
          ))}
        </div>
        <span className="vt-hint">Always with the voicing type. The answer shows both.</span>
      </div>
      <KeyboardSizeField settings={settings} onSave={onSave} />
      <MidiField />
      <label className="vt-check">
        <input type="checkbox" checked={settings.strict_spelling} onChange={e => onSave({ ...settings, strict_spelling: e.target.checked })} />
        Strict spelling (G♯ isn’t A♭ in Spell mode)
      </label>
    </div>
  );
}

/** A bank card is 85.6 mm wide: something to hold against the screen. */
const CARD_MM = 85.6;

/**
 * Play mode's keyboard size: as many keys as fit, or real piano size. Real
 * size takes a one-time check — a bar a bank card wide, nudged until a card
 * held against it matches — because a screen won't say how big its pixels are.
 */
/** A USB MIDI keyboard for Play cards: turn it on here; the browser asks the first time. */
function MidiField() {
  const midi = useMidi();
  const on = midi.status === 'on';
  return (
    <div className="vt-field">
      <span className="vt-field-lbl">MIDI keyboard</span>
      {midi.status === 'unsupported' ? (
        <span className="vt-hint">This browser can’t use a MIDI keyboard — Chrome on Android or a computer can (Safari can’t).</span>
      ) : (
        <>
          <div className="vt-midi">
            {on ? (
              <button type="button" className="vt-secondary" onClick={disconnectMidi}>
                Turn off
              </button>
            ) : (
              <button type="button" className="vt-secondary" onClick={() => void connectMidi()} disabled={midi.status === 'asking'}>
                {midi.status === 'asking' ? 'Asking…' : 'Use a MIDI keyboard'}
              </button>
            )}
            <span className={`vt-midi-st ${on && midi.inputs.length ? 'ok' : ''}`}>
              {midi.status === 'denied'
                ? 'Not allowed — allow MIDI for this site in the browser’s settings'
                : on
                  ? midi.inputs.length
                    ? `🎹 ${midi.inputs.join(', ')}`
                    : 'On — plug the keyboard in (USB-C)'
                  : 'Off'}
            </span>
          </div>
          <span className="vt-hint">
            Play cards take the keys you press: play the voicing, in any octave (not below E♭3). Let go of every key for a moment to start a chord over. The sustain pedal moves on to the next card. The
            keys on screen still work.
          </span>
        </>
      )}
    </div>
  );
}

function KeyboardSizeField({ settings, onSave }: { settings: Settings; onSave: (s: Settings) => void }) {
  const [guess, setGuess] = useState(132);
  useEffect(() => setGuess(guessPxPerInch()), []);
  const ppi = settings.px_per_inch ?? guess;
  const bar = (ppi / 25.4) * CARD_MM;
  const nudge = (d: number) => onSave({ ...settings, px_per_inch: Math.round((ppi + d) * 10) / 10 });
  return (
    <div className="vt-field">
      <span className="vt-field-lbl">Play keyboard</span>
      <div className="vt-seg" role="radiogroup">
        {(
          [
            ['fit', 'Fit the screen'],
            ['big', 'Big keys'],
            ['real', 'Real piano size'],
          ] as const
        ).map(([k, label]) => (
          <button type="button" key={k} role="radio" aria-checked={settings.keyboard_size === k} className={settings.keyboard_size === k ? 'on' : ''} onClick={() => onSave({ ...settings, keyboard_size: k })}>
            {label}
          </button>
        ))}
      </div>
      {settings.keyboard_size === 'big' && (
        <span className="vt-hint">
          About an octave of big keys, for two thumbs. Each card starts with the bottom two in view, somewhere different each time so it gives nothing away, and once you’ve
          played two notes it slides up for the rest. ‹ › and 8va move it too. Turn the phone sideways for more, bigger keys.
        </span>
      )}
      {settings.keyboard_size === 'real' && (
        <div className="ks">
          <span className="vt-hint">
            Keys a piano’s width ({WHITE_KEY_MM} mm, an octave {OCTAVE_MM / 10} cm): about ten white keys on an iPad held sideways; ‹ › and 8va move them. Check
            the size once — hold a bank card against the bar and nudge until they match.
          </span>
          <div className="ks-bar" style={{ width: bar }} aria-label="a bank card's width">
            <span>card width</span>
          </div>
          <div className="vt-inline">
            <button type="button" className="vt-secondary" onClick={() => nudge(-2)} aria-label="smaller">
              − smaller
            </button>
            <button type="button" className="vt-secondary" onClick={() => nudge(2)} aria-label="bigger">
              + bigger
            </button>
            {settings.px_per_inch != null && (
              <button type="button" className="vf-clear" onClick={() => onSave({ ...settings, px_per_inch: null })}>
                Back to the device’s guess
              </button>
            )}
          </div>
          <span className="vt-hint">
            {settings.px_per_inch == null ? 'Sized from the device.' : 'Checked on this device.'} A real white key is {Math.round(whiteKeyPx(settings.px_per_inch))} px here.
          </span>
          <span className="vt-field-lbl">Key size</span>
          <div className="vt-seg" role="radiogroup">
            {[1, 0.9, 0.8, 0.7].map(k => (
              <button type="button" key={k} role="radio" aria-checked={settings.key_scale === k} className={settings.key_scale === k ? 'on' : ''} onClick={() => onSave({ ...settings, key_scale: k })}>
                {k === 1 ? 'Real' : `${Math.round(k * 100)}%`}
              </button>
            ))}
          </div>
          <KeysFit settings={settings} />
        </div>
      )}
    </div>
  );
}

/** How many white keys fit across this screen at the chosen size, and which voicing types then show whole. */
function KeysFit({ settings }: { settings: Settings }) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const m = () => setWidth(Math.max(window.innerWidth, 0) - 32);
    m();
    window.addEventListener('resize', m);
    return () => window.removeEventListener('resize', m);
  }, []);
  if (!width) return null;
  const keys = Math.floor(width / whiteKeyPx(settings.px_per_inch, settings.key_scale));
  const whole = FAMILY_SPAN.filter(([, , max]) => max <= keys).map(([f]) => f);
  const some = FAMILY_SPAN.filter(([, min, max]) => min <= keys && max > keys).map(([f]) => f);
  return (
    <span className="vt-hint">
      <b>{keys} white keys</b> across the screen as it’s held now.{' '}
      {whole.length ? `Whole: ${whole.join(', ')}. ` : ''}
      {some.length ? `Some: ${some.join(', ')}. ` : ''}
      Wider ones need ‹ › to move along (notes already tapped stay). Two-hand drop-2 spans 10–12 white keys.
    </span>
  );
}

export function Summary({ results, onAgain, extra, title = 'Session done' }: { results: RunnerResult[]; onAgain: () => void; extra?: React.ReactNode; title?: string }) {
  const first = results.filter(r => !r.repeat);
  const right = first.filter(r => r.correct);
  const inTime = right.filter(r => !r.slow);
  const avg = right.length ? Math.round(right.reduce((s, r) => s + r.ms, 0) / right.length) : null;
  const slowest = [...first].sort((a, b) => b.ms - a.ms).slice(0, 6);
  return (
    <div className="vt-page">
      <section className="sm">
        <PianoLoader rounds={2} small />
        <h2 className="sm-title">{title}</h2>
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
