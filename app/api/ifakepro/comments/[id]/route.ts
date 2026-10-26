import { requireRole, HttpError } from '@ifakepro/lib/session';
import { getDb } from '../../db';
import { handle, isUuid, listComments, logActivity, readBody } from '../../store';

async function load(id: string) {
  if (!isUuid(id)) throw new HttpError(404, 'No such comment');
  const c = (await getDb()`
    SELECT c.*, s.playlist_id, s.chart FROM ifp_comments c JOIN ifp_songs s ON s.id = c.song_id
    WHERE c.id = ${id} AND c.deleted_at IS NULL`)[0];
  if (!c) throw new HttpError(404, 'No such comment');
  return c;
}

/** { body } to edit your own comment; { resolved: true|false } on a thread. */
export const PATCH = handle<{ id: string }>(async (req, { id }) => {
  const c = await load(id);
  const user = await requireRole(c.playlist_id, 'editor');
  const b = await readBody(req);
  const sql = getDb();
  if (typeof b.body === 'string') {
    if (c.author_id !== user.id) throw new HttpError(403, 'You can only edit your own comments');
    const body = b.body.trim().slice(0, 4000);
    if (!body) throw new HttpError(400, 'A comment can’t be empty');
    await sql`UPDATE ifp_comments SET body = ${body}, edited_at = now(), updated_at = now() WHERE id = ${id}`;
  }
  if (typeof b.resolved === 'boolean') {
    if (c.parent_id) throw new HttpError(400, 'Resolve the thread, not a reply');
    if (b.resolved) await sql`UPDATE ifp_comments SET resolved_at = now(), resolved_by = ${user.id}, updated_at = now() WHERE id = ${id}`;
    else await sql`UPDATE ifp_comments SET resolved_at = NULL, resolved_by = NULL, updated_at = now() WHERE id = ${id}`;
    if (b.resolved) {
      const barNo = c.bar_id ? (c.chart.bars as { id: string }[]).findIndex((x) => x.id === c.bar_id) + 1 : 0;
      await logActivity(c.playlist_id, c.song_id, user.id, 'comment.resolve', `Resolved a comment${barNo > 0 ? ` on bar ${barNo}` : ''}`, { commentId: id });
    }
  }
  return { comments: await listComments(c.song_id) };
});

/** Your own comment, or any comment if you own the playlist. Deleting a thread's first comment deletes the thread. */
export const DELETE = handle<{ id: string }>(async (_req, { id }) => {
  const c = await load(id);
  const user = await requireRole(c.playlist_id, 'editor');
  if (c.author_id !== user.id) await requireRole(c.playlist_id, 'owner');
  await getDb()`UPDATE ifp_comments SET deleted_at = now(), updated_at = now() WHERE id = ${id}`;
  return { comments: await listComments(c.song_id) };
});
