'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const EXAMPLE_CLUSTERS = [
  { chars: '摔掉倒', label: 'fall / drop' },
  { chars: '看望见', label: 'see / look' },
  { chars: '快速迅', label: 'fast / quick' },
  { chars: '喜欢爱', label: 'like / love' },
  { chars: '高兴快乐', label: 'happy / joyful' },
];

export default function HomePage() {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const word = input.trim();
    if (!word) return;
    // Basic check: must contain Chinese characters
    if (!/[\u4e00-\u9fff]/.test(word)) {
      setError('Please enter a Chinese character or word');
      return;
    }
    setError('');
    router.push(`/cluster/${encodeURIComponent(word)}`);
  }

  function handleExample(firstChar: string) {
    router.push(`/cluster/${encodeURIComponent(firstChar)}`);
  }

  return (
    <main style={s.page}>
      {/* Ambient glow */}
      <div style={s.glow} />

      <div style={s.container}>
        {/* Header */}
        <header style={s.header}>
          <h1 style={s.title} className="zh">同义词星图</h1>
          <p style={s.subtitle}>Synonym Cluster Graph</p>
          <p style={s.tagline}>
            摔, 掉, and 倒 all mean "fall" — but which one do you use when?
          </p>
        </header>

        {/* Search */}
        <form onSubmit={handleSubmit} style={s.form}>
          <div style={s.inputWrap}>
            <input
              type="text"
              value={input}
              onChange={(e) => { setInput(e.target.value); setError(''); }}
              placeholder="Enter a Chinese word..."
              style={s.input}
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit" style={s.btn}>
              探索 →
            </button>
          </div>
          {error && <p style={s.error}>{error}</p>}
        </form>

        {/* Examples */}
        <section style={s.examples}>
          <p style={s.examplesLabel}>Try an example cluster:</p>
          <div style={s.examplesGrid}>
            {EXAMPLE_CLUSTERS.map((ex) => (
              <button
                key={ex.chars}
                style={s.exampleCard}
                onClick={() => handleExample(ex.chars[0])}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(217,164,65,0.5)';
                  (e.currentTarget as HTMLButtonElement).style.background = 'rgba(217,164,65,0.08)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(217,164,65,0.15)';
                  (e.currentTarget as HTMLButtonElement).style.background = 'rgba(217,164,65,0.03)';
                }}
              >
                <span className="zh" style={s.exampleChars}>{ex.chars}</span>
                <span style={s.exampleLabel}>{ex.label}</span>
              </button>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section style={s.howItWorks}>
          <div style={s.feature}>
            <span style={s.featureIcon}>⬡</span>
            <div>
              <p style={s.featureTitle}>Cluster Graph</p>
              <p style={s.featureDesc}>Words connected by shared meanings. More edges = tighter synonyms.</p>
            </div>
          </div>
          <div style={s.feature}>
            <span style={s.featureIcon}>◎</span>
            <div>
              <p style={s.featureTitle}>Collocational Gravity</p>
              <p style={s.featureDesc}>The words each synonym naturally attracts — orbiting by association strength.</p>
            </div>
          </div>
          <div style={s.feature}>
            <span style={s.featureIcon}>⁇</span>
            <div>
              <p style={s.featureTitle}>Challenge Mode</p>
              <p style={s.featureDesc}>Real situations. Pick the right word. Learn why the others don't fit.</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px 20px',
    position: 'relative',
    overflow: 'hidden',
  },
  glow: {
    position: 'fixed',
    top: '-20%',
    left: '50%',
    transform: 'translateX(-50%)',
    width: '800px',
    height: '500px',
    background: 'radial-gradient(ellipse, rgba(217,164,65,0.06) 0%, transparent 70%)',
    pointerEvents: 'none',
    zIndex: 0,
  },
  container: {
    position: 'relative',
    zIndex: 1,
    width: '100%',
    maxWidth: '600px',
    display: 'flex',
    flexDirection: 'column',
    gap: '48px',
  },
  header: {
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  title: {
    fontSize: '56px',
    color: '#d9a441',
    letterSpacing: '0.05em',
    lineHeight: 1,
    textShadow: '0 0 40px rgba(217,164,65,0.3)',
  },
  subtitle: {
    fontSize: '13px',
    color: 'rgba(232,213,176,0.4)',
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
  },
  tagline: {
    marginTop: '8px',
    fontSize: '14px',
    color: 'rgba(232,213,176,0.6)',
    lineHeight: 1.6,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  inputWrap: {
    display: 'flex',
    gap: '8px',
  },
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
    transition: 'border-color 0.2s',
  },
  btn: {
    background: 'rgba(217,164,65,0.15)',
    border: '1px solid rgba(217,164,65,0.4)',
    borderRadius: '6px',
    padding: '12px 20px',
    color: '#d9a441',
    fontSize: '14px',
    fontFamily: 'inherit',
    fontWeight: 400,
    cursor: 'pointer',
    transition: 'all 0.2s',
    whiteSpace: 'nowrap',
  },
  error: {
    fontSize: '12px',
    color: '#d94141',
  },
  examples: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  examplesLabel: {
    fontSize: '11px',
    color: 'rgba(232,213,176,0.35)',
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
  },
  examplesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
    gap: '8px',
  },
  exampleCard: {
    background: 'rgba(217,164,65,0.03)',
    border: '1px solid rgba(217,164,65,0.15)',
    borderRadius: '8px',
    padding: '12px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    textAlign: 'left',
  },
  exampleChars: {
    fontSize: '18px',
    color: '#d9a441',
    letterSpacing: '0.1em',
  },
  exampleLabel: {
    fontSize: '11px',
    color: 'rgba(232,213,176,0.45)',
  },
  howItWorks: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    borderTop: '1px solid rgba(217,164,65,0.1)',
    paddingTop: '32px',
  },
  feature: {
    display: 'flex',
    gap: '16px',
    alignItems: 'flex-start',
  },
  featureIcon: {
    fontSize: '18px',
    color: 'rgba(217,164,65,0.5)',
    flexShrink: 0,
    marginTop: '2px',
  },
  featureTitle: {
    fontSize: '13px',
    color: '#e8d5b0',
    fontWeight: 500,
    marginBottom: '2px',
  },
  featureDesc: {
    fontSize: '12px',
    color: 'rgba(232,213,176,0.45)',
    lineHeight: 1.5,
  },
};
