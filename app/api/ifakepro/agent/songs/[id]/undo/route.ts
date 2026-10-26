import { NextResponse } from 'next/server';
import { HttpError } from '@ifakepro/lib/session';
import { chartText } from '@ifakepro/lib/script';
import { getDb } from '../../../../db';
import { agentMark, agentMayEdit, agentUser, songUrl } from '../../../../agent';
import { findSong, handle, readBody, saveSong, upgrade } from '../../../../store';

/**
 * Put the song back as it was before the agent's last edit, as a new edit of
 * its own. Only while that edit is still the latest thing that happened to
 * the song: anything a person did since would be lost, so then it's a 409.
 */
export const POST = handle<{ id: string }>(async (req, { id }) => {
  const user = await agentUser(req);
  const song = await findSong(id);
  if (song.deleted_at) throw new HttpError(410, 'This song was deleted');
  await agentMayEdit(song.playlist_id, user);
  const body = await readBody(req).catch(() => ({}) as Record<string, unknown>);
  const [last, prev] = await getDb()`
    SELECT v.revision, v.agent, v.note, v.summary, v.meta, v.chart, u.name
    FROM ifp_versions v LEFT JOIN ifp_profiles u ON u.id = v.author_id
    WHERE v.song_id = ${id} ORDER BY v.created_at DESC LIMIT 2`;
  const refuse = (message: string) => NextResponse.json({ error: 'cannot-undo', message }, { status: 409 });
  if (!last?.agent) return refuse(`The last change to this song was ${last?.name ?? 'someone'}’s, not yours, so there’s nothing of yours to undo.`);
  if (last.revision !== song.revision) return refuse('The song was edited after your last change; undoing it now would lose that. Make the change back with ops instead.');
  if (!prev) return refuse('There’s no earlier version to go back to.');
  const what = last.note || last.summary || 'the last edit';
  const saved = await saveSong(song, user, song.revision, prev.meta, upgrade(prev.chart), { ...agentMark(body), note: `Undid ‘${what}’` });
  if (!saved) return refuse('Someone saved this song a moment ago. Read it again.');
  return { revision: saved.revision, versionId: saved.versionId, undid: what, text: chartText({ meta: prev.meta, chart: upgrade(prev.chart) }), url: songUrl(req, song.slug, id) };
});
