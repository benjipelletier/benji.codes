'use client';

import { colors, fonts } from '@/styles/theme';

interface LineListProps {
  lines: string[];
  activeLineIndex: number | null;
  annotatedLines: Set<number>;
  onLineClick: (index: number) => void;
}

export default function LineList({
  lines,
  activeLineIndex,
  annotatedLines,
  onLineClick,
}: LineListProps) {
  const s = {
    container: {
      width: 280,
      borderRight: `1px solid ${colors.border}`,
      padding: 16,
      overflowY: 'auto' as const,
      flexShrink: 0,
      height: '100%',
    } as React.CSSProperties,
    line: (isActive: boolean) =>
      ({
        borderLeft: `3px solid ${isActive ? colors.activeBorder : 'transparent'}`,
        padding: '8px 10px',
        marginBottom: 1,
        background: isActive ? colors.activeBg : 'transparent',
        borderRadius: '0 4px 4px 0',
        cursor: 'pointer',
        transition: 'background 0.15s ease',
      }) as React.CSSProperties,
    lineNumber: {
      fontSize: 10,
      color: colors.textDimmed,
      marginBottom: 2,
    } as React.CSSProperties,
    lineText: (isActive: boolean) =>
      ({
        fontSize: 15,
        fontFamily: fonts.chinese,
        letterSpacing: 0.5,
        opacity: isActive ? 1 : 0.45,
        color: colors.text,
      }) as React.CSSProperties,
  };

  return (
    <div style={s.container}>
      {lines.map((line, i) => (
        <div key={i} style={s.line(i === activeLineIndex)} onClick={() => onLineClick(i)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={s.lineNumber}>{i + 1}</div>
            {annotatedLines.has(i) && (
              <div style={{ width: 4, height: 4, borderRadius: '50%', background: colors.vocab, flexShrink: 0 }} />
            )}
          </div>
          <div style={s.lineText(i === activeLineIndex)}>{line}</div>
        </div>
      ))}
    </div>
  );
}
