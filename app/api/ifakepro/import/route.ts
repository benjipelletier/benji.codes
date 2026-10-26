import { HttpError } from '@ifakepro/lib/session';
import { parseIReal } from '@ifakepro/lib/ireal';
import type { ImportPreview } from '@ifakepro/lib/types';
import { handle, readBody } from '../store';

/** { text }: what an iReal link (or exported HTML page) holds, without saving anything. */
export const POST = handle(async (req): Promise<ImportPreview> => {
  const { text } = await readBody(req);
  if (typeof text !== 'string' || !text.trim()) throw new HttpError(400, 'Paste an irealb:// link');
  try {
    const p = parseIReal(text);
    return {
      name: p.name,
      songs: p.songs.map((s) => ({ title: s.meta.title, composer: s.meta.composer, style: s.meta.style, key: s.meta.key, bars: s.chart.bars.length })),
      failed: p.failed,
    };
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : 'Could not read that link');
  }
});
