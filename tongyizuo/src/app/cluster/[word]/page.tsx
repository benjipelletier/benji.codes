'use client';

import { useState, useEffect, useRef, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ClusterResponse } from '../../../../lib/types';
import SynonymGraph, { shortGloss, MAX_MEMBERS } from '../../../components/SynonymGraph';
import ChallengeMode from '../../../components/ChallengeMode';
import { WORD_COLORS } from '../../../components/WordNode';

type Mode = 'explore' | 'challenge';

const HISTORY_KEY = 'tongyizuo:history';
const MAX_HISTORY = 12;
function loadHistory(): string[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
  catch { return []; }
}
function addToHistory(word: string) {
  if (typeof window === 'undefined') return;
  try {
    const h = loadHistory().filter(w => w !== word);
    h.unshift(word);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, MAX_HISTORY)));
  } catch { /* ignore */ }
}

export default function ClusterPage({ params }: { params: Promise<{ word: string }> }) {
  const { word } = use(params);
  const simplified = decodeURIComponent(word);
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromWord = searchParams.get('from');

  const [data, setData] = useState<ClusterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<Mode>('explore');
  const [activeClusterIdx, setActiveClusterIdx] = useState<number | null>(null);
  const [navSearch, setNavSearch] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const navInputRef = useRef<HTMLInputElement>(null);
  const [history, setHistory] = useState<string[]>([]);

  function handleNavSearch(e: React.FormEvent) {
    e.preventDefault();
    const w = navSearch.trim();
    if (!w || !/[\u4e00-\u9fff]/.test(w)) return;
    setNavSearch('');
    setNavOpen(false);
    router.push(`/cluster/${encodeURIComponent(w)}`);
  }

  useEffect(() => {
    if (navOpen) setTimeout(() => navInputRef.current?.focus(), 50);
  }, [navOpen]);

  useEffect(() => {
    addToHistory(simplified);
    setHistory(loadHistory());
    document.title = `${simplified} · 同义词星图`;
    return () => { document.title = '同义词星图 — Synonym Cluster Graph'; };
  }, [simplified]);

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
        <div style={s.breadcrumb}>
          <button style={s.backBtn} onClick={() => {
            if (window.history.length > 1) router.back();
            else router.push('/');
          }}>
            ← 星图
          </button>
          {fromWord && (
            <>
              <span style={s.breadcrumbSep}>/</span>
              <button
                style={s.breadcrumbFrom}
                onClick={() => router.push(`/cluster/${encodeURIComponent(fromWord)}`)}
              >
                <span className="zh">{fromWord}</span>
              </button>
              <span style={s.breadcrumbSep}>›</span>
              <span style={s.breadcrumbCurrent} className="zh">{simplified}</span>
            </>
          )}
        </div>

        {/* Inline search */}
        {navOpen ? (
          <form onSubmit={handleNavSearch} style={s.navSearchForm}>
            <input
              ref={navInputRef}
              value={navSearch}
              onChange={e => setNavSearch(e.target.value)}
              placeholder="探索..."
              style={s.navSearchInput}
              autoComplete="off"
              spellCheck={false}
              onBlur={() => { if (!navSearch) setNavOpen(false); }}
            />
            <button type="submit" style={s.navSearchBtn}>→</button>
          </form>
        ) : (
          <button style={s.navSearchTrigger} onClick={() => setNavOpen(true)} title="Search another word">
            ⌕
          </button>
        )}

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
              ◈ Challenge
            </button>
          </div>
        )}
      </nav>

      {/* History strip */}
      {history.length >= 2 && (
        <div style={s.historyStrip}>
          <span style={s.historyLabel}>history</span>
          <div style={s.historyItems}>
            {history.map((w) => {
              const isCurrent = w === simplified;
              return (
                <button
                  key={w}
                  style={{
                    ...s.historyPill,
                    color: isCurrent ? '#d9a441' : 'rgba(217,164,65,0.38)',
                    background: isCurrent ? 'rgba(217,164,65,0.1)' : 'transparent',
                    borderColor: isCurrent ? 'rgba(217,164,65,0.35)' : 'rgba(217,164,65,0.12)',
                    cursor: isCurrent ? 'default' : 'pointer',
                  }}
                  onClick={() => {
                    if (!isCurrent) router.push(`/cluster/${encodeURIComponent(w)}?from=${encodeURIComponent(simplified)}`);
                  }}
                >
                  <span className="zh">{w}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Content */}
      <main style={s.main}>
        {loading && (
          <div style={s.loading}>
            <span className="zh" style={s.loadingChar}>{simplified}</span>
            <p style={s.loadingText}>mapping the constellation…</p>
            <p style={s.loadingHint}>first visit may take 20–40s while we map synonyms</p>
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
            {mode === 'explore' && (
              <div style={s.exploreWrap}>
                {/* Word header — floating overlay top-left */}
                <header style={s.wordHeader}>
                  <span className="zh" style={s.wordDisplay}>{simplified}</span>
                  {data.word.pinyin_display && (
                    <span style={s.wordPinyin}>{data.word.pinyin_display}</span>
                  )}
                  {data.word.raw_glosses.length > 0 && (
                    <p style={s.wordGlosses}>
                      {data.word.raw_glosses
                        .map(g => shortGloss(g))
                        .filter(Boolean)
                        .filter((g, i, a) => a.indexOf(g) === i)
                        .slice(0, 3)
                        .join('  ·  ')}
                    </p>
                  )}
                  <div style={s.clusterList}>
                    {data.clusters.map((cl, i) => {
                      const color = WORD_COLORS[i % WORD_COLORS.length];
                      const isActive = activeClusterIdx === i;
                      return (
                        <button
                          key={cl.id}
                          style={{
                            ...s.clusterRow,
                            opacity: activeClusterIdx === null ? 1 : isActive ? 1 : 0.3,
                            color: isActive ? color : `${color}aa`,
                            background: isActive ? `${color}12` : 'transparent',
                            borderColor: isActive ? `${color}88` : `${color}44`,
                          }}
                          onClick={() => setActiveClusterIdx(prev => prev === i ? null : i)}
                        >
                          <span style={s.clusterRowLabel}>{cl.label}</span>
                          <span style={{ ...s.clusterRowCount, color: isActive ? `${color}88` : `${color}44` }}>
                            {(() => {
                              const total = cl.members.length - 1;
                              const shown = Math.min(total, MAX_MEMBERS);
                              return shown < total ? `${shown}/${total}` : `${total}`;
                            })()}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {data.word.core_scene && (
                    <p style={s.coreScene}>{data.word.core_scene}</p>
                  )}
                </header>

                {/* Graph — fills remaining space, 看 at center */}
                <div style={s.graphCenter}>
                  <SynonymGraph
                    clusters={data.clusters}
                    focusWord={simplified}
                    activeClusterIdx={activeClusterIdx}
                  />
                </div>

                {/* Collocation strip — appears when a cluster is selected */}
                {activeClusterIdx !== null && (() => {
                  const cl = data.clusters[activeClusterIdx];
                  const color = WORD_COLORS[activeClusterIdx % WORD_COLORS.length];
                  const colls = cl.members
                    .flatMap(m => (m.collocations ?? []).map(c => ({ ...c, word: m.simplified })))
                    .sort((a, b) => b.weight - a.weight)
                    .filter((c, i, arr) => arr.findIndex(x => x.collocation === c.collocation) === i)
                    .slice(0, 12);
                  if (!colls.length) return null;
                  return (
                    <div style={{ ...s.collStrip, borderTopColor: `${color}22` }}>
                      <span style={{ ...s.collLabel, color: `${color}66` }}>collocations</span>
                      <div style={s.collItems}>
                        {colls.map((c, i) => {
                          const isChinese = /[\u4e00-\u9fff]/.test(c.collocation);
                          return (
                            <button
                              key={i}
                              style={{ ...s.collItem, cursor: isChinese ? 'pointer' : 'default', border: 'none', fontFamily: 'inherit', textAlign: 'center' as const }}
                              onClick={() => isChinese && router.push(`/cluster/${encodeURIComponent(c.collocation)}?from=${encodeURIComponent(simplified)}`)}
                            >
                              <span className="zh" style={{ ...s.collZh, color }}>{c.collocation}</span>
                              {c.gloss && <span style={s.collGloss}>{c.gloss}</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {mode === 'challenge' && (
              <div style={s.challengeWrap}>
                {/* Compact inline header — no absolute positioning in challenge mode */}
                <header style={s.challengeHeader}>
                  <span className="zh" style={s.challengeChar}>{simplified}</span>
                  <div style={{ ...s.clusterList, maxHeight: 'none', flexDirection: 'row' as const, flexWrap: 'wrap' as const }}>
                    {data.clusters.map((cl, i) => {
                      const color = WORD_COLORS[i % WORD_COLORS.length];
                      const isActive = activeClusterIdx === i;
                      return (
                        <button
                          key={cl.id}
                          style={{
                            ...s.clusterRow,
                            opacity: activeClusterIdx === null ? 1 : isActive ? 1 : 0.3,
                            color: isActive ? color : `${color}aa`,
                            background: isActive ? `${color}12` : 'transparent',
                            borderColor: isActive ? `${color}88` : `${color}44`,
                          }}
                          onClick={() => setActiveClusterIdx(prev => prev === i ? null : i)}
                        >
                          <span style={s.clusterRowLabel}>{cl.label}</span>
                          <span style={{ ...s.clusterRowCount, color: isActive ? `${color}88` : `${color}44` }}>
                            {(() => {
                              const total = cl.members.length - 1;
                              const shown = Math.min(total, MAX_MEMBERS);
                              return shown < total ? `${shown}/${total}` : `${total}`;
                            })()}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </header>
                <ChallengeMode cluster={primaryCluster} />
              </div>
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
  breadcrumb: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  backBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(217,164,65,0.55)',
    fontSize: '13px',
    fontFamily: 'inherit',
    cursor: 'pointer',
    padding: '4px 0',
    transition: 'color 0.2s',
    letterSpacing: '0.04em',
  },
  breadcrumbSep: {
    color: 'rgba(217,164,65,0.2)',
    fontSize: '12px',
  },
  breadcrumbFrom: {
    background: 'none',
    border: 'none',
    color: 'rgba(217,164,65,0.5)',
    fontSize: '16px',
    fontFamily: 'inherit',
    cursor: 'pointer',
    padding: '0',
  },
  breadcrumbCurrent: {
    color: '#d9a441',
    fontSize: '16px',
  },
  navSearchForm: {
    display: 'flex',
    gap: '4px',
  },
  navSearchInput: {
    background: 'rgba(10,8,6,0.7)',
    border: '1px solid rgba(217,164,65,0.3)',
    borderRadius: '5px',
    padding: '5px 10px',
    color: '#e8d5b0',
    fontSize: '14px',
    fontFamily: 'inherit',
    outline: 'none',
    width: '130px',
  },
  navSearchBtn: {
    background: 'rgba(217,164,65,0.12)',
    border: '1px solid rgba(217,164,65,0.3)',
    borderRadius: '5px',
    padding: '5px 10px',
    color: '#d9a441',
    fontSize: '13px',
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  navSearchTrigger: {
    background: 'none',
    border: '1px solid rgba(217,164,65,0.18)',
    borderRadius: '5px',
    padding: '4px 10px',
    color: 'rgba(217,164,65,0.45)',
    fontSize: '16px',
    fontFamily: 'inherit',
    cursor: 'pointer',
    lineHeight: 1,
    transition: 'border-color 0.2s, color 0.2s',
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
  historyStrip: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '6px 24px 8px',
    borderBottom: '1px solid rgba(217,164,65,0.06)',
    overflowX: 'auto' as const,
    scrollbarWidth: 'none' as const,
  },
  historyLabel: {
    fontSize: '9px',
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: '0.14em',
    textTransform: 'uppercase' as const,
    color: 'rgba(217,164,65,0.2)',
    flexShrink: 0,
  },
  historyItems: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
  },
  historyPill: {
    background: 'transparent',
    border: '1px solid rgba(217,164,65,0.12)',
    borderRadius: '16px',
    padding: '2px 10px',
    fontSize: '15px',
    fontFamily: 'Noto Serif SC, serif',
    fontWeight: 900,
    cursor: 'pointer',
    transition: 'color 0.15s, background 0.15s, border-color 0.15s',
    lineHeight: 1.5,
  },
  main: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  exploreWrap: {
    position: 'absolute',
    inset: 0,
  },
  graphCenter: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  challengeWrap: {
    padding: '32px 24px',
    maxWidth: '900px',
    margin: '0 auto',
    width: '100%',
    overflowY: 'auto' as const,
  },
  challengeHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '20px',
    marginBottom: '28px',
    flexWrap: 'wrap' as const,
  },
  challengeChar: {
    fontSize: '48px',
    color: '#d9a441',
    textShadow: '0 0 30px rgba(217,164,65,0.3)',
    lineHeight: 1,
    flexShrink: 0,
  },
  loading: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '20px',
    height: '100%',
  },
  loadingChar: {
    fontSize: '96px',
    color: '#d9a441',
    textShadow: '0 0 60px rgba(217,164,65,0.35)',
    animation: 'pulse 2s ease-in-out infinite',
    lineHeight: 1,
  },
  loadingText: {
    fontSize: '13px',
    color: 'rgba(232,213,176,0.4)',
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: '0.12em',
    margin: 0,
  },
  loadingHint: {
    fontSize: '11px',
    color: 'rgba(232,213,176,0.2)',
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: '0.08em',
    margin: 0,
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
    position: 'absolute',
    top: '24px',
    left: '28px',
    zIndex: 2,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    pointerEvents: 'auto',
  },
  wordDisplay: {
    fontSize: '64px',
    color: '#d9a441',
    textShadow: '0 0 40px rgba(217,164,65,0.3)',
    lineHeight: 1,
  },
  wordPinyin: {
    fontSize: '13px',
    color: 'rgba(217,164,65,0.5)',
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: '0.08em',
    marginTop: '2px',
  },
  wordGlosses: {
    fontSize: '11px',
    color: 'rgba(232,213,176,0.4)',
    fontFamily: "'JetBrains Mono', monospace",
    margin: '4px 0 0 0',
    letterSpacing: '0.03em',
    lineHeight: 1.6,
    maxWidth: '240px',
  },
  clusterList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    marginTop: '10px',
    maxHeight: '280px',
    overflowY: 'auto' as const,
    scrollbarWidth: 'none' as const,
  },
  clusterRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: 'none',
    border: '1px solid currentColor',
    borderRadius: '20px',
    cursor: 'pointer',
    padding: '5px 14px',
    textAlign: 'left',
    fontFamily: 'inherit',
    transition: 'opacity 0.2s, background 0.2s',
    alignSelf: 'flex-start',
  },
  clusterRowLabel: {
    fontSize: '12px',
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: '0.06em',
  },
  clusterRowCount: {
    fontSize: '10px',
    fontFamily: "'JetBrains Mono', monospace",
  },
  coreScene: {
    fontSize: '14px',
    color: 'rgba(232,213,176,0.55)',
    lineHeight: 1.6,
    maxWidth: '560px',
    fontStyle: 'italic',
  },
  collStrip: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 3,
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    padding: '10px 24px 12px',
    background: 'linear-gradient(to top, rgba(10,8,6,0.92) 60%, transparent)',
    borderTop: '1px solid transparent',
  },
  collLabel: {
    fontSize: '9px',
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: '0.14em',
    textTransform: 'uppercase' as const,
    flexShrink: 0,
  },
  collItems: {
    display: 'flex',
    gap: '10px',
    overflowX: 'auto' as const,
    scrollbarWidth: 'none' as const,
  },
  collItem: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '2px',
    flexShrink: 0,
    padding: '4px 8px',
    background: 'rgba(255,255,255,0.03)',
    borderRadius: '6px',
  },
  collZh: {
    fontSize: '16px',
    lineHeight: 1,
  },
  collGloss: {
    fontSize: '9px',
    color: 'rgba(232,213,176,0.35)',
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: '0.04em',
    textAlign: 'center' as const,
    maxWidth: '70px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
};

// Inject animations
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes pulse {
      0%, 100% { opacity: 0.7; text-shadow: 0 0 40px rgba(217,164,65,0.2); }
      50% { opacity: 1; text-shadow: 0 0 80px rgba(217,164,65,0.55); }
    }
  `;
  document.head.appendChild(style);
}
