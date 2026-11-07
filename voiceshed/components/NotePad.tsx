'use client';

// Spell mode's input: A–G plus sharp and flat, no typing. A letter adds a
// note; ♭ or ♯ then changes the note before it (tap A, then ♭: A♭), as it's
// said. Once as many notes are in as the voicing has, the pad waits a moment
// for an accidental on the last one, then submits itself — timed from the
// last tap, so the wait never counts against you. On a computer: the letters
// a–g, then "-" for flat, "=" or "#" for sharp; Backspace takes back an
// accidental, then the note.

import { useEffect, useRef, useState } from 'react';
import { pretty } from '@voiceshed/lib/theory';

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
/** How long a full pad waits for ♭ or ♯ on its last note. */
const GRACE_MS = 650;

interface Props {
  count: number;
  /** The last slot is where the top voice moves to: an arrow before it. */
  moveSlot?: boolean;
  /** The names, and when the last of them was tapped (performance.now()). */
  onSubmit: (names: string[], at: number) => void;
  disabled?: boolean;
}

export function NotePad({ count, moveSlot = false, onSubmit, disabled = false }: Props) {
  const [names, setNames] = useState<string[]>([]);
  const namesRef = useRef(names);
  namesRef.current = names;
  const sent = useRef(false);
  const lastAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const send = (list: string[]) => {
    if (sent.current) return;
    sent.current = true;
    if (timer.current) clearTimeout(timer.current);
    onSubmit(list, lastAt.current);
  };
  /** A full pad submits after the grace wait; a change in the meantime restarts it. */
  const arm = (list: string[]) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (list.length >= count) timer.current = setTimeout(() => send(namesRef.current), GRACE_MS);
  };
  const set = (list: string[]) => {
    namesRef.current = list;
    setNames(list);
  };

  const add = (letter: string) => {
    if (disabled || sent.current || namesRef.current.length >= count) return;
    lastAt.current = performance.now();
    const next = [...namesRef.current, letter];
    set(next);
    arm(next);
  };
  /** ♭ or ♯ on the note before; the same one again takes it off, the other swaps it. */
  const accidental = (acc: 'b' | '#') => {
    const cur = namesRef.current;
    if (disabled || sent.current || !cur.length) return;
    lastAt.current = performance.now();
    const last = cur[cur.length - 1];
    const letter = last[0];
    const changed = last.slice(1) === acc ? letter : letter + acc;
    const next = [...cur.slice(0, -1), changed];
    set(next);
    // An accidental on the last note finishes the pad at once.
    if (next.length >= count && changed !== letter) send(next);
    else arm(next);
  };
  const back = () => {
    const cur = namesRef.current;
    if (disabled || sent.current || !cur.length) return;
    const last = cur[cur.length - 1];
    const next = last.length > 1 ? [...cur.slice(0, -1), last[0]] : cur.slice(0, -1);
    set(next);
    arm(next);
  };

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      const k = e.key;
      if (/^[a-gA-G]$/.test(k)) {
        e.preventDefault();
        add(k.toUpperCase());
      } else if (k === '-' || k === '_') {
        e.preventDefault();
        accidental('b');
      } else if (k === '=' || k === '#' || k === '+') {
        e.preventDefault();
        accidental('#');
      } else if (k === 'Backspace') {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, disabled]);

  const down = (fn: () => void) => (e: React.PointerEvent) => {
    e.preventDefault();
    fn();
  };
  const full = names.length >= count;

  return (
    <div className="np">
      <div className="np-slots" aria-live="polite">
        {Array.from({ length: count }, (_, i) => (
          <span key={i} className="np-slot-wrap">
            {moveSlot && i === count - 1 && <span className="np-arrow" aria-label="moves to">→</span>}
            <span className={`np-slot ${names[i] ? 'np-slot-on' : ''} ${i === names.length ? 'np-slot-next' : ''} ${full && i === count - 1 ? 'np-slot-wait' : ''}`}>
              {names[i] ? pretty(names[i]) : ''}
            </span>
          </span>
        ))}
      </div>
      <div className="np-keys">
        {LETTERS.map(l => (
          <button type="button" key={l} className="np-letter" onPointerDown={down(() => add(l))} disabled={disabled || full}>
            {l}
          </button>
        ))}
      </div>
      <div className="np-mods">
        <button type="button" className="np-acc" onPointerDown={down(() => accidental('b'))} disabled={disabled || !names.length} aria-label="flat the note before">
          ♭
        </button>
        <button type="button" className="np-acc" onPointerDown={down(() => accidental('#'))} disabled={disabled || !names.length} aria-label="sharpen the note before">
          ♯
        </button>
        <button type="button" className="np-back" onPointerDown={down(back)} disabled={disabled || !names.length} aria-label="undo">
          ⌫
        </button>
      </div>
    </div>
  );
}
