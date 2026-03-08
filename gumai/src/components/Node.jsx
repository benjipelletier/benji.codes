import { useEffect, useRef } from 'react';

const TYPE_COLORS = {
  chengyu: '#2A2A2A',
  figure: '#1A1A2E',
  character: '#1E2A1A',
  concept: '#2A1A1A',
};

export default function Node({ node, position, isCompleted, isToday, onTap }) {
  const circleRef = useRef(null);

  if (!position) return null;

  const { x, y } = position;
  const r = node.node_type === 'figure' ? 18 : node.node_type === 'concept' ? 16 : 14;
  const isShort = node.title.length <= 2;

  const baseColor = TYPE_COLORS[node.node_type] || '#1A1A1A';
  const opacity = isCompleted ? 1 : isToday ? 0.9 : 0.25;

  return (
    <g
      onClick={onTap}
      style={{ cursor: 'pointer' }}
    >
      {/* Today's glow ring */}
      {isToday && (
        <circle
          cx={x} cy={y} r={r + 8}
          fill="none"
          stroke="#C23B22"
          strokeWidth={1.5}
          opacity={0.4}
          style={{ animation: 'pulse 2s ease-in-out infinite' }}
        />
      )}

      {/* Completed seal stamp ring */}
      {isCompleted && (
        <circle
          cx={x} cy={y} r={r + 4}
          fill="none"
          stroke="#C23B22"
          strokeWidth={0.8}
          opacity={0.35}
          strokeDasharray="3 4"
        />
      )}

      {/* Ink bleed outer glow */}
      <circle
        cx={x} cy={y} r={r + 2}
        fill={baseColor}
        opacity={opacity * 0.08}
        filter="url(#inkBleed)"
      />

      {/* Main ink dot */}
      <circle
        ref={circleRef}
        cx={x} cy={y} r={r}
        fill={baseColor}
        opacity={opacity}
        filter={!isCompleted && !isToday ? "url(#fogBlur)" : "url(#inkBleed)"}
      />

      {/* Character label */}
      <text
        x={x} y={y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={isShort ? r * 0.9 : r * 0.65}
        fontFamily="'Noto Serif SC', serif"
        fontWeight="600"
        fill="#F5F0E8"
        opacity={isCompleted || isToday ? 0.95 : 0.6}
        filter={!isCompleted && !isToday ? "url(#fogBlur)" : undefined}
        style={{ userSelect: 'none', pointerEvents: 'none' }}
      >
        {node.title.slice(0, isShort ? 2 : 2)}
      </text>

      {/* Pinyin label — shown on completed or today */}
      {(isCompleted || isToday) && (
        <text
          x={x} y={y + r + 10}
          textAnchor="middle"
          fontSize={9}
          fontFamily="'Cormorant Garamond', serif"
          fontStyle="italic"
          fill="#4A4A4A"
          opacity={0.7}
          style={{ userSelect: 'none', pointerEvents: 'none' }}
        >
          {node.pinyin}
        </text>
      )}
    </g>
  );
}
