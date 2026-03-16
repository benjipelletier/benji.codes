'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { ClusterData } from '../../lib/types';
import { WORD_COLORS } from './WordNode';

interface Props {
  clusters: ClusterData[];
  focusWord: string;
  activeClusterIdx?: number | null;
}

const MAX_MEMBERS = 7;

export function shortGloss(raw: string): string {
  let g = raw.trim();
  for (const sep of ['/', ';', '(']) {
    const i = g.indexOf(sep);
    if (i > 1) { g = g.slice(0, i).trim(); break; }
  }
  for (const pfx of ['to be ', 'to get ', 'to make ', 'to become ', 'to ', 'an ', 'a ', 'the ']) {
    if (g.toLowerCase().startsWith(pfx)) { g = g.slice(pfx.length); break; }
  }
  g = g.trim();
  return g.length > 22 ? g.slice(0, 20) + '…' : g;
}

export default function SynonymGraph({ clusters, focusWord, activeClusterIdx = null }: Props) {
  const router = useRouter();
  const [clickedWord, setClickedWord] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 40);
    return () => clearTimeout(t);
  }, []);

  const K = clusters.length;
  const svgW = 900;
  const svgH = 900;
  const cx = svgW / 2;
  const cy = svgH / 2;

  const clusterR = K === 1 ? 180 : K === 2 ? 200 : K <= 4 ? 218 : 230;
  const focusR = 36;
  const nodeR = 32;

  const clusterCenters = useMemo(() =>
    clusters.map((_, i) => {
      const angle = (2 * Math.PI * i / K) - Math.PI / 2;
      return { x: cx + clusterR * Math.cos(angle), y: cy + clusterR * Math.sin(angle), angle };
    }), [K, clusterR, cx, cy]);

  const layouts = useMemo(() => clusters.map((cluster, ci) => {
    const cc = clusterCenters[ci];
    const edgeCounts: Record<string, number> = {};
    for (const e of cluster.edges) {
      edgeCounts[e.word1] = (edgeCounts[e.word1] || 0) + 1;
      edgeCounts[e.word2] = (edgeCounts[e.word2] || 0) + 1;
    }
    const members = cluster.members
      .filter(m => m.simplified !== focusWord)
      .sort((a, b) => (edgeCounts[b.simplified] || 0) - (edgeCounts[a.simplified] || 0))
      .slice(0, MAX_MEMBERS);

    // Fan members in an outward arc (away from focus), never back toward center
    const outwardAngle = cc.angle;
    const n = members.length;
    // Radius grows with cluster size so nodes don't overlap
    const memberR = Math.max(118, n * 16 + 70);
    // Arc spread ensures minimum chord distance > 2*nodeR between adjacent nodes
    const arcSpread = n <= 1 ? 0 : Math.min(Math.PI, (n - 1) * 0.55);
    const memberPositions = members.map((_, mi) => {
      const t = n > 1 ? mi / (n - 1) : 0.5;
      const angle = outwardAngle - arcSpread / 2 + t * arcSpread;
      return { x: cc.x + memberR * Math.cos(angle), y: cc.y + memberR * Math.sin(angle), angle };
    });

    const orbitSet = new Set(members.map(m => m.simplified));
    const pairGlosses: Record<string, string[]> = {};
    for (const e of cluster.edges) {
      if (!orbitSet.has(e.word1) || !orbitSet.has(e.word2)) continue;
      const key = [e.word1, e.word2].sort().join('|');
      if (!pairGlosses[key]) pairGlosses[key] = [];
      if (!pairGlosses[key].includes(e.gloss)) pairGlosses[key].push(e.gloss);
    }
    const crossEdges = Object.entries(pairGlosses)
      .filter(([, g]) => g.length >= 2)
      .map(([key, g]) => {
        const [w1, w2] = key.split('|');
        return { word1: w1, word2: w2, gloss: g.find(x => x !== cluster.label) ?? g[0] };
      });

    return { cluster, cc, members, memberPositions, crossEdges };
  }), [clusters, clusterCenters, focusWord]);

  function navigateTo(word: string) {
    if (clickedWord) return;
    setClickedWord(word);
    const url = '/cluster/' + encodeURIComponent(word);
    setTimeout(() => {
      if (typeof document !== 'undefined' && 'startViewTransition' in document) {
        (document as any).startViewTransition(() => { router.push(url); });
      } else {
        router.push(url);
      }
    }, 300);
  }

  return (
    <div style={s.wrap}>
      <svg
        viewBox={`0 0 ${svgW} ${svgH}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ overflow: 'visible', width: '100%', height: '100%', display: 'block' }}
      >
        <defs>
          <style>{`
            @keyframes nodeRipple {
              0%   { r: ${nodeR + 4}px; opacity: 0.85; }
              100% { r: ${nodeR + 36}px; opacity: 0; }
            }
            @keyframes nodeRipple2 {
              0%   { r: ${nodeR + 4}px; opacity: 0.4; }
              100% { r: ${nodeR + 52}px; opacity: 0; }
            }
            @keyframes nodePop {
              0%   { transform: scale(1); }
              40%  { transform: scale(1.18); }
              100% { transform: scale(1); }
            }
            .node-clicked {
              animation: nodePop 0.28s ease-out forwards;
              transform-box: fill-box;
              transform-origin: center;
            }
          `}</style>
        </defs>

        {/* Trunk spokes: center → each cluster gloss pill — fade in after nodes settle */}
        {clusterCenters.map((cc, ci) => {
          const lineDelay = ci * 60 + 320;
          const dimmed = activeClusterIdx !== null && activeClusterIdx !== ci;
          return (
            <line key={`trunk-${ci}`}
              x1={cx} y1={cy} x2={cc.x} y2={cc.y}
              stroke="rgba(217,164,65,0.18)" strokeWidth={1.2}
              strokeDasharray="6 5"
              style={{
                opacity: mounted ? (dimmed ? 0.12 : 1) : 0,
                transition: `opacity 0.4s ease ${lineDelay}ms`,
              }} />
          );
        })}

        {/* Per-cluster: spokes, cross-edges, gloss pill, member nodes */}
        {layouts.map(({ cluster, cc, members, memberPositions, crossEdges }, ci) => {
          const color = WORD_COLORS[ci % WORD_COLORS.length];
          const clusterDimmed = activeClusterIdx !== null && activeClusterIdx !== ci;
          const clusterBaseDelay = ci * 60;

          return (
            <g key={`cluster-${ci}`}>

              {/* Spokes: gloss pill → members — fade in after nodes */}
              {members.map((m, mi) => {
                const pos = memberPositions[mi];
                const edgeCnt = cluster.edges.filter(
                  e => (e.word1 === focusWord && e.word2 === m.simplified) ||
                       (e.word2 === focusWord && e.word1 === m.simplified)
                ).length;
                const thick = 0.7 + (edgeCnt / 3) * 1.8;
                const dash = edgeCnt >= 3 ? 'none' : edgeCnt === 2 ? '8 4' : '4 6';
                const spokeDelay = clusterBaseDelay + mi * 20 + 280;
                return (
                  <line key={`spoke-${ci}-${mi}`}
                    x1={cc.x} y1={cc.y} x2={pos.x} y2={pos.y}
                    stroke={`${color}55`} strokeWidth={thick} strokeDasharray={dash}
                    style={{
                      opacity: mounted ? (clusterDimmed ? 0.12 : 1) : 0,
                      transition: `opacity 0.35s ease ${spokeDelay}ms`,
                    }} />
                );
              })}

              {/* Cross-edges — fade in late */}
              {crossEdges.map(edge => {
                const i1 = members.findIndex(m => m.simplified === edge.word1);
                const i2 = members.findIndex(m => m.simplified === edge.word2);
                if (i1 < 0 || i2 < 0) return null;
                const p1 = memberPositions[i1], p2 = memberPositions[i2];
                // Offset label perpendicular to edge so it doesn't sit on nodes
                const dx = p2.x - p1.x, dy = p2.y - p1.y;
                const len = Math.sqrt(dx * dx + dy * dy) || 1;
                const perpX = -dy / len * 18, perpY = dx / len * 18;
                const midX = (p1.x + p2.x) / 2 + perpX;
                const midY = (p1.y + p2.y) / 2 + perpY;
                const pw = Math.min(edge.gloss.length * 6.5 + 18, 90), ph = 17;
                return (
                  <g key={`cross-${ci}-${edge.word1}-${edge.word2}`}
                    style={{
                      opacity: mounted ? (clusterDimmed ? 0.12 : 1) : 0,
                      transition: `opacity 0.35s ease ${clusterBaseDelay + 380}ms`,
                    }}>
                    <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                      stroke={`${color}55`} strokeWidth={1.2} strokeDasharray="5 4" />
                    <rect x={midX - pw / 2} y={midY - ph / 2} width={pw} height={ph} rx={ph / 2}
                      fill="rgba(10,8,6,0.92)" stroke={`${color}55`} strokeWidth={0.9} />
                    <text x={midX} y={midY} textAnchor="middle" dominantBaseline="middle"
                      fontSize={9} fill={`${color}bb`} style={{ fontFamily: 'inherit' }}>
                      {edge.gloss}
                    </text>
                  </g>
                );
              })}

              {/* Cluster gloss pill — springs in from center */}
              {(() => {
                const label = cluster.label;
                const pw = Math.min(label.length * 7 + 24, 110), ph = 22;
                const pillDelay = clusterBaseDelay + 40;
                return (
                  <g style={{
                    transform: mounted
                      ? `translate(${cc.x}px, ${cc.y}px) scale(1)`
                      : `translate(${cx}px, ${cy}px) scale(0.4)`,
                    opacity: mounted ? (clusterDimmed ? 0.12 : 1) : 0,
                    transition: `transform 0.55s cubic-bezier(0.34,1.56,0.64,1) ${pillDelay}ms, opacity 0.3s ease ${pillDelay}ms`,
                    transformBox: 'fill-box',
                    transformOrigin: 'center',
                  }}>
                    <rect x={-pw / 2} y={-ph / 2} width={pw} height={ph} rx={ph / 2}
                      fill="rgba(10,8,6,0.92)" stroke={`${color}66`} strokeWidth={1.2} />
                    <text textAnchor="middle" dominantBaseline="middle"
                      fontSize={11} fill={`${color}dd`}
                      style={{ fontFamily: 'inherit', letterSpacing: '0.06em' }}>
                      {label}
                    </text>
                  </g>
                );
              })()}

              {/* Member nodes — spring from center outward, staggered */}
              {members.map((member, mi) => {
                const pos = memberPositions[mi];
                const isClicked = clickedWord === member.simplified;
                const nodeDelay = clusterBaseDelay + mi * 30;
                const fSize = member.simplified.length <= 1 ? nodeR * 0.88
                  : member.simplified.length === 2 ? nodeR * 0.68
                  : nodeR * 0.52;
                return (
                  <g key={member.simplified}
                    onClick={() => navigateTo(member.simplified)}
                    style={{
                      transform: mounted
                        ? `translate(${pos.x}px, ${pos.y}px)`
                        : `translate(${cx}px, ${cy}px)`,
                      opacity: mounted ? (clusterDimmed ? 0.12 : 1) : 0,
                      transition: `transform 0.6s cubic-bezier(0.34,1.56,0.64,1) ${nodeDelay}ms, opacity 0.3s ease ${nodeDelay}ms`,
                      cursor: 'pointer',
                    }}>
                    {isClicked && <>
                      <circle r={nodeR + 4} fill="none" stroke={color} strokeWidth={2}
                        style={{ animation: 'nodeRipple 0.35s ease-out forwards', transformBox: 'fill-box', transformOrigin: 'center' }} />
                      <circle r={nodeR + 4} fill="none" stroke={color} strokeWidth={1}
                        style={{ animation: 'nodeRipple2 0.5s 0.05s ease-out forwards', transformBox: 'fill-box', transformOrigin: 'center' }} />
                    </>}
                    <g className={isClicked ? 'node-clicked' : ''}>
                      <circle r={nodeR} fill={isClicked ? `${color}22` : `${color}10`}
                        stroke={color} strokeWidth={isClicked ? 2.2 : 1.4} />
                      <text textAnchor="middle" dominantBaseline="middle"
                        fontSize={fSize} className="zh" fill={color}>
                        {member.simplified}
                      </text>
                      <text y={nodeR + 12} textAnchor="middle" dominantBaseline="middle"
                        fontSize={9} fill="rgba(232,213,176,0.4)"
                        style={{ fontFamily: 'inherit' }}>
                        {member.pinyin_display ?? member.pinyin}
                      </text>
                    </g>
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* Focus node at center — scales in */}
        {(() => {
          const fSize = focusWord.length <= 1 ? focusR * 0.92
            : focusWord.length === 2 ? focusR * 0.72 : focusR * 0.55;
          return (
            <g style={{
              transform: `translate(${cx}px, ${cy}px)`,
              opacity: mounted ? 1 : 0,
              transition: 'opacity 0.4s ease 0ms',
            }}>
              <circle r={focusR} fill="rgba(217,164,65,0.10)"
                stroke="rgba(217,164,65,0.65)" strokeWidth={1.8} />
              <text textAnchor="middle" dominantBaseline="middle"
                fontSize={fSize} className="zh"
                fill="rgba(217,164,65,0.92)">
                {focusWord}
              </text>
            </g>
          );
        })()}
      </svg>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' },
};
