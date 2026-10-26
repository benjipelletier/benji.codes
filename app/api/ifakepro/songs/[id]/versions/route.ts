import { findSong, handle, listVersions } from '../../../store';

export const GET = handle<{ id: string }>(async (_req, { id }) => {
  const song = await findSong(id);
  return { versions: await listVersions(song.id) };
});
