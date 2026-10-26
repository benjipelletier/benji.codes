import { getSessionUser, requireAdmin, HttpError } from '@ifakepro/lib/session';
import { createPlaylist, handle, insertSongs, listPlaylists, readBody } from '../store';
import { songsToAdd } from '../adding';

export const runtime = 'nodejs';

export const GET = handle(async () => ({ playlists: await listPlaylists(await getSessionUser()) }));

/** { title, description?, visibility?, ...songs to start with (see songsToAdd) } */
export const POST = handle(async (req) => {
  const user = await requireAdmin();
  const body = await readBody(req);
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 120) : '';
  if (!title) throw new HttpError(400, 'A playlist needs a title');
  const add = songsToAdd(body);
  const { id, slug } = await createPlaylist(user, {
    title,
    description: typeof body.description === 'string' ? body.description.slice(0, 2000) : '',
    visibility: body.visibility === 'unlisted' ? 'unlisted' : 'public',
  });
  if (add) await insertSongs(id, user, add.songs, add.kind, add.versionSummary, add.activity);
  return { slug };
});
