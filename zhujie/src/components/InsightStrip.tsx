import { colors, labelStyle } from '@/styles/theme';

interface InsightStripProps {
  insight: string;
}

export default function InsightStrip({ insight }: InsightStripProps) {
  return (
    <div style={{
      borderLeft: `3px solid ${colors.insight}`,
      padding: '12px 16px',
      background: colors.insightBg,
      borderRadius: '0 8px 8px 0',
      marginBottom: 20,
    }}>
      <div style={{ ...labelStyle, color: `${colors.insight}80`, marginBottom: 6 }}>Insight</div>
      <div style={{ fontSize: 13, lineHeight: 1.8, color: 'rgba(224, 221, 214, 0.7)' }}>{insight}</div>
    </div>
  );
}
