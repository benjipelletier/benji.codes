import { getDb } from '../../../db';
import { findPlaylist, handle } from '../../../store';
import { serializePlaylist } from '@ifakepro/lib/ireal';

/** The playlist as one irealb:// link. */
export const GET = handle<{ slug: string }>(async (_req, { slug }) => {
  const p = await findPlaylist(slug);
  const rows = await getDb()`SELECT meta, chart FROM ifp_songs WHERE playlist_id = ${p.id} AND deleted_at IS NULL ORDER BY position`;
  const songs = rows.map((r) => ({ meta: r.meta, chart: r.chart }));
  return { name: p.title, link: songs.length ? serializePlaylist(p.title, songs) : null };
});
