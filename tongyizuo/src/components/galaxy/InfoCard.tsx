// src/components/galaxy/InfoCard.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { shortGloss, toneColor } from '../SynonymGraph';

interface InfoCardProps {
  simplified: string;
  pinyin: string;
  clusterLabel: string;
  clusterHue?: number;
  core_scene: string | null;
  raw_glosses?: string[];
  onDismiss?: () => void;
}

if (typeof document !== 'undefined' && !document.getElementById('ic-anim')) {
  const st = document.createElement('style');
  st.id = 'ic-anim';
  st.textContent = `
    @keyframes cardSlideIn {
      from { transform: translateY(16px); opacity: 0; }
      to   { transform: translateY(0);   opacity: 1; }
    }
    @keyframes cardSlideOut {
      from { transform: translateY(0); opacity: 1; }
      to   { transform: translateY(10px); opacity: 0; }
    }
    .ic-enter { animation: cardSlideIn 0.22s cubic-bezier(0.22,1,0.36,1) forwards; }
    .ic-exit  { animation: cardSlideOut 0.16s ease-in forwards; }
  `;
  document.head.appendChild(st);
}

export function InfoCard({ simplified, pinyin, clusterLabel, clusterHue, core_scene, raw_glosses = [], onDismiss, dismissing = false }: InfoCardProps & { dismissing?: boolean }) {
  const router = useRouter();
  const [btnHover, setBtnHover] = useState(false);
  const [closeHover, setCloseHover] = useState(false);
  const glossLine = raw_glosses
    .map(g => shortGloss(g)).filter(Boolean)
    .filter((g, i, a) => a.indexOf(g) === i).slice(0, 3).join('  ·  ');

  function navigate() {
    const url = `/cluster/${encodeURIComponent(simplified)}`;
    if (typeof document !== 'undefined' && 'startViewTransition' in document) {
      (document as any).startViewTransition(() => router.push(url));
    } else {
      router.push(url);
    }
  }

  return (
    <div key={simplified} className={dismissing ? 'ic-exit' : 'ic-enter'} style={s.card}>
      {onDismiss && (
        <button
          onClick={onDismiss}
          style={{
            ...s.close,
            color: closeHover ? 'rgba(232,213,176,0.65)' : 'rgba(232,213,176,0.3)',
          }}
          onMouseEnter={() => setCloseHover(true)}
          onMouseLeave={() => setCloseHover(false)}
        >✕</button>
      )}
      <span className="zh" style={s.char}>{simplified}</span>
      <span style={{ ...s.pinyin, color: toneColor(pinyin) }}>{pinyin}</span>
      {glossLine && (
        <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: '4px', marginTop: '3px' }}>
          {raw_glosses.map(g => shortGloss(g)).filter(Boolean)
            .filter((g, i, a) => a.indexOf(g) === i).slice(0, 3).map((g, i) => (
            <span key={i} style={{
              fontSize: '10px', color: 'rgba(232,213,176,0.65)',
              background: 'rgba(232,213,176,0.06)',
              border: '1px solid rgba(232,213,176,0.12)',
              borderRadius: '3px', padding: '2px 7px',
              fontFamily: "'JetBrains Mono', monospace",
              display: 'inline-block',
            }}>{g}</span>
          ))}
        </div>
      )}
      <span style={s.cluster}>
        {clusterHue !== undefined && (
          <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: `hsla(${clusterHue}, 60%, 60%, 0.8)`, marginRight: '6px', verticalAlign: 'middle', marginBottom: '1px' }} />
        )}
        {clusterLabel}
      </span>
      {core_scene && <p style={s.scene}>{core_scene}</p>}
      <button
        style={{
          ...s.btn,
          background: btnHover ? 'rgba(217,164,65,0.22)' : 'rgba(217,164,65,0.12)',
          borderColor: btnHover ? 'rgba(217,164,65,0.55)' : 'rgba(217,164,65,0.35)',
          transform: btnHover ? 'translateY(-1px)' : 'none',
          transition: 'background 0.15s, border-color 0.15s, transform 0.15s',
        }}
        onClick={navigate}
        onMouseEnter={() => setBtnHover(true)}
        onMouseLeave={() => setBtnHover(false)}
      >
        探索 →
      </button>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  card: {
    position: 'fixed',
    bottom: '28px',
    left: '28px',
    zIndex: 20,
    background: 'rgba(10,8,6,0.88)',
    border: '1px solid rgba(217,164,65,0.35)',
    borderRadius: '12px',
    padding: '18px 20px',
    paddingRight: '32px',
    minWidth: '200px',
    maxWidth: '280px',
    backdropFilter: 'blur(12px)',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  char: {
    fontSize: '40px',
    color: '#d9a441',
    lineHeight: 1,
    display: 'block',
  },
  pinyin: {
    fontSize: '13px',
    color: 'rgba(232,213,176,0.6)',
    fontFamily: "'JetBrains Mono', monospace",
    display: 'block',
    marginTop: '2px',
  },
  glosses: {
    fontSize: '11px',
    color: 'rgba(232,213,176,0.45)',
    fontFamily: "'JetBrains Mono', monospace",
    display: 'block',
    marginTop: '3px',
    letterSpacing: '0.02em',
  },
  cluster: {
    fontSize: '11px',
    color: 'rgba(217,164,65,0.5)',
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    display: 'block',
    marginTop: '4px',
  },
  scene: {
    fontSize: '12px',
    color: 'rgba(232,213,176,0.5)',
    lineHeight: 1.5,
    fontStyle: 'italic',
    marginTop: '8px',
    marginBottom: '0',
    borderLeft: '2px solid rgba(217,164,65,0.25)',
    paddingLeft: '8px',
  },
  btn: {
    marginTop: '14px',
    padding: '8px 14px',
    background: 'rgba(217,164,65,0.12)',
    border: '1px solid rgba(217,164,65,0.35)',
    borderRadius: '6px',
    color: '#d9a441',
    fontSize: '12px',
    fontFamily: "'JetBrains Mono', monospace",
    cursor: 'pointer',
    textAlign: 'left',
  },
  close: {
    position: 'absolute' as const,
    top: '10px',
    right: '12px',
    background: 'none',
    border: 'none',
    fontSize: '14px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    lineHeight: 1,
    transition: 'color 0.15s',
  },
};
