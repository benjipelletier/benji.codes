'use client';

import { colors } from '@/styles/theme';
import type { LLMGotcha } from '@/lib/yukuai-types';

interface GotchaCardProps {
  gotcha: LLMGotcha;
}

export default function GotchaCard({ gotcha }: GotchaCardProps) {
  return (
    <div
      style={{
        background: colors.grammarBg,
        border: `1px solid ${colors.grammarBorder}`,
        borderLeft: `3px solid ${colors.grammar}`,
        borderRadius: '0 8px 8px 0',
        padding: 12,
      }}
    >
      <div style={{ fontSize: 13, color: colors.text, lineHeight: 1.5 }}>
        ⚠ {gotcha.note}
      </div>
    </div>
  );
}
