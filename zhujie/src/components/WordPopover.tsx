'use client';

import { useEffect, useRef } from 'react';
import { colors, fonts } from '@/styles/theme';
import type { WordAnnotation } from '@/lib/types';

interface WordPopoverProps {
  word: WordAnnotation;
  anchorRect: DOMRect | null;
  isMobile: boolean;
  onClose: () => void;
}

export default function WordPopover({ word, anchorRect, isMobile, onClose }: WordPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  const popoverStyle: React.CSSProperties = {
    position: 'absolute',
    top: anchorRect ? anchorRect.bottom + 8 : 0,
    left: anchorRect ? anchorRect.left : 0,
    background: colors.surface,
    border: `1px solid ${colors.vocabBorder}`,
    borderRadius: 10,
    padding: 16,
    maxWidth: 400,
    zIndex: 100,
    boxShadow: '0 4px 24px rgba(0, 0, 0, 0.3)',
  };

  const bottomSheetStyle: React.CSSProperties = {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    background: colors.surface,
    borderTop: `1px solid ${colors.vocabBorder}`,
    borderRadius: '16px 16px 0 0',
    padding: '20px 20px 32px',
    zIndex: 100,
    boxShadow: '0 -4px 24px rgba(0, 0, 0, 0.3)',
  };

  return (
    <div ref={ref} style={isMobile ? bottomSheetStyle : popoverStyle}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 20, color: colors.vocab, fontFamily: fonts.chinese }}>{word.chars}</span>
        {word.has_pinyin_gotcha && word.pinyin && (
          <span style={{ fontSize: 12, color: `${colors.vocab}80`, fontFamily: fonts.mono }}>{word.pinyin}</span>
        )}
        {word.difficulty && (
          <span style={{
            background: `${colors.vocab}14`,
            border: `1px solid ${colors.vocab}26`,
            borderRadius: 4,
            padding: '1px 6px',
            fontSize: 10,
            color: `${colors.vocab}99`,
          }}>{word.difficulty}</span>
        )}
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.8, color: 'rgba(224, 221, 214, 0.75)' }}>{word.note}</div>
    </div>
  );
}
