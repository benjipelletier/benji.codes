'use client';

import { useState, useCallback } from 'react';
import { colors, fonts } from '@/styles/theme';
import type { LineAnnotation, WordAnnotation } from '@/lib/types';
import WordPopover from './WordPopover';
import InsightStrip from './InsightStrip';
import GrammarUnlock from './GrammarUnlock';
import CrossReference from './CrossReference';

interface AnnotationViewProps {
  annotation: LineAnnotation | null;
  loading: boolean;
  lines: string[];
  isMobile: boolean;
  onLineJump: (lineIndex: number) => void;
  onBack?: () => void;
}

export default function AnnotationView({
  annotation,
  loading,
  lines,
  isMobile,
  onLineJump,
  onBack,
}: AnnotationViewProps) {
  const [activeWord, setActiveWord] = useState<{
    word: WordAnnotation;
    rect: DOMRect | null;
  } | null>(null);

  const handleWordClick = useCallback(
    (word: WordAnnotation, e: React.MouseEvent<HTMLSpanElement>) => {
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      setActiveWord((prev) =>
        prev?.word.chars === word.chars ? null : { word, rect },
      );
    },
    [],
  );

  // Clear active word when annotation changes
  const prevAnnotation = annotation;

  if (loading) {
    return (
      <div style={{ flex: 1, padding: isMobile ? '20px 16px' : '28px 36px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div style={{ color: colors.textMuted, fontSize: 14 }}>Annotating...</div>
      </div>
    );
  }

  if (!annotation) {
    return (
      <div style={{ flex: 1, padding: isMobile ? '20px 16px' : '28px 36px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div style={{ color: colors.textFaint, fontSize: 14 }}>Select a line to annotate</div>
      </div>
    );
  }

  // Build the interactive Chinese line from words array
  const renderInteractiveLine = () => {
    const annotatedWords = new Map(annotation.words.map((w) => [w.chars, w]));
    const chinese = annotation.chinese;
    const elements: React.ReactNode[] = [];
    let i = 0;

    while (i < chinese.length) {
      let matched = false;
      for (let len = Math.min(6, chinese.length - i); len >= 1; len--) {
        const substr = chinese.substring(i, i + len);
        const wordData = annotatedWords.get(substr);
        if (wordData) {
          elements.push(
            <span
              key={i}
              style={{
                cursor: 'pointer',
                borderBottom: `2.5px dotted ${colors.vocab}80`,
                transition: 'opacity 0.15s ease',
              }}
              onClick={(e) => handleWordClick(wordData, e)}
            >
              {substr}
            </span>,
          );
          i += len;
          matched = true;
          break;
        }
      }
      if (!matched) {
        elements.push(
          <span key={i} style={{ opacity: 0.4 }}>
            {chinese[i]}
          </span>,
        );
        i++;
      }
    }

    return elements;
  };

  return (
    <div style={{
      flex: 1,
      padding: isMobile ? '20px 16px' : '28px 36px',
      overflowY: 'auto',
      position: 'relative',
      height: '100%',
    }}>
      {isMobile && onBack && (
        <div style={{ fontSize: 13, color: colors.textMuted, cursor: 'pointer', marginBottom: 16 }} onClick={onBack}>
          ← Back
        </div>
      )}

      {/* The line */}
      <div style={{
        fontSize: isMobile ? 22 : 28,
        fontWeight: 500,
        fontFamily: fonts.chinese,
        marginBottom: 6,
        letterSpacing: 2,
        lineHeight: 1.6,
      }}>
        {renderInteractiveLine()}
      </div>
      <div style={{ fontSize: 14, color: colors.textMuted, fontStyle: 'italic', marginBottom: 28 }}>
        {annotation.translation}
      </div>

      {/* Word popover */}
      {activeWord && (
        <WordPopover
          word={activeWord.word}
          anchorRect={activeWord.rect}
          isMobile={isMobile}
          onClose={() => setActiveWord(null)}
        />
      )}

      {/* Insight strip */}
      <InsightStrip insight={annotation.insight} />

      {/* Grammar unlock */}
      {annotation.grammar_unlock && (
        <GrammarUnlock grammar={annotation.grammar_unlock} />
      )}

      {/* Cross-references */}
      <CrossReference
        references={annotation.cross_references}
        lines={lines}
        onJump={onLineJump}
      />

      {/* Dropped subject / negation notes */}
      {annotation.dropped_subject && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          background: 'rgba(255, 255, 255, 0.02)',
          borderRadius: 6,
          border: `1px solid ${colors.borderSubtle}`,
          marginTop: 12,
        }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: colors.textDimmed, flexShrink: 0 }} />
          <div style={{ fontSize: 12, color: colors.textFaint }}>{annotation.dropped_subject}</div>
        </div>
      )}
      {annotation.negation_note && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          background: 'rgba(255, 255, 255, 0.02)',
          borderRadius: 6,
          border: `1px solid ${colors.borderSubtle}`,
          marginTop: 8,
        }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: colors.textDimmed, flexShrink: 0 }} />
          <div style={{ fontSize: 12, color: colors.textFaint }}>{annotation.negation_note}</div>
        </div>
      )}

      {isMobile && (
        <div style={{ fontSize: 10, color: colors.textDimmed, textAlign: 'center', marginTop: 24 }}>
          Swipe ← → for prev/next line
        </div>
      )}
    </div>
  );
}
