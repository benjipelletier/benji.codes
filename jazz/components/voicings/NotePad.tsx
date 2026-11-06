'use client';

// Spell mode's input: A–G plus sharp and flat, no typing. ♭ or ♯ is armed
// first and applies to the next letter, so the last note can still take an
// accidental before the pad submits itself — which it does the moment as
// many notes are in as the voicing has. On a computer: the letters a–g,
// "-" for flat, "=" or "#" for sharp, Backspace to take one back.

import { useEffect, useRef, useState } from 'react';
import { pretty } from '@jazz/lib/voicings/theory';

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

interface Props {
  count: number;
  onSubmit: (names: string[]) => void;
  disabled?: boolean;
}

export function NotePad({ count, onSubmit, disabled = false }: Props) {
  const [names, setNames] = useState<string[]>([]);
  const [acc, setAcc] = useState<'' | 'b' | '#'>('');
  const sent = useRef(false);
  const stateRef = useRef({ names, acc });
  stateRef.current = { names, acc };

  const add = (letter: string) => {
    if (disabled || sent.current) return;
    const next = [...stateRef.current.names, letter + stateRef.current.acc];
    setNames(next);
    setAcc('');
    if (next.length >= count) {
      sent.current = true;
      onSubmit(next);
    }
  };
  const back = () => {
    if (disabled || sent.current) return;
    if (stateRef.current.acc) setAcc('');
    else setNames(n => n.slice(0, -1));
  };
  const arm = (a: 'b' | '#') => {
    if (disabled || sent.current) return;
    setAcc(cur => (cur === a ? '' : a));
  };

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
        arm('b');
      } else if (k === '=' || k === '#' || k === '+') {
        e.preventDefault();
        arm('#');
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

  return (
    <div className="np">
      <div className="np-slots" aria-live="polite">
        {Array.from({ length: count }, (_, i) => (
          <span key={i} className={`np-slot ${names[i] ? 'np-slot-on' : ''} ${i === names.length ? 'np-slot-next' : ''}`}>
            {names[i] ? pretty(names[i]) : i === names.length && acc ? (acc === 'b' ? '♭' : '♯') : ''}
          </span>
        ))}
      </div>
      <div className="np-keys">
        {LETTERS.map(l => (
          <button type="button" key={l} className="np-letter" onPointerDown={down(() => add(l))} disabled={disabled}>
            {l}
          </button>
        ))}
      </div>
      <div className="np-mods">
        <button type="button" className={`np-acc ${acc === 'b' ? 'np-acc-on' : ''}`} onPointerDown={down(() => arm('b'))} disabled={disabled} aria-label="flat" aria-pressed={acc === 'b'}>
          ♭
        </button>
        <button type="button" className={`np-acc ${acc === '#' ? 'np-acc-on' : ''}`} onPointerDown={down(() => arm('#'))} disabled={disabled} aria-label="sharp" aria-pressed={acc === '#'}>
          ♯
        </button>
        <button type="button" className="np-back" onPointerDown={down(back)} disabled={disabled || (!names.length && !acc)} aria-label="undo">
          ⌫
        </button>
      </div>
    </div>
  );
}
