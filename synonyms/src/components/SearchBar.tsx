'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  placeholder?: string;
}

export default function SearchBar({ placeholder = 'Enter a Chinese word...' }: Props) {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const word = input.trim();
    if (!word) return;
    if (!/[\u4e00-\u9fff]/.test(word)) {
      setError('Please enter a Chinese character');
      return;
    }
    setError('');
    router.push(`/cluster/${encodeURIComponent(word)}`);
  }

  return (
    <form onSubmit={handleSubmit} style={s.form}>
      <div style={s.row}>
        <input
          type="text"
          value={input}
          onChange={(e) => { setInput(e.target.value); setError(''); }}
          placeholder={placeholder}
          style={s.input}
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" style={s.btn}>探索 →</button>
      </div>
      {error && <p style={s.error}>{error}</p>}
    </form>
  );
}

const s: Record<string, React.CSSProperties> = {
  form: { display: 'flex', flexDirection: 'column', gap: '8px' },
  row: { display: 'flex', gap: '8px' },
  input: {
    flex: 1,
    background: 'rgba(217,164,65,0.06)',
    border: '1px solid rgba(217,164,65,0.25)',
    borderRadius: '6px',
    padding: '12px 16px',
    color: '#e8d5b0',
    fontSize: '16px',
    fontFamily: 'inherit',
    outline: 'none',
  },
  btn: {
    background: 'rgba(217,164,65,0.15)',
    border: '1px solid rgba(217,164,65,0.4)',
    borderRadius: '6px',
    padding: '12px 20px',
    color: '#d9a441',
    fontSize: '14px',
    fontFamily: 'inherit',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  error: {
    fontSize: '12px',
    color: '#d94141',
  },
};
