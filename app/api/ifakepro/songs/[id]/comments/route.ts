import { requireRole, HttpError } from '@ifakepro/lib/session';
import { getDb } from '../../../db';
import { findSong, handle, isUuid, listComments, logActivity, readBody } from '../../../store';

type P = { id: string };

export const GET = handle<P>(async (_req, { id }) => {
  const song = await findSong(id);
  return { comments: await listComments(song.id) };
});

/** { body, barId?, parentId? }: a new thread on a bar (or the song), or a reply. */
export const POST = handle<P>(async (req, { id }) => {
  const song = await findSong(id);
  const user = await requireRole(song.playlist_id, 'editor');
  const b = await readBody(req);
  const body = typeof b.body === 'string' ? b.body.trim().slice(0, 4000) : '';
  if (!body) throw new HttpError(400, 'Write something first');
  const sql = getDb();
  let barId = typeof b.barId === 'string' ? b.barId.slice(0, 32) : null;
  let parentId: string | null = null;
  if (b.parentId != null) {
    if (!isUuid(b.parentId)) throw new HttpError(400, 'Bad parentId');
    const parent = (await sql`SELECT id, bar_id, parent_id FROM ifp_comments WHERE id = ${b.parentId} AND song_id = ${id}`)[0];
    if (!parent) throw new HttpError(404, 'No such thread');
    parentId = parent.parent_id ?? parent.id;
    barId = parent.bar_id;
    // A reply reopens a resolved thread.
    await sql`UPDATE ifp_comments SET resolved_at = NULL, resolved_by = NULL, updated_at = now() WHERE id = ${parentId} AND resolved_at IS NOT NULL`;
  }
  const row = (await sql`
    INSERT INTO ifp_comments (song_id, bar_id, parent_id, body, author_id)
    VALUES (${id}, ${barId}, ${parentId}, ${body}, ${user.id}) RETURNING id`)[0];
  const barNo = barId ? (song.chart.bars as { id: string }[]).findIndex((x) => x.id === barId) + 1 : 0;
  const where = barNo > 0 ? ` on bar ${barNo}` : '';
  const excerpt = body.length > 80 ? `${body.slice(0, 77)}…` : body;
  await logActivity(song.playlist_id, id, user.id, parentId ? 'comment.reply' : 'comment.add', `${parentId ? 'Replied' : 'Commented'}${where}: “${excerpt}”`, {
    commentId: row.id,
    barId,
  });
  return { id: row.id, comments: await listComments(id) };
});
