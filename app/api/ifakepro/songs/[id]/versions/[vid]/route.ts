import { requireRole, HttpError } from '@ifakepro/lib/session';
import { getDb } from '../../../../db';
import { findSong, getVersion, handle, readBody, restoreVersion } from '../../../../store';

type P = { id: string; vid: string };

export const GET = handle<P>(async (_req, { id, vid }) => {
  const song = await findSong(id);
  return getVersion(song.id, vid);
});

/** { label }: name a version (empty string clears it). Named versions don't fold in later saves. */
export const PATCH = handle<P>(async (req, { id, vid }) => {
  const song = await findSong(id);
  await requireRole(song.playlist_id, 'editor');
  await getVersion(song.id, vid);
  const { label } = await readBody(req);
  if (typeof label !== 'string') throw new HttpError(400, 'label is required');
  const clean = label.trim().slice(0, 80) || null;
  await getDb()`UPDATE ifp_versions SET label = ${clean} WHERE id = ${vid}`;
  return getVersion(song.id, vid);
});

/** { action: "restore" } */
export const POST = handle<P>(async (req, { id, vid }) => {
  const song = await findSong(id);
  const user = await requireRole(song.playlist_id, 'editor');
  const { action } = await readBody(req);
  if (action !== 'restore') throw new HttpError(400, 'Unknown action');
  return { revision: await restoreVersion(song, user, vid) };
});
