import { getSessionUser, roleIn } from '@ifakepro/lib/session';
import type { PollResult } from '@ifakepro/lib/types';
import { getDb } from '../../../db';
import { commentsStamp, handle, isUuid, person, upgrade } from '../../../store';
import { HttpError } from '@ifakepro/lib/session';

const PRESENCE_SECONDS = 20;

/**
 * ?rev=N&bar=<barId>&editing=1. Polled every few seconds by an open song:
 * the song if it has moved past revision N, who else has it open (and where),
 * and a stamp that changes when its comments do. Marks the caller as present.
 */
export const GET = handle<{ id: string }>(async (req, { id }): Promise<PollResult> => {
  if (!isUuid(id)) throw new HttpError(404, 'No such song');
  const sp = req.nextUrl.searchParams;
  const rev = Number(sp.get('rev') ?? 0);
  const bar = sp.get('bar')?.slice(0, 32) || null;
  const editing = sp.get('editing') === '1';
  const user = await getSessionUser();
  const sql = getDb();
  const s = (await sql`
    SELECT s.revision, s.playlist_id, s.deleted_at, u.name, u.image, s.updated_by, s.updated_agent,
      CASE WHEN s.revision > ${rev} THEN s.meta END AS meta,
      CASE WHEN s.revision > ${rev} THEN s.chart END AS chart
    FROM ifp_songs s LEFT JOIN ifp_profiles u ON u.id = s.updated_by WHERE s.id = ${id}`)[0];
  if (!s) throw new HttpError(404, 'No such song');
  if (user && (await roleIn(s.playlist_id, user))) {
    await sql`
      INSERT INTO ifp_presence (song_id, user_id, bar_id, editing, seen_at) VALUES (${id}, ${user.id}, ${bar}, ${editing}, now())
      ON CONFLICT (song_id, user_id) DO UPDATE SET bar_id = EXCLUDED.bar_id, editing = EXCLUDED.editing, seen_at = now()`;
  }
  const present = await sql`
    SELECT p.user_id, p.bar_id, p.editing, u.name, u.image FROM ifp_presence p LEFT JOIN ifp_profiles u ON u.id = p.user_id
    WHERE p.song_id = ${id} AND p.seen_at > now() - make_interval(secs => ${PRESENCE_SECONDS}) AND p.user_id <> ${user?.id ?? ''}
    ORDER BY p.seen_at`;
  return {
    revision: s.revision,
    song: s.meta ? { id, meta: s.meta, chart: upgrade(s.chart), revision: s.revision, updatedBy: person(s.updated_by, s.name, s.image), agent: s.updated_agent ?? null } : null,
    presence: present.map((p) => ({ user: person(p.user_id, p.name, p.image), barId: p.bar_id, editing: p.editing })),
    commentsStamp: await commentsStamp(id),
    deleted: !!s.deleted_at,
  };
});
