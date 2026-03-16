'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';

const GalaxyGraph = dynamic(() => import('../components/GalaxyGraph'), { ssr: false });

export default function HomePage() {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Press '/' anywhere to focus search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === '/' && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const word = input.trim();
    if (!word) return;
    if (!/[\u4e00-\u9fff]/.test(word)) {
      setError('Please enter a Chinese character or word');
      return;
    }
    setError('');
    router.push(`/cluster/${encodeURIComponent(word)}`);
  }

  return (
    <>
      {/* Full-screen graph */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 0 }}>
        <GalaxyGraph />
      </div>

      {/* Top overlay bar */}
      <div style={s.topBar}>
        <span className="zh" style={s.title}>同义词星图</span>

        <form onSubmit={handleSubmit} style={s.form}>
          <div style={s.inputWrap}>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => { setInput(e.target.value); setError(''); }}
              placeholder="探索词语..."
              style={s.input}
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit" style={s.btn}>→</button>
          </div>
          {error && <p style={s.error}>{error}</p>}
        </form>
      </div>
    </>
  );
}

const s: Record<string, React.CSSProperties> = {
  topBar: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 24px',
    background: 'linear-gradient(to bottom, rgba(10,8,6,0.85) 0%, rgba(10,8,6,0) 100%)',
  },
  title: {
    fontSize: '22px',
    color: '#d9a441',
    letterSpacing: '0.05em',
    textShadow: '0 0 20px rgba(217,164,65,0.4)',
    flexShrink: 0,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '4px',
  },
  inputWrap: {
    display: 'flex',
    gap: '6px',
  },
  input: {
    background: 'rgba(10,8,6,0.7)',
    border: '1px solid rgba(217,164,65,0.3)',
    borderRadius: '6px',
    padding: '8px 14px',
    color: '#e8d5b0',
    fontSize: '15px',
    fontFamily: 'inherit',
    outline: 'none',
    width: '200px',
    backdropFilter: 'blur(8px)',
  },
  btn: {
    background: 'rgba(217,164,65,0.15)',
    border: '1px solid rgba(217,164,65,0.35)',
    borderRadius: '6px',
    padding: '8px 14px',
    color: '#d9a441',
    fontSize: '15px',
    fontFamily: 'inherit',
    cursor: 'pointer',
    backdropFilter: 'blur(8px)',
  },
  error: {
    fontSize: '11px',
    color: '#d94141',
    margin: 0,
  },
};
