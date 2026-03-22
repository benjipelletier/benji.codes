'use client';

import { colors, fonts, labelStyle } from '@/styles/theme';
import type { ContentMap } from '@/lib/types';

interface LineListProps {
  lines: string[];
  contentMap: ContentMap;
  activeLineIndex: number | null;
  annotatedLines: Set<number>;
  onLineClick: (index: number) => void;
}

export default function LineList({
  lines,
  contentMap,
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
    summary: {
      background: `linear-gradient(135deg, ${colors.crossRefBg}, ${colors.cultureBg})`,
      border: `1px solid ${colors.border}`,
      borderRadius: 8,
      padding: 12,
      marginBottom: 16,
      fontSize: 12,
      lineHeight: 1.6,
    } as React.CSSProperties,
    summaryLabel: {
      ...labelStyle,
      marginBottom: 6,
    } as React.CSSProperties,
    summaryText: {
      color: 'rgba(224, 221, 214, 0.7)',
    } as React.CSSProperties,
    motifs: {
      display: 'flex',
      gap: 6,
      marginTop: 8,
      flexWrap: 'wrap' as const,
    } as React.CSSProperties,
    motifTag: {
      background: colors.cultureBg,
      border: `1px solid ${colors.cultureBorder}`,
      borderRadius: 10,
      padding: '2px 8px',
      fontSize: 10,
      color: colors.culture,
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
      <div style={s.summary}>
        <div style={s.summaryLabel}>Content Map</div>
        <div style={s.summaryText}>{contentMap.summary}</div>
        {contentMap.motifs.length > 0 && (
          <div style={s.motifs}>
            {contentMap.motifs.slice(0, 4).map((motif, i) => (
              <span key={i} style={s.motifTag}>{motif}</span>
            ))}
          </div>
        )}
      </div>
      {lines.map((line, i) => (
        <div key={i} style={s.line(i === activeLineIndex)} onClick={() => onLineClick(i)}>
          <div style={s.lineNumber}>{i + 1}</div>
          <div style={s.lineText(i === activeLineIndex)}>{line}</div>
        </div>
      ))}
    </div>
  );
}
