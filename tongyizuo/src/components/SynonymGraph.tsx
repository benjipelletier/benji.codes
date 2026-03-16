'use client';

import { useState, useMemo } from 'react';
import type { ClusterData } from '../../lib/types';
import { WORD_COLORS } from './WordNode';
import CollocationField from './CollocationField';

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
  const [selectedSimplified, setSelectedSimplified] = useState<string | null>(null);

  const K = clusters.length;
  const svgW = 900;
  const svgH = 900;
  const cx = svgW / 2;
  const cy = svgH / 2;

  // Distance from 看 to each cluster's gloss pill center
  const clusterR = K === 1 ? 180 : K === 2 ? 200 : K <= 4 ? 218 : 230;
  // Distance from cluster gloss pill to each member node
  const memberR = 118;
  // Outer gloss ring: distance from member node edge to pill center
  const outerRingDist = 56;

  const focusR = 36;   // 看 node radius
  const nodeR = 32;    // member node radius

  // Cluster center positions
  const clusterCenters = useMemo(() =>
    clusters.map((_, i) => {
      const angle = (2 * Math.PI * i / K) - Math.PI / 2;
      return { x: cx + clusterR * Math.cos(angle), y: cy + clusterR * Math.sin(angle), angle };
    }), [K, clusterR, cx, cy]);

  // Per-cluster: sorted members (excluding focusWord) + their positions
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

    const memberPositions = members.map((_, mi) => {
      const angle = (2 * Math.PI * mi / (members.length || 1)) - Math.PI / 2;
      return { x: cc.x + memberR * Math.cos(angle), y: cc.y + memberR * Math.sin(angle), angle };
    });

    // Cross-edges within this cluster (between non-focusWord members, weight >= 2)
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

  // Which cluster owns the selected node
  const selectedInfo = useMemo(() => {
    if (!selectedSimplified || selectedSimplified === focusWord) return null;
    for (let ci = 0; ci < layouts.length; ci++) {
      const { members, memberPositions, cluster } = layouts[ci];
      const mi = members.findIndex(m => m.simplified === selectedSimplified);
      if (mi >= 0) return { member: members[mi], pos: memberPositions[mi], ci, cluster };
    }
    return null;
  }, [selectedSimplified, layouts, focusWord]);

  function handleClick(word: string) {
    setSelectedSimplified(prev => prev === word ? null : word);
  }

  // Gloss fan radiating outward from selected node (on click)
  const glossFan = useMemo(() => {
    if (!selectedInfo) return null;
    const { member, pos, ci, cluster } = selectedInfo;
    const cc = layouts[ci].cc;
    const dx = pos.x - cc.x, dy = pos.y - cc.y;
    const mag = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = dx / mag, ny = dy / mag;

    const glosses = (member.raw_glosses ?? [])
      .map(shortGloss).filter(Boolean)
      .filter((g, i, a) => a.indexOf(g) === i).slice(0, 5);
    if (!glosses.length) return null;

    const color = WORD_COLORS[ci % WORD_COLORS.length];
    const spread = Math.min((glosses.length - 1) * 0.3, 1.0);
    const lineLen = 54;

    return glosses.map((g, i) => {
      const da = glosses.length > 1 ? -spread / 2 + i * (spread / (glosses.length - 1)) : 0;
      const cos = Math.cos(da), sin = Math.sin(da);
      const fx = nx * cos - ny * sin, fy = nx * sin + ny * cos;
      const sx = pos.x + fx * (nodeR + 4), sy = pos.y + fy * (nodeR + 4);
      const ex = pos.x + fx * (nodeR + lineLen), ey = pos.y + fy * (nodeR + lineLen);
      const isLabel = g === cluster.label;
      const pw = Math.min(g.length * 6.5 + 20, 120), ph = 18;
      return (
        <g key={`fan-${i}`}>
          <line x1={sx} y1={sy} x2={ex} y2={ey}
            stroke={isLabel ? `${color}99` : 'rgba(217,164,65,0.2)'}
            strokeWidth={1} strokeDasharray="3 3" />
          <rect x={ex - pw / 2} y={ey - ph / 2} width={pw} height={ph} rx={ph / 2}
            fill="rgba(10,8,6,0.94)"
            stroke={isLabel ? `${color}cc` : 'rgba(217,164,65,0.28)'} strokeWidth={1} />
          <text x={ex} y={ey} textAnchor="middle" dominantBaseline="middle"
            fontSize={9} fill={isLabel ? color : 'rgba(217,164,65,0.55)'}
            style={{ fontFamily: 'inherit' }}>
            {g}
          </text>
        </g>
      );
    });
  }, [selectedInfo, layouts]);

  // Outer gloss ring: other definitions — only shown for the selected node
  const outerRing = useMemo(() => layouts.flatMap(({ cluster, members, memberPositions, cc }, ci) => {
    const color = WORD_COLORS[ci % WORD_COLORS.length];
    return members.flatMap((member, mi) => {
      const isSelected = selectedSimplified === member.simplified;
      if (!isSelected) return [];
      const pos = memberPositions[mi];
      const opacity = 0.82;

      const outward = (() => {
        const dx = pos.x - cc.x, dy = pos.y - cc.y;
        const mag = Math.sqrt(dx * dx + dy * dy) || 1;
        return { x: dx / mag, y: dy / mag, angle: Math.atan2(dy, dx) };
      })();

      const otherGlosses = (member.raw_glosses ?? [])
        .map(shortGloss).filter(Boolean)
        .filter((g, i, a) => a.indexOf(g) === i)
        .filter(g => g !== cluster.label)
        .slice(0, 3);

      if (!otherGlosses.length) return [];

      const spread = Math.min((otherGlosses.length - 1) * 0.2, 0.4);
      return otherGlosses.map((g, j) => {
        const da = otherGlosses.length > 1
          ? -spread / 2 + j * (spread / (otherGlosses.length - 1)) : 0;
        const gAngle = outward.angle + da;
        const gx = pos.x + Math.cos(gAngle) * (nodeR + outerRingDist);
        const gy = pos.y + Math.sin(gAngle) * (nodeR + outerRingDist);
        const pw = Math.min(g.length * 5.8 + 14, 86), ph = 16;
        return (
          <g key={`outer-${ci}-${mi}-${j}`} style={{ opacity, transition: 'opacity 0.25s' }}>
            <rect x={gx - pw / 2} y={gy - ph / 2} width={pw} height={ph} rx={ph / 2}
              fill="rgba(10,8,6,0.82)" stroke={`${color}38`} strokeWidth={0.8} />
            <text x={gx} y={gy} textAnchor="middle" dominantBaseline="middle"
              fontSize={8} fill={`${color}99`} style={{ fontFamily: 'inherit' }}>
              {g}
            </text>
          </g>
        );
      });
    });
  }), [layouts, selectedSimplified, outerRingDist, activeClusterIdx]);

  return (
    <div style={s.wrap}>
      <svg
        width={svgW} height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        style={{ overflow: 'visible', width: '100%', maxWidth: svgW }}
      >
        {/* Outer gloss rings — behind everything */}
        {outerRing}

        {/* Spokes: 看 → each cluster gloss pill */}
        {clusterCenters.map((cc, ci) => (
          <line key={`trunk-${ci}`}
            x1={cx} y1={cy} x2={cc.x} y2={cc.y}
            stroke="rgba(217,164,65,0.18)" strokeWidth={1.2}
            strokeDasharray="6 5"
            style={{
              opacity: activeClusterIdx !== null && activeClusterIdx !== ci ? 0.12 : 1,
              transition: 'opacity 0.3s',
            }} />
        ))}

        {/* Per-cluster: spokes, cross-edges, gloss pill, member nodes */}
        {layouts.map(({ cluster, cc, members, memberPositions, crossEdges }, ci) => {
          const color = WORD_COLORS[ci % WORD_COLORS.length];
          const maxCross = Math.max(...crossEdges.map(e => 2), 2);
          const clusterDimmed = activeClusterIdx !== null && activeClusterIdx !== ci;

          return (
            <g key={`cluster-${ci}`}
              style={{ opacity: clusterDimmed ? 0.12 : 1, transition: 'opacity 0.3s' }}>
              {/* Spokes: gloss pill → members */}
              {members.map((m, mi) => {
                const pos = memberPositions[mi];
                const edgeKey = [focusWord, m.simplified].sort().join('|');
                const edgeCnt = layouts[ci].cluster.edges.filter(
                  e => (e.word1 === focusWord && e.word2 === m.simplified) ||
                       (e.word2 === focusWord && e.word1 === m.simplified)
                ).length;
                const thick = 0.7 + (edgeCnt / 3) * 1.8;
                const dash = edgeCnt >= 3 ? 'none' : edgeCnt === 2 ? '8 4' : '4 6';
                const dimmed = selectedSimplified !== null && selectedSimplified !== m.simplified;
                return (
                  <line key={`spoke-${ci}-${mi}`}
                    x1={cc.x} y1={cc.y} x2={pos.x} y2={pos.y}
                    stroke={`${color}55`} strokeWidth={thick} strokeDasharray={dash}
                    style={{ opacity: dimmed ? 0.08 : 1, transition: 'opacity 0.25s' }} />
                );
              })}

              {/* Cross-edges between members */}
              {crossEdges.map(edge => {
                const i1 = members.findIndex(m => m.simplified === edge.word1);
                const i2 = members.findIndex(m => m.simplified === edge.word2);
                if (i1 < 0 || i2 < 0) return null;
                const p1 = memberPositions[i1], p2 = memberPositions[i2];
                const midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;
                const pw = Math.min(edge.gloss.length * 6.5 + 18, 90), ph = 17;
                const dimmed = selectedSimplified !== null
                  && selectedSimplified !== edge.word1
                  && selectedSimplified !== edge.word2;
                return (
                  <g key={`cross-${ci}-${edge.word1}-${edge.word2}`}
                    style={{ opacity: dimmed ? 0.06 : 1, transition: 'opacity 0.25s' }}>
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

              {/* Cluster gloss pill at sub-center — same style as cross-edge labels */}
              {(() => {
                const label = cluster.label;
                const pw = Math.min(label.length * 7 + 24, 110), ph = 22;
                return (
                  <g style={{ cursor: 'default' }}>
                    <rect x={cc.x - pw / 2} y={cc.y - ph / 2} width={pw} height={ph} rx={ph / 2}
                      fill="rgba(10,8,6,0.92)" stroke={`${color}66`} strokeWidth={1.2} />
                    <text x={cc.x} y={cc.y} textAnchor="middle" dominantBaseline="middle"
                      fontSize={11} fill={`${color}dd`}
                      style={{ fontFamily: 'inherit', letterSpacing: '0.06em' }}>
                      {label}
                    </text>
                  </g>
                );
              })()}

              {/* Member nodes */}
              {members.map((member, mi) => {
                const pos = memberPositions[mi];
                const isSelected = selectedSimplified === member.simplified;
                const isDimmed = selectedSimplified !== null && !isSelected;
                const fSize = member.simplified.length <= 1 ? nodeR * 0.88
                  : member.simplified.length === 2 ? nodeR * 0.68
                  : nodeR * 0.52;
                return (
                  <g key={member.simplified} transform={`translate(${pos.x},${pos.y})`}
                    onClick={() => handleClick(member.simplified)}
                    style={{ cursor: 'pointer', opacity: isDimmed ? 0.22 : 1, transition: 'opacity 0.25s' }}>
                    <circle r={nodeR} fill={`${color}10`}
                      stroke={isSelected ? color : `${color}77`}
                      strokeWidth={isSelected ? 2 : 1.4} />
                    {isSelected && <circle r={nodeR + 5} fill="none" stroke={`${color}22`} strokeWidth={5} />}
                    <text textAnchor="middle" dominantBaseline="middle"
                      fontSize={fSize} className="zh"
                      fill={isSelected ? color : `${color}ee`}>
                      {member.simplified}
                    </text>
                    <text y={nodeR + 12} textAnchor="middle" dominantBaseline="middle"
                      fontSize={9} fill={isSelected ? `${color}99` : 'rgba(232,213,176,0.4)'}
                      style={{ fontFamily: 'inherit' }}>
                      {member.pinyin_display ?? member.pinyin}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* 看 — focus node at center */}
        {(() => {
          const isSel = selectedSimplified === focusWord;
          const isDimmed = selectedSimplified !== null && !isSel;
          const fSize = focusWord.length <= 1 ? focusR * 0.92
            : focusWord.length === 2 ? focusR * 0.72 : focusR * 0.55;
          return (
            <g transform={`translate(${cx},${cy})`}
              onClick={() => handleClick(focusWord)}
              style={{ cursor: 'pointer', opacity: isDimmed ? 0.3 : 1, transition: 'opacity 0.25s' }}>
              <circle r={focusR} fill="rgba(217,164,65,0.10)"
                stroke={isSel ? '#d9a441' : 'rgba(217,164,65,0.65)'}
                strokeWidth={isSel ? 2.5 : 1.8} />
              {isSel && <circle r={focusR + 6} fill="none" stroke="rgba(217,164,65,0.2)" strokeWidth={6} />}
              <text textAnchor="middle" dominantBaseline="middle"
                fontSize={fSize} className="zh"
                fill={isSel ? '#d9a441' : 'rgba(217,164,65,0.92)'}>
                {focusWord}
              </text>
            </g>
          );
        })()}

        {/* Gloss fan on selection — on top */}
        {glossFan}
      </svg>

      {/* Detail panel */}
      {selectedInfo && (
        <div style={s.detail}>
          <div style={s.detailHeader}>
            <span className="zh" style={{
              fontSize: '28px',
              color: WORD_COLORS[selectedInfo.ci % WORD_COLORS.length],
              lineHeight: 1,
            }}>
              {selectedInfo.member.simplified}
            </span>
            <span style={s.detailPinyin}>
              {selectedInfo.member.pinyin_display ?? selectedInfo.member.pinyin}
            </span>
          </div>
          {selectedInfo.member.collocations.length > 0 && (
            <CollocationField
              member={selectedInfo.member}
              colorIndex={selectedInfo.ci % WORD_COLORS.length}
              allMembers={layouts[selectedInfo.ci].members}
            />
          )}
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px' },
  detail: {
    width: '100%', display: 'flex', flexDirection: 'column', gap: '12px',
    paddingTop: '8px', borderTop: '1px solid rgba(217,164,65,0.1)',
  },
  detailHeader: { display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' },
  detailPinyin: { fontSize: '13px', color: 'rgba(232,213,176,0.5)' },
};
