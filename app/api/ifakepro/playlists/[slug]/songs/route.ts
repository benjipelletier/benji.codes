import { requireRole, HttpError } from '@ifakepro/lib/session';
import { getDb } from '../../../db';
import { findPlaylist, foldActivity, handle, insertSongs, isUuid, readBody } from '../../../store';
import { songsToAdd } from '../../../adding';

export const runtime = 'nodejs';
type P = { slug: string };

/** Add songs: see songsToAdd for the body. */
export const POST = handle<P>(async (req, { slug }) => {
  const p = await findPlaylist(slug);
  const user = await requireRole(p.id, 'editor');
  const add = songsToAdd(await readBody(req));
  if (!add) throw new HttpError(400, 'Nothing to add');
  const ids = await insertSongs(p.id, user, add.songs, add.kind, add.versionSummary, add.activity);
  return { ids };
});

/** { order: [songId, …] }: the playlist's new running order. */
export const PATCH = handle<P>(async (req, { slug }) => {
  const p = await findPlaylist(slug);
  const user = await requireRole(p.id, 'editor');
  const { order } = await readBody(req);
  if (!Array.isArray(order) || !order.every(isUuid)) throw new HttpError(400, 'order must be a list of song ids');
  await getDb().query(
    `UPDATE ifp_songs s SET position = t.ord FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, ord)
     WHERE s.id = t.id AND s.playlist_id = $2`,
    [order, p.id],
  );
  await foldActivity(p.id, null, user.id, 'playlist.reorder', 'Reordered the songs');
  return { ok: true };
});
