'use client';

import { useState } from 'react';
import { colors, fonts } from '@/styles/theme';

interface RevealTranslationProps {
  translation: string;
}

export default function RevealTranslation({ translation }: RevealTranslationProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div
      onClick={() => setRevealed(true)}
      style={{
        padding: '8px 0',
        cursor: revealed ? 'default' : 'pointer',
        userSelect: revealed ? 'text' : 'none',
      }}
    >
      {revealed ? (
        <span style={{ fontStyle: 'italic', color: colors.textMuted, fontSize: 14, fontFamily: fonts.body }}>
          {translation}
        </span>
      ) : (
        <span style={{ color: colors.textDimmed, fontSize: 13, fontFamily: fonts.body }}>
          Tap to reveal translation
        </span>
      )}
    </div>
  );
}
