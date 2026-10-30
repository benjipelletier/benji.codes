import { NextResponse } from 'next/server';
import { HttpError, requireRole } from '@ifakepro/lib/session';
import { findSong, handle, person, readBody } from '../../../store';
import { MAX_TRANSCRIPT, readSpeech, voiceBudget } from '../../../voice';

type P = { id: string };

/**
 * { revision, transcript, final? }: what someone has said so far, read
 * against the song as it was at `revision`. Answers with the bars it's about,
 * the edits and the chart with them, for the page to preview; saves nothing
 * (voice/apply does). Editors only: every call is a model call.
 */
export const POST = handle<P>(async (req, { id }) => {
  const song = await findSong(id);
  const user = await requireRole(song.playlist_id, 'editor');
  if (song.deleted_at) throw new HttpError(410, 'This song was deleted');
  const body = await readBody(req);
  if (typeof body.revision !== 'number') throw new HttpError(400, 'revision is required');
  if (body.revision !== song.revision)
    return NextResponse.json(
      { error: 'changed', song: { id, meta: song.meta, chart: song.chart, revision: song.revision, updatedBy: person(song.updated_by, song.name, song.image) } },
      { status: 409 },
    );
  const transcript = typeof body.transcript === 'string' ? body.transcript.replace(/\s+/g, ' ').trim().slice(0, MAX_TRANSCRIPT) : '';
  if (!transcript) return { heard: '', focus: [], ops: [], summary: [], unfinished: true, errors: [], preview: null, changes: null };
  voiceBudget(user.id);
  return readSpeech({ meta: song.meta, chart: song.chart }, transcript, body.final === true);
});
