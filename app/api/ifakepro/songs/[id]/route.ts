import { NextResponse } from 'next/server';
import { getSessionUser, requireRole, HttpError } from '@ifakepro/lib/session';
import { sanitizeChart, sanitizeMeta } from '@ifakepro/lib/chart';
import { getDb } from '../../db';
import { findPlaylist, findSong, handle, insertSongs, logActivity, person, readBody, saveSong, songDetail } from '../../store';

type P = { id: string };

export const GET = handle<P>(async (_req, { id }) => songDetail(id, await getSessionUser()));

/**
 * Save: { baseRevision, meta, chart }. Lands only if baseRevision is still
 * current; otherwise 409 with the song as it is now, for the editor to merge.
 * Or { deleted: false } to bring back a deleted song.
 */
export const PATCH = handle<P>(async (req, { id }) => {
  const song = await findSong(id);
  const user = await requireRole(song.playlist_id, 'editor');
  const body = await readBody(req);
  if (body.deleted === false) {
    await getDb()`UPDATE ifp_songs SET deleted_at = NULL WHERE id = ${id}`;
    await logActivity(song.playlist_id, id, user.id, 'song.undelete', `Brought back “${song.meta.title}”`);
    return { ok: true };
  }
  if (song.deleted_at) throw new HttpError(410, 'This song was deleted');
  const chart = sanitizeChart(body.chart);
  if (!chart || typeof body.baseRevision !== 'number') throw new HttpError(400, 'Send baseRevision, meta and chart');
  const meta = sanitizeMeta(body.meta, song.meta);
  const saved = await saveSong(song, user, body.baseRevision, meta, chart);
  if (saved == null) {
    const now = await findSong(id);
    return NextResponse.json(
      {
        error: 'conflict',
        song: { id, meta: now.meta, chart: now.chart, revision: now.revision, updatedBy: person(now.updated_by, now.name, now.image) },
      },
      { status: 409 },
    );
  }
  return { revision: saved.revision };
});

export const DELETE = handle<P>(async (_req, { id }) => {
  const song = await findSong(id);
  const user = await requireRole(song.playlist_id, 'editor');
  await getDb()`UPDATE ifp_songs SET deleted_at = now() WHERE id = ${id} AND deleted_at IS NULL`;
  await logActivity(song.playlist_id, id, user.id, 'song.delete', `Deleted “${song.meta.title}”`);
  return { ok: true };
});

/** { copyTo: playlistSlug }: copy the song into another playlist you can edit. */
export const POST = handle<P>(async (req, { id }) => {
  const song = await findSong(id);
  const { copyTo } = await readBody(req);
  if (typeof copyTo !== 'string') throw new HttpError(400, 'copyTo is required');
  const target = await findPlaylist(copyTo);
  const user = await requireRole(target.id, 'editor');
  const [newId] = await insertSongs(target.id, user, [{ meta: song.meta, chart: song.chart }], 'copy', `Copied from “${song.ptitle}”`, {
    kind: 'song.copy',
    summary: `Copied “${song.meta.title}” from “${song.ptitle}”`,
  });
  return { id: newId, slug: target.slug };
});
