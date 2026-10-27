import { serializeSong } from '@ifakepro/lib/ireal';
import { findSong, handle } from '../../../store';

export const GET = handle<{ id: string }>(async (_req, { id }) => {
  const s = await findSong(id);
  return { name: s.meta.title, link: serializeSong({ meta: s.meta, chart: s.chart }) };
});
