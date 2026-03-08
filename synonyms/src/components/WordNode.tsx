'use client';

// Colors for up to 6 words in a cluster
export const WORD_COLORS = [
  '#d9a441', // amber/gold — primary
  '#41b8d9', // cyan
  '#d94141', // rose
  '#41d972', // green
  '#9b41d9', // violet
  '#d97841', // orange
];

interface WordNodeProps {
  simplified: string;
  pinyin: string | null;
  colorIndex: number;
  size?: number; // diameter in px
  selected?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
}

export default function WordNode({
  simplified,
  pinyin,
  colorIndex,
  size = 72,
  selected = false,
  dimmed = false,
  onClick,
}: WordNodeProps) {
  const color = WORD_COLORS[colorIndex % WORD_COLORS.length];

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '6px',
        cursor: onClick ? 'pointer' : 'default',
        opacity: dimmed ? 0.35 : 1,
        transition: 'opacity 0.3s, transform 0.3s',
        transform: selected ? 'scale(1.1)' : 'scale(1)',
      }}
    >
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: selected
            ? `radial-gradient(circle, ${color}22, ${color}08)`
            : `radial-gradient(circle, ${color}15, ${color}05)`,
          border: `2px solid ${selected ? color : color + '66'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: selected
            ? `0 0 24px ${color}44, 0 0 8px ${color}22`
            : `0 0 12px ${color}22`,
          transition: 'all 0.3s',
        }}
      >
        <span
          className="zh"
          style={{
            fontSize: size * 0.45,
            color: selected ? color : color + 'cc',
            textShadow: selected ? `0 0 16px ${color}66` : 'none',
            transition: 'all 0.3s',
            lineHeight: 1,
          }}
        >
          {simplified}
        </span>
      </div>
      {pinyin && (
        <span
          style={{
            fontSize: '10px',
            color: selected ? color + 'cc' : 'rgba(232,213,176,0.35)',
            letterSpacing: '0.05em',
            transition: 'color 0.3s',
          }}
        >
          {pinyin}
        </span>
      )}
    </div>
  );
}
