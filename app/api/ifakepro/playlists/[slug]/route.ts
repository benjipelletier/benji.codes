import { getSessionUser, requireRole, HttpError } from '@ifakepro/lib/session';
import { getDb } from '../../db';
import { findPlaylist, handle, logActivity, newToken, playlistDetail, readBody } from '../../store';

type P = { slug: string };

/** ?full=1 adds every song's chart, for setlist mode and printing. */
export const GET = handle<P>(async (req, { slug }) => {
  return playlistDetail(slug, await getSessionUser(), req.nextUrl.searchParams.get('full') === '1');
});

/**
 * Editors: { title?, description? }.
 * Owner: { visibility?, rotateToken?: true, removeMember?: userId }.
 */
export const PATCH = handle<P>(async (req, { slug }) => {
  const p = await findPlaylist(slug);
  const body = await readBody(req);
  const ownerOnly = body.visibility !== undefined || body.rotateToken || body.removeMember;
  const user = await requireRole(p.id, ownerOnly ? 'owner' : 'editor');
  const sql = getDb();
  if (typeof body.title === 'string' && body.title.trim() && body.title.trim() !== p.title) {
    const title = body.title.trim().slice(0, 120);
    await sql`UPDATE ifp_playlists SET title = ${title}, updated_at = now() WHERE id = ${p.id}`;
    await logActivity(p.id, null, user.id, 'playlist.update', `Renamed the playlist to “${title}”`);
  }
  if (typeof body.description === 'string' && body.description !== p.description) {
    await sql`UPDATE ifp_playlists SET description = ${body.description.slice(0, 2000)}, updated_at = now() WHERE id = ${p.id}`;
  }
  if (body.visibility === 'public' || body.visibility === 'unlisted') {
    await sql`UPDATE ifp_playlists SET visibility = ${body.visibility} WHERE id = ${p.id}`;
  }
  if (body.rotateToken === true) {
    await sql`UPDATE ifp_playlists SET edit_token = ${newToken()} WHERE id = ${p.id}`;
  }
  if (typeof body.removeMember === 'string') {
    if (body.removeMember === p.owner_id) throw new HttpError(400, 'The owner can’t be removed');
    await sql`DELETE FROM ifp_members WHERE playlist_id = ${p.id} AND user_id = ${body.removeMember}`;
  }
  return playlistDetail(slug, user);
});

export const DELETE = handle<P>(async (_req, { slug }) => {
  const p = await findPlaylist(slug);
  await requireRole(p.id, 'owner');
  await getDb()`UPDATE ifp_playlists SET deleted_at = now() WHERE id = ${p.id}`;
  return { ok: true };
});
