import { HttpError } from '@ifakepro/lib/session';
import { loadStandards } from '@ifakepro/lib/standards';
import { handle } from '../../store';

export const runtime = 'nodejs';

/** One standard's chart, for previewing it before adding. */
export const GET = handle<{ index: string }>(async (_req, { index }) => {
  const s = loadStandards()[Number(index)];
  if (!s) throw new HttpError(404, 'No such standard');
  return { index: s.index, meta: s.meta, chart: s.chart };
});
