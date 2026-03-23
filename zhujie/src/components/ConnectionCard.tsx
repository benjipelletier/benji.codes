'use client';

import { colors } from '@/styles/theme';
import type { LLMConnection } from '@/lib/yukuai-types';

interface ConnectionCardProps {
  connection: LLMConnection;
  lines: string[];
  onJump: (lineIndex: number) => void;
}

export default function ConnectionCard({ connection, lines, onJump }: ConnectionCardProps) {
  const targetLine = lines[connection.to_line];
  if (!targetLine) return null;

  return (
    <div
      onClick={() => onJump(connection.to_line)}
      style={{
        background: colors.crossRefBg,
        border: `1px solid ${colors.crossRefBorder}`,
        borderRadius: 8,
        padding: 12,
        cursor: 'pointer',
        transition: 'border-color 0.15s ease',
      }}
    >
      <div style={{ fontSize: 12, color: colors.crossRef, marginBottom: 4 }}>
        → Line {connection.to_line + 1} — {targetLine}
      </div>
      <div style={{ fontSize: 13, color: colors.text, lineHeight: 1.5 }}>
        {connection.note}
      </div>
    </div>
  );
}
