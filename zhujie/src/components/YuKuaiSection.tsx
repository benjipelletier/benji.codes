'use client';

import { colors, labelStyle } from '@/styles/theme';
import type { YuKuai, LLMYuKuaiItem, YuKuaiType, Familiarity } from '@/lib/yukuai-types';
import YuKuaiCard from './YuKuaiCard';

const sectionLabels: Record<YuKuaiType, string> = {
  vocab: 'VOCABULARY',
  grammar: 'GRAMMAR',
  expression: 'EXPRESSIONS',
};

interface YuKuaiSectionProps {
  type: YuKuaiType;
  items: LLMYuKuaiItem[];
  entities: Map<string, YuKuai>;
  familiarities: Map<string, Familiarity>;
  recallIds: Set<string>;
  onRecallResult: (yukuaiId: string, result: 'success' | 'fail') => void;
}

export default function YuKuaiSection({ type, items, entities, familiarities, recallIds, onRecallResult }: YuKuaiSectionProps) {
  const filtered = items.filter((item) => item.type === type);
  if (filtered.length === 0) return null;

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ ...labelStyle, marginBottom: 8, color: colors.textDimmed }}>
        {sectionLabels[type]}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {filtered.map((item) => {
          const entity = entities.get(item.canonical_id);
          if (!entity) return null;
          return (
            <YuKuaiCard
              key={item.canonical_id}
              item={item}
              entity={entity}
              familiarity={familiarities.get(item.canonical_id) ?? null}
              recallMode={recallIds.has(item.canonical_id)}
              onRecallResult={(result) => onRecallResult(item.canonical_id, result)}
            />
          );
        })}
      </div>
    </div>
  );
}
