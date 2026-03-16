'use client';

import { useState, useEffect, useRef, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ClusterResponse } from '../../../../lib/types';
import SynonymGraph, { shortGloss, toneColor, MAX_MEMBERS } from '../../../components/SynonymGraph';
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

function navigate(router: ReturnType<typeof useRouter>, url: string) {
  if (typeof document !== 'undefined' && 'startViewTransition' in document) {
    (document as any).startViewTransition(() => router.push(url));
  } else {
    router.push(url);
  }
}

export default function ClusterPage({ params }: { params: Promise<{ word: string }> }) {
  const { word } = use(params);
  const simplified = decodeURIComponent(word);
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromWord = searchParams.get('from');

  const [data, setData] = useState<ClusterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSlowHint, setShowSlowHint] = useState(false);
  const [error, setError] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const [mode, setMode] = useState<Mode>('explore');
  const [activeClusterIdx, setActiveClusterIdx] = useState<number | null>(null);
  const [navSearch, setNavSearch] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const [navHover, setNavHover] = useState(false);
  const [backHover, setBackHover] = useState(false);
  const [retryHover, setRetryHover] = useState(false);
  const [backToSearchHover, setBackToSearchHover] = useState(false);
  const [fromHover, setFromHover] = useState(false);
  const [hoveredCollIdx, setHoveredCollIdx] = useState<number | null>(null);
  const [hoveredHistoryWord, setHoveredHistoryWord] = useState<string | null>(null);
  const [hoveredClusterIdx, setHoveredClusterIdx] = useState<number | null>(null);
  const [hoveredMode, setHoveredMode] = useState<Mode | null>(null);
  const navInputRef = useRef<HTMLInputElement>(null);
  const [history, setHistory] = useState<string[]>([]);

  function handleNavSearch(e: React.FormEvent) {
    e.preventDefault();
    const w = navSearch.trim();
    if (!w || !/[\u4e00-\u9fff]/.test(w)) return;
    setNavSearch('');
    setNavOpen(false);
    navigate(router, `/cluster/${encodeURIComponent(w)}`);
  }

  useEffect(() => {
    if (navOpen) setTimeout(() => navInputRef.current?.focus(), 50);
  }, [navOpen]);

  // Press '/' to open nav search, Escape to close it
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === '/' && document.activeElement !== navInputRef.current) {
        e.preventDefault();
        setNavOpen(true);
      } else if (e.key === 'Escape' && navOpen) {
        setNavOpen(false);
        setNavSearch('');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  useEffect(() => {
    addToHistory(simplified);
    setHistory(loadHistory());
  }, [simplified]);

  useEffect(() => {
    setLoading(true);
    setShowSlowHint(false);
    setError('');
    setData(null);

    const hintTimer = setTimeout(() => setShowSlowHint(true), 4000);

    fetch(`/api/cluster/${encodeURIComponent(simplified)}${retryCount > 0 ? `?retry=${retryCount}` : ''}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((json: ClusterResponse) => {
        clearTimeout(hintTimer);
        setData(json);
        setLoading(false);
      })
      .catch((err) => {
        clearTimeout(hintTimer);
        setError(err.message);
        setLoading(false);
      });

    return () => clearTimeout(hintTimer);
  }, [simplified, retryCount]);

  const primaryCluster = data?.clusters?.[0];
  const hasSituations = (primaryCluster?.situations?.length ?? 0) > 0;

  return (
    <div style={s.page}>
      {/* Top nav */}
      <nav className="ui-fade-down" style={s.nav}>
        <div style={s.breadcrumb}>
          <button
            style={{ ...s.backBtn, color: backHover ? 'rgba(217,164,65,0.85)' : 'rgba(217,164,65,0.55)' }}
            onClick={() => {
              const go = () => {
                if (window.history.length > 1) router.back();
                else router.push('/');
              };
              if (typeof document !== 'undefined' && 'startViewTransition' in document) {
                (document as any).startViewTransition(go);
              } else {
                go();
              }
            }}
            onMouseEnter={() => setBackHover(true)}
            onMouseLeave={() => setBackHover(false)}
          >
            ← <span className="zh">星图</span>
          </button>
          {fromWord && (
            <>
              <span style={s.breadcrumbSep}>/</span>
              <button
                style={{ ...s.breadcrumbFrom, color: fromHover ? 'rgba(217,164,65,0.8)' : 'rgba(217,164,65,0.5)' }}
                onClick={() => navigate(router, `/cluster/${encodeURIComponent(fromWord)}`)}
                onMouseEnter={() => setFromHover(true)}
                onMouseLeave={() => setFromHover(false)}
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
          <button
            style={{
              ...s.navSearchTrigger,
              borderColor: navHover ? 'rgba(217,164,65,0.45)' : 'rgba(217,164,65,0.18)',
              color: navHover ? 'rgba(217,164,65,0.8)' : 'rgba(217,164,65,0.45)',
              display: 'flex', alignItems: 'center', gap: '6px',
            }}
            onClick={() => setNavOpen(true)}
            onMouseEnter={() => setNavHover(true)}
            onMouseLeave={() => setNavHover(false)}
            title="Search another word (or press /)"
          >
            <span>⌕</span>
            <span style={{
              fontSize: '9px',
              fontFamily: "'JetBrains Mono', monospace",
              border: '1px solid rgba(217,164,65,0.2)',
              borderRadius: '3px',
              padding: '0 4px',
              lineHeight: 1.7,
              opacity: navHover ? 0.7 : 0.35,
              transition: 'opacity 0.15s',
            }}>/</span>
          </button>
        )}

        {data && !loading && (
          <div style={s.modeToggle}>
            <button
              style={{
                ...s.modeBtn,
                ...(mode === 'explore' ? s.modeBtnActive : {}),
                ...(mode !== 'explore' && hoveredMode === 'explore' ? { color: 'rgba(232,213,176,0.75)', background: 'rgba(217,164,65,0.07)' } : {}),
              }}
              onClick={() => setMode('explore')}
              onMouseEnter={() => setHoveredMode('explore')}
              onMouseLeave={() => setHoveredMode(null)}
            >
              ⬡ Explore
            </button>
            <button
              style={{
                ...s.modeBtn,
                ...(mode === 'challenge' ? s.modeBtnActive : {}),
                ...(hasSituations ? {} : s.modeBtnDisabled),
                ...(hasSituations && mode !== 'challenge' && hoveredMode === 'challenge' ? { color: 'rgba(232,213,176,0.75)', background: 'rgba(217,164,65,0.07)' } : {}),
              }}
              onClick={() => hasSituations && setMode('challenge')}
              onMouseEnter={() => hasSituations && setHoveredMode('challenge')}
              onMouseLeave={() => setHoveredMode(null)}
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
                    color: isCurrent ? '#d9a441' : hoveredHistoryWord === w ? 'rgba(217,164,65,0.7)' : 'rgba(217,164,65,0.38)',
                    background: isCurrent ? 'rgba(217,164,65,0.1)' : hoveredHistoryWord === w ? 'rgba(217,164,65,0.07)' : 'transparent',
                    borderColor: isCurrent ? 'rgba(217,164,65,0.35)' : hoveredHistoryWord === w ? 'rgba(217,164,65,0.3)' : 'rgba(217,164,65,0.12)',
                    cursor: isCurrent ? 'default' : 'pointer',
                  }}
                  onClick={() => {
                    if (!isCurrent) navigate(router, `/cluster/${encodeURIComponent(w)}?from=${encodeURIComponent(simplified)}`);
                  }}
                  onMouseEnter={() => !isCurrent && setHoveredHistoryWord(w)}
                  onMouseLeave={() => setHoveredHistoryWord(null)}
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
            <div style={{ position: 'relative', width: '130px', height: '130px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {/* Outer slow reverse ring */}
              <div style={{
                position: 'absolute', inset: 0, borderRadius: '50%',
                border: '1px solid transparent',
                borderTopColor: 'rgba(217,164,65,0.12)',
                borderRightColor: 'rgba(217,164,65,0.2)',
                animation: 'spin 7s linear infinite reverse',
              }} />
              {/* Inner fast ring */}
              <div style={{
                position: 'absolute', inset: '12px', borderRadius: '50%',
                border: '1px solid transparent',
                borderTopColor: 'rgba(217,164,65,0.45)',
                borderLeftColor: 'rgba(217,164,65,0.12)',
                animation: 'spin 2.5s linear infinite',
              }} />
              <span className="zh" style={s.loadingChar}>{simplified}</span>
            </div>
            <p style={s.loadingText}>mapping the constellation…</p>
            <p style={{ ...s.loadingHint, opacity: showSlowHint ? 1 : 0, transition: 'opacity 0.8s ease' }}>
              first visit may take 20–40s while we map synonyms
            </p>
          </div>
        )}

        {error && (
          <div style={s.errorBox}>
            <p style={s.errorTitle}>Could not load cluster</p>
            <p style={s.errorMsg}>{error}</p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                style={{ ...s.retryBtn, background: retryHover ? 'rgba(217,164,65,0.08)' : 'none', transition: 'background 0.15s' }}
                onClick={() => setRetryCount(c => c + 1)}
                onMouseEnter={() => setRetryHover(true)}
                onMouseLeave={() => setRetryHover(false)}
              >↺ Try again</button>
              <button
                style={{ ...s.retryBtn, color: 'rgba(232,213,176,0.4)', borderColor: 'rgba(217,164,65,0.15)', background: backToSearchHover ? 'rgba(217,164,65,0.05)' : 'none', transition: 'background 0.15s' }}
                onClick={() => navigate(router, '/')}
                onMouseEnter={() => setBackToSearchHover(true)}
                onMouseLeave={() => setBackToSearchHover(false)}
              >← Back to search</button>
            </div>
          </div>
        )}

        {data && !loading && primaryCluster && (
          <>
            {mode === 'explore' && (
              <div className="mode-enter" style={s.exploreWrap}>
                {/* Word header — floating overlay top-left */}
                <header className="word-header-enter" style={s.wordHeader}>
                  <span className="zh" style={s.wordDisplay}>{simplified}</span>
                  {data.word.pinyin_display && (
                    <span style={{ ...s.wordPinyin, color: toneColor(data.word.pinyin_display) }}>{data.word.pinyin_display}</span>
                  )}
                  {data.word.raw_glosses.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: '4px', marginTop: '4px' }}>
                      {data.word.raw_glosses
                        .map(g => shortGloss(g))
                        .filter(Boolean)
                        .filter((g, i, a) => a.indexOf(g) === i)
                        .slice(0, 3)
                        .map((g, i) => (
                          <span key={i} style={{
                            fontSize: '10px', color: 'rgba(232,213,176,0.55)',
                            background: 'rgba(232,213,176,0.05)',
                            border: '1px solid rgba(232,213,176,0.1)',
                            borderRadius: '3px', padding: '2px 7px',
                            fontFamily: "'JetBrains Mono', monospace",
                            display: 'inline-block',
                          }}>{g}</span>
                        ))}
                    </div>
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
                            color: isActive ? color : hoveredClusterIdx === i ? `${color}dd` : `${color}aa`,
                            background: isActive ? `${color}12` : hoveredClusterIdx === i ? `${color}0a` : 'transparent',
                            borderColor: isActive ? `${color}88` : hoveredClusterIdx === i ? `${color}66` : `${color}44`,
                          }}
                          onClick={() => setActiveClusterIdx(prev => prev === i ? null : i)}
                          onMouseEnter={() => !isActive && setHoveredClusterIdx(i)}
                          onMouseLeave={() => setHoveredClusterIdx(null)}
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
                    focusGlosses={data.word.raw_glosses}
                    focusPinyin={data.word.pinyin_display ?? undefined}
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
                  const maxWeight = colls[0]?.weight ?? 1;
                  return (
                    <div className="coll-strip-enter" style={{ ...s.collStrip, borderTopColor: `${color}22` }}>
                      <span style={{ ...s.collLabel, color: `${color}66` }}>
                        collocations
                        <span style={{ fontSize: '8px', opacity: 0.6, marginLeft: '4px' }}>{colls.length}</span>
                      </span>
                      <div style={s.collItems}>
                        {colls.map((c, i) => {
                          const isChinese = /[\u4e00-\u9fff]/.test(c.collocation);
                          const isHovered = hoveredCollIdx === i && isChinese;
                          const norm = Math.sqrt(c.weight / maxWeight); // sqrt for less extreme spread
                          const zhSize = 13 + norm * 5; // 13–18px
                          return (
                            <button
                              key={i}
                              style={{
                                ...s.collItem,
                                cursor: isChinese ? 'pointer' : 'default',
                                border: 'none',
                                fontFamily: 'inherit',
                                textAlign: 'center' as const,
                                background: isHovered ? `${color}12` : 'rgba(255,255,255,0.03)',
                                transform: isHovered ? 'translateY(-1px)' : 'none',
                                transition: 'background 0.15s, transform 0.15s',
                              }}
                              onClick={() => isChinese && navigate(router, `/cluster/${encodeURIComponent(c.collocation)}?from=${encodeURIComponent(simplified)}`)}
                              onMouseEnter={() => isChinese && setHoveredCollIdx(i)}
                              onMouseLeave={() => setHoveredCollIdx(null)}
                            >
                              <span className="zh" style={{ ...s.collZh, color, fontSize: `${zhSize}px`, opacity: isHovered ? 1 : 0.85, transition: 'opacity 0.15s' }}>{c.collocation}</span>
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
              <div className="mode-enter" style={s.challengeWrap}>
                {/* Compact inline header — no absolute positioning in challenge mode */}
                <header style={s.challengeHeader}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flexShrink: 0 }}>
                    <span className="zh" style={s.challengeChar}>{simplified}</span>
                    {data.word.pinyin_display && (
                      <span style={{ fontSize: '13px', color: toneColor(data.word.pinyin_display), fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.06em' }}>
                        {data.word.pinyin_display}
                      </span>
                    )}
                  </div>
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
    overflowX: 'auto' as const,
    scrollbarWidth: 'none' as const,
    maskImage: 'linear-gradient(to right, black 88%, transparent 100%)' as any,
    WebkitMaskImage: 'linear-gradient(to right, black 88%, transparent 100%)' as any,
    paddingRight: '16px',
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
    fontSize: '72px',
    color: '#d9a441',
    textShadow: '0 0 40px rgba(217,164,65,0.35)',
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
    pointerEvents: 'none',
    padding: '12px 24px 16px 0',
    background: 'radial-gradient(ellipse 260px 340px at 40px 60px, rgba(10,8,6,0.72) 55%, transparent 100%)',
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
  clusterList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    marginTop: '10px',
    maxHeight: '280px',
    overflowY: 'auto' as const,
    scrollbarWidth: 'none' as const,
    pointerEvents: 'auto' as const,
    maskImage: 'linear-gradient(to bottom, black 85%, transparent 100%)' as any,
    WebkitMaskImage: 'linear-gradient(to bottom, black 85%, transparent 100%)' as any,
    paddingBottom: '12px',
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
    fontSize: '12px',
    color: 'rgba(232,213,176,0.5)',
    lineHeight: 1.6,
    maxWidth: '240px',
    fontStyle: 'italic',
    borderLeft: '2px solid rgba(217,164,65,0.25)',
    paddingLeft: '8px',
    margin: '4px 0 0 0',
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
    maskImage: 'linear-gradient(to right, black 80%, transparent 100%)' as any,
    WebkitMaskImage: 'linear-gradient(to right, black 80%, transparent 100%)' as any,
    paddingRight: '24px',
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

// Inject animations (once)
if (typeof document !== 'undefined' && !document.getElementById('cp-anim')) {
  const style = document.createElement('style');
  style.id = 'cp-anim';
  style.textContent = `
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes pulse {
      0%, 100% { opacity: 0.7; text-shadow: 0 0 40px rgba(217,164,65,0.2); }
      50% { opacity: 1; text-shadow: 0 0 80px rgba(217,164,65,0.55); }
    }
    @keyframes collSlideUp {
      from { transform: translateY(100%); opacity: 0; }
      to   { transform: translateY(0);    opacity: 1; }
    }
    .coll-strip-enter { animation: collSlideUp 0.22s cubic-bezier(0.22,1,0.36,1) forwards; }
    @keyframes headerFadeIn {
      from { opacity: 0; transform: translateX(-8px); }
      to   { opacity: 1; transform: translateX(0); }
    }
    .word-header-enter { animation: headerFadeIn 0.35s cubic-bezier(0.22,1,0.36,1) forwards; }
    @keyframes modeFadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .mode-enter { animation: modeFadeIn 0.2s cubic-bezier(0.22,1,0.36,1) forwards; }
  `;
  document.head.appendChild(style);
}
