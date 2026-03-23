'use client';

import { useState } from 'react';
import { colors, fonts } from '@/styles/theme';
import type { YuKuai, LLMYuKuaiItem, Familiarity } from '@/lib/yukuai-types';

const typeColors = {
  vocab: { accent: colors.vocab, bg: colors.vocabBg, border: colors.vocabBorder },
  grammar: { accent: colors.grammar, bg: colors.grammarBg, border: colors.grammarBorder },
  expression: { accent: colors.culture, bg: colors.cultureBg, border: colors.cultureBorder },
};

const familiarityLabels: Record<Familiarity, string> = {
  new: 'NEW',
  seen: 'SEEN',
  familiar: 'FAMILIAR',
  known: 'KNOWN',
};

interface YuKuaiCardProps {
  item: LLMYuKuaiItem;
  entity: YuKuai;
  familiarity: Familiarity | null;
  recallMode: boolean;
  onRecallResult?: (result: 'success' | 'fail') => void;
}

export default function YuKuaiCard({ item, entity, familiarity, recallMode, onRecallResult }: YuKuaiCardProps) {
  const [revealed, setRevealed] = useState(false);
  const tc = typeColors[item.type];

  const handleReveal = (knew: boolean) => {
    setRevealed(true);
    if (onRecallResult) {
      onRecallResult(knew ? 'success' : 'fail');
    }
  };

  return (
    <div
      style={{
        background: tc.bg,
        border: `1px solid ${tc.border}`,
        borderRadius: 8,
        padding: 12,
        minWidth: 180,
      }}
    >
      {/* Header: surface form + familiarity badge */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 18, fontFamily: fonts.chinese, color: tc.accent }}>
          {item.surface_form}
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {entity.hsk_level && (
            <span style={{ fontSize: 9, color: colors.textDimmed, border: `1px solid ${colors.border}`, borderRadius: 4, padding: '1px 4px' }}>
              HSK{entity.hsk_level}
            </span>
          )}
          {familiarity && (
            <span style={{ fontSize: 9, color: tc.accent, opacity: 0.7 }}>
              {familiarityLabels[familiarity]}
            </span>
          )}
        </div>
      </div>

      {/* Pinyin (vocab only, from dictionary) */}
      {entity.pinyin && (
        <div style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.mono, marginBottom: 4 }}>
          {entity.pinyin}
        </div>
      )}

      {/* Canonical form for grammar/expression */}
      {item.type !== 'vocab' && (
        <div style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.mono, marginBottom: 4 }}>
          {entity.canonical_form}
        </div>
      )}

      {/* Contextual meaning — hidden in recall mode until revealed */}
      {recallMode && !revealed ? (
        <div style={{ marginTop: 8 }}>
          <div style={{ color: colors.textDimmed, fontSize: 12, marginBottom: 8 }}>
            What does this mean here?
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => handleReveal(true)}
              style={{
                background: 'transparent',
                border: `1px solid ${colors.crossRefBorder}`,
                color: colors.crossRef,
                padding: '4px 12px',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 11,
              }}
            >
              I knew it
            </button>
            <button
              onClick={() => handleReveal(false)}
              style={{
                background: 'transparent',
                border: `1px solid ${colors.border}`,
                color: colors.textMuted,
                padding: '4px 12px',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 11,
              }}
            >
              Show me
            </button>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 13, color: colors.text, lineHeight: 1.5, marginTop: 4 }}>
          {item.contextual_meaning}
        </div>
      )}

      {/* Base definition from dictionary (vocab only, shown small) */}
      {entity.base_definition && !recallMode && (
        <div style={{ fontSize: 11, color: colors.textDimmed, marginTop: 6 }}>
          Dict: {entity.base_definition}
        </div>
      )}
    </div>
  );
}
