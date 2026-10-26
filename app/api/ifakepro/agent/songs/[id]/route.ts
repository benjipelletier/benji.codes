import { NextResponse } from 'next/server';
import { HttpError } from '@ifakepro/lib/session';
import { sanitizeChart, sanitizeMeta } from '@ifakepro/lib/chart';
import { summarize } from '@ifakepro/lib/diff';
import { applyOps, changes, chartText } from '@ifakepro/lib/script';
import { agentFor, agentMark, agentMayEdit, agentSong, songUrl } from '../../../agent';
import { findSong, handle, listVersions, readBody, saveSong } from '../../../store';

type P = { id: string };

/** A song as the agent reads it, with its last few versions. */
export const GET = handle<P>(async (req, { id }) => {
  await agentFor(req);
  const song = await findSong(id);
  const history = (await listVersions(id)).slice(0, 5).map((v) => ({
    at: v.createdAt,
    by: v.author.name,
    agent: v.agent,
    note: v.note,
    summary: v.summary,
  }));
  return { ...agentSong(req, song), deleted: !!song.deleted_at, history };
});

/**
 * { revision, note, ops, dryRun?, agent? }: apply the ops (lib/script.ts) to
 * the song as it was at `revision`, all or none, and save it as the person
 * the agent acts for, marked as the agent's.
 */
export const POST = handle<P>(async (req, { id }) => {
  const agent = await agentFor(req);
  const { user } = agent;
  const song = await findSong(id);
  if (song.deleted_at) throw new HttpError(410, 'This song was deleted');
  await agentMayEdit(song.playlist_id, user);
  const body = await readBody(req);
  if (typeof body.revision !== 'number') throw new HttpError(400, 'revision is required: the revision of the song you read (GET this song first)');
  const stale = () =>
    NextResponse.json(
      {
        error: 'changed',
        message: `The song changed after revision ${body.revision} (it’s at ${song.revision} now). Read it again (the song is below) and redo the request against the new bar numbers.`,
        song: agentSong(req, song),
      },
      { status: 409 },
    );
  if (body.revision !== song.revision) return stale();

  const before = { meta: song.meta, chart: song.chart };
  const result = applyOps(before, body.ops);
  if ('errors' in result) return NextResponse.json({ error: 'refused', message: 'Nothing was changed.', errors: result.errors }, { status: 422 });
  const after = { meta: sanitizeMeta(result.doc.meta, song.meta), chart: sanitizeChart(result.doc.chart)! };
  const out = { summary: summarize(before, after), ...changes(before, after), text: chartText(after) };
  if (body.dryRun === true) return { dryRun: true, revision: song.revision, ...out };

  const saved = await saveSong(song, user, song.revision, after.meta, after.chart, agentMark(agent, body));
  if (!saved) {
    const now = await findSong(id);
    return NextResponse.json(
      { error: 'changed', message: 'Someone saved this song a moment ago. Read it again and redo the request.', song: agentSong(req, now) },
      { status: 409 },
    );
  }
  return { revision: saved.revision, versionId: saved.versionId, ...out, url: songUrl(req, song.slug, id) };
});
