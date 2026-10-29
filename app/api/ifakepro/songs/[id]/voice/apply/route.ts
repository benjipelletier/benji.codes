import { NextResponse } from 'next/server';
import { HttpError, requireRole } from '@ifakepro/lib/session';
import { sanitizeChart, sanitizeMeta } from '@ifakepro/lib/chart';
import { applyOps } from '@ifakepro/lib/script';
import { findSong, handle, readBody, saveSong } from '../../../../store';
import { MAX_TRANSCRIPT, VOICE_AGENT } from '../../../../voice';

type P = { id: string };

/**
 * { revision, ops, transcript }: keep a voice edit. The ops run again here on
 * the song at `revision` (409 if it has moved on), all or none, and save as
 * the person, marked "Voice" with what they said, like an agent's edit.
 */
export const POST = handle<P>(async (req, { id }) => {
  const song = await findSong(id);
  const user = await requireRole(song.playlist_id, 'editor');
  if (song.deleted_at) throw new HttpError(410, 'This song was deleted');
  const body = await readBody(req);
  if (typeof body.revision !== 'number') throw new HttpError(400, 'revision is required');
  const changed = () => NextResponse.json({ error: 'changed', message: 'Someone changed the song while you were talking. Try again.' }, { status: 409 });
  if (body.revision !== song.revision) return changed();
  const before = { meta: song.meta, chart: song.chart };
  const result = applyOps(before, body.ops);
  if ('errors' in result) return NextResponse.json({ error: 'refused', errors: result.errors }, { status: 422 });
  const meta = sanitizeMeta(result.doc.meta, song.meta);
  const chart = sanitizeChart(result.doc.chart)!;
  const note = typeof body.transcript === 'string' ? body.transcript.replace(/\s+/g, ' ').trim().slice(0, MAX_TRANSCRIPT) : '';
  const saved = await saveSong(song, user, song.revision, meta, chart, { name: VOICE_AGENT, note: note.slice(0, 240) });
  if (!saved) return changed();
  return { revision: saved.revision, meta, chart };
});
