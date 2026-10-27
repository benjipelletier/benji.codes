import { getSessionUser } from '@ifakepro/lib/session';
import { findPlaylist, handle, isUuid, listActivity } from '../store';

/** The edit log. ?playlist=<slug> &song=<id> &actor=<userId> &before=<iso time> &limit= */
export const GET = handle(async (req) => {
  const sp = req.nextUrl.searchParams;
  const user = await getSessionUser();
  const slug = sp.get('playlist');
  const song = sp.get('song');
  const before = sp.get('before');
  return {
    activity: await listActivity(user, {
      playlistId: slug ? (await findPlaylist(slug)).id : undefined,
      songId: song && isUuid(song) ? song : undefined,
      actorId: sp.get('actor') || undefined,
      before: before && !Number.isNaN(Date.parse(before)) ? before : undefined,
      limit: Number(sp.get('limit')) || 50,
    }),
  };
});
