import { colors, labelStyle } from '@/styles/theme';
import type { GrammarUnlock as GrammarUnlockType } from '@/lib/types';

interface GrammarUnlockProps {
  grammar: GrammarUnlockType;
}

export default function GrammarUnlock({ grammar }: GrammarUnlockProps) {
  return (
    <div style={{
      borderLeft: `3px solid ${colors.grammar}`,
      padding: '12px 16px',
      background: colors.grammarBg,
      borderRadius: '0 8px 8px 0',
      marginBottom: 20,
    }}>
      <div style={{ ...labelStyle, color: `${colors.grammar}80`, marginBottom: 6 }}>Grammar</div>
      <div style={{ fontSize: 15, color: colors.grammar, marginBottom: 6, fontFamily: "'JetBrains Mono', monospace" }}>{grammar.pattern}</div>
      <div style={{ fontSize: 13, lineHeight: 1.8, color: 'rgba(224, 221, 214, 0.7)', marginBottom: 8 }}>{grammar.explanation}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
        {grammar.examples.map((ex, i) => (
          <span key={i} style={{
            background: colors.grammarBg,
            border: `1px solid ${colors.grammarBorder}`,
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 12,
            color: `${colors.grammar}B3`,
          }}>{ex}</span>
        ))}
      </div>
    </div>
  );
}
