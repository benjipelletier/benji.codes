import { getSessionUser, isAdmin } from '@ifakepro/lib/session';
import { getDb } from '../db';
import { handle, person } from '../store';

/** ?q= search every song you can see, across playlists. Empty q lists the most recently edited. */
export const GET = handle(async (req) => {
  const user = await getSessionUser();
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().toLowerCase();
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const rows = await getDb().query(
    `SELECT s.id, s.meta, s.updated_at, s.updated_by, u.name, u.image, p.slug, p.title AS ptitle
     FROM ifp_songs s
     JOIN ifp_playlists p ON p.id = s.playlist_id AND p.deleted_at IS NULL
     LEFT JOIN ifp_profiles u ON u.id = s.updated_by
     WHERE s.deleted_at IS NULL
       AND (p.visibility = 'public' OR $1 OR EXISTS (SELECT 1 FROM ifp_members m WHERE m.playlist_id = p.id AND m.user_id = $2))
       AND ($3 = '' OR lower(s.meta->>'title') LIKE $4 OR lower(s.meta->>'composer') LIKE $4 OR lower(s.meta->>'style') LIKE $4)
     ORDER BY ${q ? "lower(s.meta->>'title')" : 's.updated_at DESC'} LIMIT 200`,
    [isAdmin(user), user?.id ?? '', q, like],
  );
  return {
    songs: rows.map((r) => ({
      id: r.id,
      meta: r.meta,
      updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
      updatedBy: person(r.updated_by, r.name, r.image),
      playlist: { slug: r.slug, title: r.ptitle },
    })),
  };
});
