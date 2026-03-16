'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import type { ClusterResponse } from '../../../../lib/types';
import SynonymGraph, { shortGloss } from '../../../components/SynonymGraph';
import ChallengeMode from '../../../components/ChallengeMode';
import { WORD_COLORS } from '../../../components/WordNode';

type Mode = 'explore' | 'challenge';

export default function ClusterPage({ params }: { params: Promise<{ word: string }> }) {
  const { word } = use(params);
  const simplified = decodeURIComponent(word);
  const router = useRouter();

  const [data, setData] = useState<ClusterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<Mode>('explore');
  const [activeClusterIdx, setActiveClusterIdx] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    setError('');
    setData(null);

    fetch(`/api/cluster/${encodeURIComponent(simplified)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((json: ClusterResponse) => {
        setData(json);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [simplified]);

  const primaryCluster = data?.clusters?.[0];
  const hasSituations = (primaryCluster?.situations?.length ?? 0) > 0;

  return (
    <div style={s.page}>
      {/* Top nav */}
      <nav style={s.nav}>
        <button style={s.backBtn} onClick={() => router.push('/')}>
          ← 同义词星图
        </button>
        {data && !loading && (
          <div style={s.modeToggle}>
            <button
              style={{ ...s.modeBtn, ...(mode === 'explore' ? s.modeBtnActive : {}) }}
              onClick={() => setMode('explore')}
            >
              ⬡ Explore
            </button>
            <button
              style={{
                ...s.modeBtn,
                ...(mode === 'challenge' ? s.modeBtnActive : {}),
                ...(hasSituations ? {} : s.modeBtnDisabled),
              }}
              onClick={() => hasSituations && setMode('challenge')}
              title={hasSituations ? '' : 'No challenge situations available'}
            >
              ⁇ Challenge
            </button>
          </div>
        )}
      </nav>

      {/* Content */}
      <main style={s.main}>
        {loading && (
          <div style={s.loading}>
            <div style={s.spinner} />
            <p style={s.loadingText}>Building cluster for <span className="zh" style={s.loadingWord}>{simplified}</span>...</p>
            <p style={s.loadingHint}>Analyzing CC-CEDICT + enriching with AI — this takes 5–10s on first visit</p>
          </div>
        )}

        {error && (
          <div style={s.errorBox}>
            <p style={s.errorTitle}>Could not load cluster</p>
            <p style={s.errorMsg}>{error}</p>
            <button style={s.retryBtn} onClick={() => router.push('/')}>← Back to search</button>
          </div>
        )}

        {data && !loading && primaryCluster && (
          <>
            {/* Word header */}
            <header style={s.wordHeader}>
              <span className="zh" style={s.wordDisplay}>{simplified}</span>
              {/* Cluster list — vertical, one per cluster */}
              <div style={s.clusterList}>
                {data.clusters.map((cl, i) => {
                  const color = WORD_COLORS[i % WORD_COLORS.length];
                  const isActive = activeClusterIdx === i;
                  return (
                    <button
                      key={cl.id}
                      style={{
                        ...s.clusterRow,
                        opacity: isActive ? 1 : 0.22,
                        color: isActive ? color : `${color}cc`,
                      }}
                      onClick={() => setActiveClusterIdx(prev => prev === i ? null : i)}
                    >
                      <span style={s.clusterRowLabel}>{cl.label}</span>
                      <span style={{ ...s.clusterRowCount, color: isActive ? `${color}88` : `${color}44` }}>
                        {cl.members.length - 1}
                      </span>
                    </button>
                  );
                })}
              </div>
              {data.word.core_scene && (
                <p style={s.coreScene}>{data.word.core_scene}</p>
              )}
            </header>

            {mode === 'explore' && (
              <SynonymGraph
                clusters={data.clusters}
                focusWord={simplified}
                activeClusterIdx={activeClusterIdx}
              />
            )}

            {mode === 'challenge' && (
              <ChallengeMode cluster={primaryCluster} />
            )}
          </>
        )}
      </main>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: '#0a0806',
  },
  nav: {
    padding: '16px 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottom: '1px solid rgba(217,164,65,0.08)',
    flexWrap: 'wrap',
    gap: '12px',
  },
  backBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(232,213,176,0.45)',
    fontSize: '13px',
    fontFamily: 'inherit',
    cursor: 'pointer',
    padding: '4px 0',
    transition: 'color 0.2s',
  },
  modeToggle: {
    display: 'flex',
    gap: '4px',
    background: 'rgba(217,164,65,0.05)',
    border: '1px solid rgba(217,164,65,0.15)',
    borderRadius: '8px',
    padding: '4px',
  },
  modeBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(232,213,176,0.5)',
    fontSize: '12px',
    fontFamily: 'inherit',
    cursor: 'pointer',
    padding: '6px 14px',
    borderRadius: '5px',
    transition: 'all 0.2s',
    fontWeight: 400,
  },
  modeBtnActive: {
    background: 'rgba(217,164,65,0.15)',
    color: '#d9a441',
  },
  modeBtnDisabled: {
    opacity: 0.3,
    cursor: 'default',
  },
  main: {
    flex: 1,
    padding: '32px 24px',
    maxWidth: '900px',
    margin: '0 auto',
    width: '100%',
  },
  loading: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
    marginTop: '80px',
  },
  spinner: {
    width: '32px',
    height: '32px',
    border: '2px solid rgba(217,164,65,0.15)',
    borderTop: '2px solid #d9a441',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  loadingText: {
    fontSize: '15px',
    color: 'rgba(232,213,176,0.7)',
  },
  loadingWord: {
    color: '#d9a441',
    fontSize: '18px',
  },
  loadingHint: {
    fontSize: '12px',
    color: 'rgba(232,213,176,0.3)',
    textAlign: 'center',
    maxWidth: '320px',
    lineHeight: 1.5,
  },
  errorBox: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    marginTop: '80px',
    padding: '32px',
    background: 'rgba(217,65,65,0.05)',
    border: '1px solid rgba(217,65,65,0.2)',
    borderRadius: '12px',
  },
  errorTitle: {
    fontSize: '16px',
    color: '#d94141',
    fontWeight: 500,
  },
  errorMsg: {
    fontSize: '13px',
    color: 'rgba(232,213,176,0.5)',
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: '8px',
    background: 'none',
    border: '1px solid rgba(217,164,65,0.3)',
    borderRadius: '6px',
    padding: '8px 16px',
    color: '#d9a441',
    fontSize: '13px',
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  wordHeader: {
    marginBottom: '32px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  wordDisplay: {
    fontSize: '64px',
    color: '#d9a441',
    textShadow: '0 0 40px rgba(217,164,65,0.3)',
    lineHeight: 1,
  },
  clusterList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    marginTop: '8px',
  },
  clusterRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '8px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '3px 0',
    textAlign: 'left',
    fontFamily: 'inherit',
    transition: 'opacity 0.2s',
  },
  clusterRowLabel: {
    fontSize: '13px',
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: '0.04em',
  },
  clusterRowCount: {
    fontSize: '11px',
    fontFamily: "'JetBrains Mono', monospace",
  },
  coreScene: {
    fontSize: '14px',
    color: 'rgba(232,213,176,0.55)',
    lineHeight: 1.6,
    maxWidth: '560px',
    fontStyle: 'italic',
  },
};

// Inject spinner animation
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
  document.head.appendChild(style);
}
