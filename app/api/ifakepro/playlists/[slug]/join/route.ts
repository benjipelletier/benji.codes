import { requireUser, HttpError } from '@ifakepro/lib/session';
import { getDb } from '../../../db';
import { findPlaylist, handle, logActivity, readBody, tokenMatches } from '../../../store';

/** { token } from the invite link: join as an editor. */
export const POST = handle<{ slug: string }>(async (req, { slug }) => {
  const user = await requireUser();
  const p = await findPlaylist(slug);
  const { token } = await readBody(req);
  if (!tokenMatches(token, p.edit_token)) throw new HttpError(403, 'This invite link has expired. Ask for a new one.');
  const rows = await getDb()`
    INSERT INTO ifp_members (playlist_id, user_id, role) VALUES (${p.id}, ${user.id}, 'editor')
    ON CONFLICT DO NOTHING RETURNING user_id`;
  if (rows.length) await logActivity(p.id, null, user.id, 'member.join', 'Joined the playlist');
  return { joined: rows.length > 0 };
});
