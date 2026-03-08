'use client';

import { useState, useMemo } from 'react';
import type { ClusterData } from '../../lib/types';
import WordNode, { WORD_COLORS } from './WordNode';
import CollocationField from './CollocationField';

interface Props {
  cluster: ClusterData;
  focusWord: string;
}

export default function SynonymGraph({ cluster, focusWord }: Props) {
  const [selectedSimplified, setSelectedSimplified] = useState<string | null>(focusWord);

  const members = cluster.members;
  const selectedMember = members.find((m) => m.simplified === selectedSimplified) ?? null;
  const selectedColorIndex = selectedMember
    ? members.findIndex((m) => m.simplified === selectedMember.simplified)
    : 0;

  // Compute edge weights (number of shared glosses per pair)
  const edgeWeights = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const edge of cluster.edges) {
      const key = [edge.word1, edge.word2].sort().join('|');
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [cluster.edges]);

  // Get unique edges (one per pair, with gloss label = most representative)
  const uniqueEdges = useMemo(() => {
    const seen = new Set<string>();
    const result: Array<{ word1: string; word2: string; gloss: string; count: number }> = [];
    for (const edge of cluster.edges) {
      const key = [edge.word1, edge.word2].sort().join('|');
      if (!seen.has(key)) {
        seen.add(key);
        result.push({
          word1: edge.word1,
          word2: edge.word2,
          gloss: edge.gloss,
          count: edgeWeights[key] || 1,
        });
      }
    }
    return result;
  }, [cluster.edges, edgeWeights]);

  // Compute node positions in a circle
  const n = members.length;
  const svgW = 520;
  const svgH = 420;
  const cx = svgW / 2;
  const cy = svgH / 2;
  const radius = Math.min(svgW, svgH) * 0.36;
  const nodeRadius = 36;

  const nodePositions = useMemo(() =>
    members.map((_, i) => {
      const angle = ((2 * Math.PI) / n) * i - Math.PI / 2;
      return {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      };
    }), [n, cx, cy, radius]);

  function getNodePos(simplified: string) {
    const idx = members.findIndex((m) => m.simplified === simplified);
    return idx >= 0 ? nodePositions[idx] : { x: cx, y: cy };
  }

  function handleNodeClick(simplified: string) {
    setSelectedSimplified(selectedSimplified === simplified ? null : simplified);
  }

  const maxEdgeCount = Math.max(...uniqueEdges.map((e) => e.count), 1);

  return (
    <div style={s.wrap}>
      {/* Graph */}
      <div style={s.graphSection}>
        <svg
          width={svgW}
          height={svgH}
          viewBox={`0 0 ${svgW} ${svgH}`}
          style={{ overflow: 'visible', width: '100%', maxWidth: svgW }}
        >
          {/* Edges */}
          {uniqueEdges.map((edge) => {
            const pos1 = getNodePos(edge.word1);
            const pos2 = getNodePos(edge.word2);
            const midX = (pos1.x + pos2.x) / 2;
            const midY = (pos1.y + pos2.y) / 2;
            const thickness = 1 + (edge.count / maxEdgeCount) * 2.5;
            const isRelated =
              selectedMember === null ||
              edge.word1 === selectedMember.simplified ||
              edge.word2 === selectedMember.simplified;
            const edgeOpacity = isRelated ? 1 : 0.2;

            return (
              <g key={`${edge.word1}-${edge.word2}`} style={{ opacity: edgeOpacity, transition: 'opacity 0.3s' }}>
                <line
                  x1={pos1.x}
                  y1={pos1.y}
                  x2={pos2.x}
                  y2={pos2.y}
                  stroke="rgba(217,164,65,0.3)"
                  strokeWidth={thickness}
                  strokeDasharray={edge.count >= 3 ? 'none' : edge.count === 2 ? '8 4' : '4 6'}
                />
                {/* Gloss label at midpoint */}
                <rect
                  x={midX - 24}
                  y={midY - 9}
                  width={48}
                  height={18}
                  rx={9}
                  fill="#0d0a07"
                  stroke="rgba(217,164,65,0.2)"
                  strokeWidth={1}
                />
                <text
                  x={midX}
                  y={midY + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={9}
                  fill="rgba(217,164,65,0.6)"
                  style={{ fontFamily: 'inherit' }}
                >
                  {edge.gloss.length > 7 ? edge.gloss.slice(0, 7) + '…' : edge.gloss}
                </text>
                {/* Edge count indicator */}
                {edge.count > 1 && (
                  <text
                    x={midX + 28}
                    y={midY - 5}
                    fontSize={8}
                    fill="rgba(217,164,65,0.4)"
                    style={{ fontFamily: 'inherit' }}
                  >
                    ×{edge.count}
                  </text>
                )}
              </g>
            );
          })}

          {/* Word nodes as foreignObject (to reuse WordNode component) */}
          {members.map((member, i) => {
            const pos = nodePositions[i];
            const isSelected = member.simplified === selectedSimplified;
            const isDimmed = selectedSimplified !== null && !isSelected;

            return (
              <foreignObject
                key={member.simplified}
                x={pos.x - nodeRadius - 16}
                y={pos.y - nodeRadius - 20}
                width={nodeRadius * 2 + 32}
                height={nodeRadius * 2 + 44}
                style={{ overflow: 'visible' }}
              >
                <div
                  xmlns="http://www.w3.org/1999/xhtml"
                  style={{ display: 'flex', justifyContent: 'center' }}
                >
                  <WordNode
                    simplified={member.simplified}
                    pinyin={member.pinyin_display ?? member.pinyin}
                    colorIndex={i}
                    size={nodeRadius * 2}
                    selected={isSelected}
                    dimmed={isDimmed}
                    onClick={() => handleNodeClick(member.simplified)}
                  />
                </div>
              </foreignObject>
            );
          })}
        </svg>

        {/* Legend */}
        <div style={s.legend}>
          <span style={s.legendItem}>
            <svg width={30} height={10}><line x1={0} y1={5} x2={30} y2={5} stroke="rgba(217,164,65,0.4)" strokeWidth={1} strokeDasharray="4 6" /></svg>
            1 shared gloss
          </span>
          <span style={s.legendItem}>
            <svg width={30} height={10}><line x1={0} y1={5} x2={30} y2={5} stroke="rgba(217,164,65,0.4)" strokeWidth={2} strokeDasharray="8 4" /></svg>
            2 shared glosses
          </span>
          <span style={s.legendItem}>
            <svg width={30} height={10}><line x1={0} y1={5} x2={30} y2={5} stroke="rgba(217,164,65,0.4)" strokeWidth={3.5} /></svg>
            3+ shared glosses
          </span>
        </div>
      </div>

      {/* Collocation field for selected word */}
      {selectedMember && (
        <div style={s.collocationSection}>
          <div style={s.collocationHeader}>
            <span className="zh" style={{ ...s.collocationTitle, color: WORD_COLORS[selectedColorIndex] }}>
              {selectedMember.simplified}
            </span>
            <span style={s.collocationSubtitle}>collocational field</span>
          </div>
          {selectedMember.collocations.length > 0 ? (
            <CollocationField
              member={selectedMember}
              colorIndex={selectedColorIndex}
              allMembers={members}
            />
          ) : (
            <p style={s.noCollocations}>No collocations available — enrichment may still be loading</p>
          )}
        </div>
      )}

      {/* All members summary */}
      <div style={s.memberSummary}>
        {members.map((m, i) => {
          const color = WORD_COLORS[i % WORD_COLORS.length];
          const isSelected = m.simplified === selectedSimplified;
          return (
            <button
              key={m.simplified}
              style={{
                ...s.memberCard,
                borderColor: isSelected ? color + '88' : 'rgba(217,164,65,0.1)',
                background: isSelected ? color + '0d' : 'rgba(217,164,65,0.03)',
              }}
              onClick={() => handleNodeClick(m.simplified)}
            >
              <span className="zh" style={{ fontSize: '24px', color, lineHeight: 1 }}>{m.simplified}</span>
              <span style={{ fontSize: '10px', color: 'rgba(232,213,176,0.35)' }}>
                {m.pinyin_display ?? m.pinyin}
              </span>
              {m.core_scene && (
                <span style={{ fontSize: '11px', color: 'rgba(232,213,176,0.5)', lineHeight: 1.4, fontStyle: 'italic' }}>
                  {m.core_scene.slice(0, 60)}{m.core_scene.length > 60 ? '…' : ''}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: '32px',
  },
  graphSection: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
  },
  legend: {
    display: 'flex',
    gap: '20px',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '10px',
    color: 'rgba(232,213,176,0.35)',
  },
  collocationSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  collocationHeader: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '12px',
  },
  collocationTitle: {
    fontSize: '32px',
  },
  collocationSubtitle: {
    fontSize: '12px',
    color: 'rgba(232,213,176,0.35)',
    letterSpacing: '0.1em',
  },
  noCollocations: {
    fontSize: '13px',
    color: 'rgba(232,213,176,0.35)',
    fontStyle: 'italic',
    padding: '20px 0',
  },
  memberSummary: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: '10px',
  },
  memberCard: {
    background: 'rgba(217,164,65,0.03)',
    border: '1px solid rgba(217,164,65,0.1)',
    borderRadius: '8px',
    padding: '14px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    textAlign: 'left',
  },
};
