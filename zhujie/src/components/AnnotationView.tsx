'use client';

import { colors, fonts, labelStyle } from '@/styles/theme';
import type { YuKuai, LineDecomposition, YuKuaiType, Familiarity, UserYuKuai } from '@/lib/yukuai-types';
import RevealTranslation from './RevealTranslation';
import YuKuaiSection from './YuKuaiSection';
import ConnectionCard from './ConnectionCard';
import GotchaCard from './GotchaCard';

interface AnnotationViewProps {
  lineIndex: number | null;
  decomposition: LineDecomposition | null;
  yukuai: YuKuai[];
  userState: UserYuKuai[] | null;
  recallIds: string[];
  loading: boolean;
  lines: string[];
  isMobile: boolean;
  onLineJump: (lineIndex: number) => void;
  onBack?: () => void;
  onRecallResult: (yukuaiId: string, result: 'success' | 'fail') => void;
}

const typeColors: Record<YuKuaiType, string> = {
  vocab: colors.vocab,
  grammar: colors.grammar,
  expression: colors.culture,
};

export default function AnnotationView({
  lineIndex,
  decomposition,
  yukuai,
  userState,
  recallIds,
  loading,
  lines,
  isMobile,
  onLineJump,
  onBack,
  onRecallResult,
}: AnnotationViewProps) {
  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.textDimmed }}>
        Decomposing...
      </div>
    );
  }

  if (!decomposition) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.textDimmed, padding: 32, textAlign: 'center' }}>
        Click a line to see its YuKuai
      </div>
    );
  }

  // Build lookup maps
  const entityMap = new Map(yukuai.map((yk) => [yk.id, yk]));
  const familiarityMap = new Map(
    (userState ?? []).map((s) => [s.yukuai_id, s.familiarity as Familiarity]),
  );
  const recallSet = new Set(recallIds);

  const chineseText = lineIndex !== null ? lines[lineIndex] ?? '' : '';

  return (
    <div style={{
      flex: 1,
      padding: isMobile ? 16 : 32,
      overflowY: 'auto',
      height: '100%',
    }}>
      {/* Mobile back button */}
      {isMobile && onBack && (
        <button
          onClick={onBack}
          style={{
            background: 'transparent',
            border: 'none',
            color: colors.textMuted,
            cursor: 'pointer',
            fontSize: 13,
            marginBottom: 16,
            padding: 0,
          }}
        >
          ← Back to lines
        </button>
      )}

      {/* Chinese line */}
      <div style={{ fontSize: 24, fontFamily: fonts.chinese, lineHeight: 1.6, color: colors.text, marginBottom: 4 }}>
        {chineseText}
      </div>

      {/* Translation (click to reveal) */}
      <RevealTranslation translation={decomposition.translation} />

      <div style={{ marginTop: 24 }}>
        {/* YuKuai sections by type */}
        {(['vocab', 'grammar', 'expression'] as YuKuaiType[]).map((type) => (
          <YuKuaiSection
            key={type}
            type={type}
            items={decomposition.yukuai}
            entities={entityMap}
            familiarities={familiarityMap}
            recallIds={recallSet}
            onRecallResult={onRecallResult}
          />
        ))}

        {/* Connections */}
        {decomposition.connections.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ ...labelStyle, marginBottom: 8, color: colors.textDimmed }}>
              CONNECTIONS
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {decomposition.connections.map((conn, i) => (
                <ConnectionCard key={i} connection={conn} lines={lines} onJump={onLineJump} />
              ))}
            </div>
          </div>
        )}

        {/* Gotchas */}
        {decomposition.gotchas.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ ...labelStyle, marginBottom: 8, color: colors.textDimmed }}>
              GOTCHAS
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {decomposition.gotchas.map((gotcha, i) => (
                <GotchaCard key={i} gotcha={gotcha} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
