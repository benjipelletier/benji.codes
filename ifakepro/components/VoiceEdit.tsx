'use client';

// Edit a chart by talking: "on bar 4… change the D7 to C6". The phone's
// speech recognition (the browser's, as 重复习 uses for answering out loud)
// turns speech into text as it's said; the bars named light up straight
// away, and the text so far goes to the server (app/api/ifakepro/voice.ts)
// whenever it grows, so the chart changes while they're still talking. When
// they stop, the edits are listed to keep or throw away; nothing is saved
// before that. Where the browser has no speech recognition, they type.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ApiError, api } from '@ifakepro/lib/client';
import type { Doc } from '@ifakepro/lib/merge';
import type { VoiceResult } from '@ifakepro/lib/types';

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
};

/** The browser's speech recognition, in the reader's language, if it has one. */
function recogniser(): Recognition | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const R = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!R) return null;
  const r = new R();
  r.lang = navigator.language || 'en-US';
  r.interimResults = true;
  r.continuous = true;
  return r;
}

const ONES: Record<string, number> = {
  zero: 0, one: 1, won: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, fore: 4, five: 5, six: 6, seven: 7, eight: 8, ate: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** A number at words[i] ("12", "twelve", "twenty four", "for"): its value and how many words it took. */
function numberAt(words: string[], i: number): [number, number] | null {
  const w = words[i];
  if (!w) return null;
  if (/^\d+$/.test(w)) return [Number(w), 1];
  if (w in TENS) {
    const next = words[i + 1];
    return next && next in ONES && ONES[next] > 0 && ONES[next] < 10 ? [TENS[w] + ONES[next], 2] : [TENS[w], 1];
  }
  if (w in ONES) return [ONES[w], 1];
  return null;
}

/**
 * The bars the words so far end on ("…on bar 4", "bars nine to twelve",
 * "measure 7"), read on the spot so the bar lights up before the model has
 * answered. Bars past the end of the chart are left out.
 */
export function barsSaid(text: string, count: number): number[] {
  const words = text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  for (let i = words.length - 1; i >= 0; i--) {
    if (!/^(bar|bars|measure|measures)$/.test(words[i])) continue;
    const a = numberAt(words, i + 1);
    if (!a) continue;
    let [from, to] = [a[0], a[0]];
    const j = i + 1 + a[1];
    if (/^(to|through|thru|till|until|and)$/.test(words[j] ?? '')) {
      const b = numberAt(words, j + 1);
      if (b && b[0] > from) to = b[0];
    }
    const out: number[] = [];
    for (let n = from; n <= Math.min(to, count); n++) if (n >= 1) out.push(n);
    return out;
  }
  return [];
}

export interface VoicePreview {
  /** The chart with the edits so far, or null for none yet. */
  doc: Doc | null;
  /** The bars being talked about. */
  focus: number[];
}

type Phase = 'listening' | 'typing' | 'review' | 'saving';

export function VoicePanel({
  songId,
  revision,
  base,
  onPreview,
  onDone,
  onHeight,
}: {
  songId: string;
  /** The revision the edits are made against; `base` is the song at it. */
  revision: number;
  base: Doc;
  onPreview: (p: VoicePreview | null) => void;
  /** Closed: with the saved song, or null when the edits were thrown away. */
  onDone: (saved: { doc: Doc; revision: number } | null) => void;
  /** How tall the panel is, so the page can keep the chart above it. */
  onHeight: (px: number) => void;
}) {
  const [phase, setPhase] = useState<Phase>('listening');
  const [said, setSaid] = useState('');
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState<VoiceResult | null>(null);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const before = useRef(''); // what was said in earlier listening sessions ("Keep talking")
  const seq = useRef(0);
  const inFlight = useRef(false);
  const pending = useRef<{ text: string; final: boolean } | null>(null);
  const latest = useRef<VoiceResult | null>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const closed = useRef(false); // an answer arriving after the panel closed changes nothing
  const count = base.chart.bars.length;

  useLayoutEffect(() => {
    const el = sheet.current;
    if (!el) return;
    const ro = new ResizeObserver(() => onHeight(el.getBoundingClientRect().height));
    ro.observe(el);
    onHeight(el.getBoundingClientRect().height);
    return () => {
      ro.disconnect();
      onHeight(0);
    };
  }, [onHeight]);

  /** Read the words so far on the server; while one read is out, only the newest words wait for the next. */
  const read = useCallback(
    async (text: string, final: boolean) => {
      if (!text.trim()) return;
      if (inFlight.current) {
        pending.current = { text, final: final || (pending.current?.final ?? false) };
        return;
      }
      inFlight.current = true;
      setThinking(true);
      const mine = ++seq.current;
      try {
        const r = await api<VoiceResult>(`/songs/${songId}/voice`, { body: { revision, transcript: text, final } });
        if (!closed.current && (mine === seq.current || final)) {
          latest.current = r;
          setResult(r);
          setError(null);
          onPreview({ doc: r.preview, focus: r.focus.length ? r.focus : barsSaid(text, count) });
        }
      } catch (e) {
        if (closed.current) return;
        setError(e instanceof ApiError && e.status === 409 ? 'Someone changed the song just now. Close this and try again.' : e instanceof Error ? e.message : 'That didn’t work');
      } finally {
        inFlight.current = false;
        setThinking(false);
        const next = pending.current;
        pending.current = null;
        if (next) void read(next.text, next.final);
      }
    },
    [songId, revision, count, onPreview],
  );

  const listen = useCallback(() => {
    const r = recogniser();
    if (!r) {
      setPhase('typing');
      return;
    }
    rec.current = r;
    // Only the current recogniser speaks: one stopped earlier still reports its end (late, from the browser).
    r.onresult = (e) => {
      if (rec.current !== r) return;
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      const all = `${before.current} ${text}`.trim();
      setSaid(all);
    };
    r.onend = () => {
      if (rec.current !== r) return;
      rec.current = null;
      setPhase((p) => (p === 'listening' ? 'review' : p));
    };
    r.onerror = (e) => {
      if (rec.current !== r) return;
      rec.current = null;
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      setError(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'The microphone is blocked for this site. Allow it, or type instead.' : `Speech recognition stopped (${e.error}). You can type instead.`);
      setPhase('typing');
    };
    setPhase('listening');
    try {
      r.start();
    } catch {
      setPhase('typing');
    }
  }, []);

  useEffect(() => {
    listen();
    return () => {
      const r = rec.current;
      rec.current = null;
      r?.stop();
    };
  }, [listen]);

  // As the words come in: light up the bars named at once, then read them (debounced).
  useEffect(() => {
    if (phase !== 'listening' || !said) return;
    const focus = barsSaid(said, count);
    if (focus.length) onPreview({ doc: latest.current?.preview ?? null, focus });
    const t = window.setTimeout(() => void read(said, false), 350);
    return () => window.clearTimeout(t);
  }, [said, phase, count, read, onPreview]);

  // Done talking: one last read of everything, which may retry refused edits.
  useEffect(() => {
    if (phase === 'review' && said) void read(said, true);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const stop = () => {
    // Done: review now, rather than waiting for the browser to say it has stopped.
    const r = rec.current;
    rec.current = null;
    r?.stop();
    setPhase('review');
  };
  const keepTalking = () => {
    before.current = said;
    listen();
  };
  const submitTyped = () => {
    const text = typed.trim();
    if (!text) return;
    setSaid(text);
    setPhase('review');
  };
  const keep = async () => {
    const r = latest.current;
    if (!r?.ops.length) return;
    setPhase('saving');
    try {
      const saved = await api<{ revision: number; meta: Doc['meta']; chart: Doc['chart'] }>(`/songs/${songId}/voice/apply`, {
        body: { revision, ops: r.ops, transcript: r.heard || said },
      });
      closed.current = true;
      onDone({ doc: { meta: saved.meta, chart: saved.chart }, revision: saved.revision });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save');
      setPhase('review');
    }
  };
  const discard = () => {
    closed.current = true;
    const r = rec.current;
    rec.current = null;
    r?.stop();
    onPreview(null);
    onDone(null);
  };

  const saving = phase === 'saving';
  const ready = phase === 'review' && !thinking && !!result?.ops.length;
  return (
    <div className="voice-sheet" ref={sheet} role="region" aria-label="Voice edit">
      <div className="voice-head">
        <span className={`voice-dot ${phase === 'listening' ? 'on' : ''}`} aria-hidden />
        <span className="voice-state" aria-live="polite">
          {phase === 'listening' ? 'Listening… say a bar and what to change' : phase === 'typing' ? 'Type what to change' : phase === 'saving' ? 'Saving…' : thinking ? 'Working it out…' : !said ? 'Didn’t hear anything' : result?.ops.length ? 'Keep these changes?' : 'Nothing to change yet'}
        </span>
        {phase === 'listening' && (
          <button className="ifp-btn small primary" onClick={stop}>
            Done
          </button>
        )}
        <button className="ifp-icon-btn" onClick={discard} aria-label="Close and throw away the changes">
          ✕
        </button>
      </div>

      {phase === 'typing' ? (
        <form
          className="voice-type"
          onSubmit={(e) => {
            e.preventDefault();
            submitTyped();
          }}
        >
          <input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="On bar 4, change the D7 to C6"
            aria-label="What to change"
          />
          <button className="ifp-btn small primary" type="submit" disabled={!typed.trim()}>
            Go
          </button>
        </form>
      ) : (
        <p className={`voice-said ${said ? '' : 'empty'}`}>{said || '“On bar 4… change the D7 to C6”'}</p>
      )}

      {result && (result.summary.length > 0 || result.errors.length > 0) && (
        <ul className="voice-changes">
          {result.summary.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
          {phase !== 'listening' && result.errors.map((s, i) => <li key={`e${i}`} className="bad">{s}</li>)}
        </ul>
      )}
      {error && <p className="voice-error">{error}</p>}

      {(phase === 'review' || phase === 'saving') && (
        <div className="voice-actions">
          <button className="ifp-btn primary" onClick={keep} disabled={!ready}>
            ✓ Keep changes
          </button>
          {recogniserAvailable() && (
            <button className="ifp-btn" onClick={keepTalking} disabled={saving}>
              🎙 Keep talking
            </button>
          )}
          <button className="ifp-btn" onClick={discard} disabled={saving}>
            Throw away
          </button>
        </div>
      )}
      {phase === 'listening' && (
        <button
          className="ifp-link voice-switch"
          onClick={() => {
            const r = rec.current;
            rec.current = null;
            r?.stop();
            setPhase('typing');
          }}
        >
          Type instead
        </button>
      )}
    </div>
  );
}

function recogniserAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return !!(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}
