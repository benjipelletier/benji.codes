import { searchStandards } from '@ifakepro/lib/standards';
import type { StandardHit } from '@ifakepro/lib/types';
import { handle } from '../store';

export const runtime = 'nodejs';

export const GET = handle(async (req): Promise<{ results: StandardHit[] }> => {
  const q = req.nextUrl.searchParams.get('q') ?? '';
  return {
    results: searchStandards(q, 60).map((s) => ({
      index: s.index, title: s.meta.title, composer: s.meta.composer, style: s.meta.style, key: s.meta.key, bars: s.chart.bars.length,
    })),
  };
});
