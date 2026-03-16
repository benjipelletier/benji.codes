'use client';

import { useState } from 'react';
import type { ClusterMember } from '../../lib/types';
import { WORD_COLORS } from './WordNode';

interface Props {
  member: ClusterMember;
  colorIndex: number;
  allMembers: ClusterMember[];
}

interface TooltipState {
  coll: ClusterMember['collocations'][number];
  x: number;
  y: number;
}

export default function CollocationField({ member, colorIndex, allMembers }: Props) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const color = WORD_COLORS[colorIndex % WORD_COLORS.length];
  const sorted = [...member.collocations].sort((a, b) => b.weight - a.weight);

  // Assign orbital ring: weight > 0.7 = close, 0.4–0.7 = mid, < 0.4 = far
  const rings = [
    sorted.filter((c) => c.weight > 0.7),
    sorted.filter((c) => c.weight >= 0.4 && c.weight <= 0.7),
    sorted.filter((c) => c.weight < 0.4),
  ];

  const ringRadii = [110, 185, 260];
  const cx = 300;
  const cy = 260;
  const svgW = 600;
  const svgH = 520;

  return (
    <div style={s.wrap}>
      <div style={s.svgWrap}>
        <svg
          width={svgW}
          height={svgH}
          viewBox={`0 0 ${svgW} ${svgH}`}
          style={{ overflow: 'visible' }}
        >
          {/* Orbital rings */}
          {ringRadii.map((r, i) => (
            <circle
              key={r}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={`${color}15`}
              strokeWidth={1}
              strokeDasharray="4 6"
            />
          ))}

          {/* Center node */}
          <circle cx={cx} cy={cy} r={40} fill={`${color}10`} stroke={color} strokeWidth={1.5} />
          <text
            x={cx}
            y={cy + 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={28}
            fill={color}
            className="zh"
            style={{ fontFamily: "'Noto Serif SC', serif", fontWeight: 900 }}
          >
            {member.simplified}
          </text>

          {/* Collocation items per ring */}
          {rings.map((ringItems, ringIdx) => {
            if (ringItems.length === 0) return null;
            const r = ringRadii[ringIdx];
            return ringItems.map((coll, itemIdx) => {
              const angle = ((2 * Math.PI) / ringItems.length) * itemIdx - Math.PI / 2;
              const x = cx + r * Math.cos(angle);
              const y = cy + r * Math.sin(angle);

              const hasShared = coll.shared_with_words.length > 0;

              return (
                <g
                  key={coll.collocation}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) => {
                    const rect = (e.currentTarget as SVGElement).closest('svg')!.getBoundingClientRect();
                    setTooltip({
                      coll,
                      x: x + rect.left,
                      y: y + rect.top,
                    });
                  }}
                  onMouseLeave={() => setTooltip(null)}
                >
                  {/* Connector line */}
                  <line
                    x1={cx}
                    y1={cy}
                    x2={x}
                    y2={y}
                    stroke={`${color}20`}
                    strokeWidth={1}
                    strokeDasharray="3 4"
                  />
                  {/* Pill background */}
                  <rect
                    x={x - 28}
                    y={y - 14}
                    width={56}
                    height={28}
                    rx={14}
                    fill={hasShared ? `${color}18` : '#0d0a07'}
                    stroke={hasShared ? color : `${color}44`}
                    strokeWidth={hasShared ? 1.5 : 1}
                  />
                  {/* Chinese phrase */}
                  <text
                    x={x}
                    y={y + 1}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={13}
                    fill={hasShared ? color : `${color}bb`}
                    className="zh"
                    style={{ fontFamily: "'Noto Serif SC', serif", fontWeight: 900 }}
                  >
                    {coll.collocation.length > 3
                      ? coll.collocation.slice(0, 3) + '…'
                      : coll.collocation}
                  </text>

                  {/* Shared badge: small dots for each shared word */}
                  {hasShared && coll.shared_with_words.map((sharedSimp, si) => {
                    const sharedIdx = allMembers.findIndex((m) => m.simplified === sharedSimp);
                    const badgeColor = sharedIdx >= 0 ? WORD_COLORS[sharedIdx % WORD_COLORS.length] : '#888';
                    return (
                      <circle
                        key={sharedSimp}
                        cx={x + 22 + si * 7}
                        cy={y - 10}
                        r={4}
                        fill={badgeColor}
                      />
                    );
                  })}
                </g>
              );
            });
          })}
        </svg>

        {/* Tooltip */}
        {tooltip && (
          <div
            style={{
              position: 'fixed',
              left: tooltip.x + 16,
              top: tooltip.y - 40,
              zIndex: 100,
              background: '#1a1208',
              border: `1px solid ${color}44`,
              borderRadius: '8px',
              padding: '10px 14px',
              pointerEvents: 'none',
              maxWidth: '220px',
            }}
          >
            <p style={{ fontSize: '16px', color, marginBottom: '4px' }} className="zh">
              {tooltip.coll.collocation}
            </p>
            {tooltip.coll.pinyin && (
              <p style={{ fontSize: '11px', color: 'rgba(232,213,176,0.5)', marginBottom: '2px' }}>
                {tooltip.coll.pinyin}
              </p>
            )}
            {tooltip.coll.gloss && (
              <p style={{ fontSize: '12px', color: 'rgba(232,213,176,0.7)' }}>
                {tooltip.coll.gloss}
              </p>
            )}
            {tooltip.coll.pattern_type && (
              <p style={{ fontSize: '10px', color: 'rgba(232,213,176,0.35)', marginTop: '4px' }}>
                {tooltip.coll.pattern_type}
              </p>
            )}
            {tooltip.coll.shared_with_words.length > 0 && (
              <p style={{ fontSize: '11px', color: 'rgba(232,213,176,0.5)', marginTop: '6px' }}>
                Also used with:{' '}
                {tooltip.coll.shared_with_words.map((w) => (
                  <span key={w} className="zh" style={{ color, marginRight: '4px' }}>{w}</span>
                ))}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Core scene */}
      {member.core_scene && (
        <div style={s.scenePanel}>
          <p style={s.sceneLabel}>Scene</p>
          <p style={s.sceneText}>{member.core_scene}</p>
        </div>
      )}

      {/* Raw glosses */}
      <div style={s.glosses}>
        {member.raw_glosses.slice(0, 5).map((g) => (
          <span key={g} style={s.gloss}>{g}</span>
        ))}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
  },
  svgWrap: {
    position: 'relative',
    width: '100%',
    maxWidth: '600px',
  },
  scenePanel: {
    width: '100%',
    maxWidth: '560px',
    background: 'rgba(217,164,65,0.04)',
    border: '1px solid rgba(217,164,65,0.12)',
    borderRadius: '8px',
    padding: '14px 16px',
  },
  sceneLabel: {
    fontSize: '10px',
    color: 'rgba(232,213,176,0.35)',
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    marginBottom: '6px',
  },
  sceneText: {
    fontSize: '13px',
    color: 'rgba(232,213,176,0.65)',
    lineHeight: 1.6,
    fontStyle: 'italic',
  },
  glosses: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    justifyContent: 'center',
  },
  gloss: {
    fontSize: '11px',
    color: 'rgba(232,213,176,0.4)',
    background: 'rgba(217,164,65,0.06)',
    border: '1px solid rgba(217,164,65,0.12)',
    borderRadius: '4px',
    padding: '2px 8px',
  },
};
