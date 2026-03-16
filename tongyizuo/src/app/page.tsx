'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';

const GalaxyGraph = dynamic(() => import('../components/GalaxyGraph'), { ssr: false });

const HISTORY_KEY = 'tongyizuo:history';
const STARTERS = ['看','说','走','想','好','知道','觉得','认为'];
function loadHistory(): string[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
  catch { return []; }
}

export default function HomePage() {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [btnHover, setBtnHover] = useState(false);
  const [hoveredPill, setHoveredPill] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

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
    if (typeof document !== 'undefined' && 'startViewTransition' in document) {
      (document as any).startViewTransition(() => router.push(`/cluster/${encodeURIComponent(word)}`));
    } else {
      router.push(`/cluster/${encodeURIComponent(word)}`);
    }
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

        <div style={s.right}>
          <div style={s.historyRow}>
            {(history.length > 0 ? history.slice(0, 8) : STARTERS).map((w) => (
              <button
                key={w}
                style={{
                  ...s.historyPill,
                  color: hoveredPill === w ? 'rgba(217,164,65,0.85)' : 'rgba(217,164,65,0.55)',
                  borderColor: hoveredPill === w ? 'rgba(217,164,65,0.45)' : 'rgba(217,164,65,0.2)',
                  background: hoveredPill === w ? 'rgba(217,164,65,0.1)' : 'rgba(10,8,6,0.6)',
                }}
                onClick={() => {
                  if (typeof document !== 'undefined' && 'startViewTransition' in document) {
                    (document as any).startViewTransition(() => router.push(`/cluster/${encodeURIComponent(w)}`));
                  } else {
                    router.push(`/cluster/${encodeURIComponent(w)}`);
                  }
                }}
                onMouseEnter={() => setHoveredPill(w)}
                onMouseLeave={() => setHoveredPill(null)}
              >
                <span className="zh">{w}</span>
              </button>
            ))}
          </div>
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
              <button
                type="submit"
                style={{
                  ...s.btn,
                  background: btnHover ? 'rgba(217,164,65,0.25)' : 'rgba(217,164,65,0.15)',
                  borderColor: btnHover ? 'rgba(217,164,65,0.55)' : 'rgba(217,164,65,0.35)',
                }}
                onMouseEnter={() => setBtnHover(true)}
                onMouseLeave={() => setBtnHover(false)}
              >→</button>
            </div>
            {error && <p style={s.error}>{error}</p>}
          </form>
        </div>
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
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: '14px 24px',
    background: 'linear-gradient(to bottom, rgba(10,8,6,0.88) 0%, rgba(10,8,6,0) 100%)',
  },
  title: {
    fontSize: '22px',
    color: '#d9a441',
    letterSpacing: '0.05em',
    textShadow: '0 0 20px rgba(217,164,65,0.4)',
    flexShrink: 0,
    paddingTop: '2px',
  },
  right: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '8px',
  },
  historyRow: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    flexWrap: 'wrap' as const,
    justifyContent: 'flex-end',
  },
  historyPill: {
    background: 'rgba(10,8,6,0.6)',
    border: '1px solid rgba(217,164,65,0.2)',
    borderRadius: '16px',
    padding: '2px 10px',
    fontSize: '15px',
    fontFamily: 'Noto Serif SC, serif',
    fontWeight: 900,
    color: 'rgba(217,164,65,0.55)',
    cursor: 'pointer',
    backdropFilter: 'blur(8px)',
    transition: 'color 0.15s, border-color 0.15s',
    lineHeight: 1.5,
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
