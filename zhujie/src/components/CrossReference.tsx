import { colors } from '@/styles/theme';
import type { CrossReference as CrossRefType } from '@/lib/types';

interface CrossReferenceProps {
  references: CrossRefType[];
  lines: string[];
  onJump: (lineIndex: number) => void;
}

export default function CrossReference({ references, lines, onJump }: CrossReferenceProps) {
  if (references.length === 0) return null;

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: 1, color: `${colors.crossRef}80`, marginBottom: 8 }}>Connections</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
        {references.map((ref, i) => (
          <div key={i} style={{
            background: colors.crossRefBg,
            border: `1px solid ${colors.crossRefBorder}`,
            borderRadius: 8,
            padding: '8px 12px',
            cursor: 'pointer',
            maxWidth: 320,
          }} onClick={() => onJump(ref.target_line)}>
            <div style={{ fontSize: 12, color: colors.crossRef, marginBottom: 3 }}>
              → Line {ref.target_line + 1} — {lines[ref.target_line] ?? ''}
            </div>
            <div style={{ fontSize: 11, color: `${colors.crossRef}80`, lineHeight: 1.5 }}>{ref.note}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
