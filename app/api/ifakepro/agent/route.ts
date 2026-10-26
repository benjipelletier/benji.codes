import { getDb } from '../db';
import { agentFor } from '../agent';
import { handle, listPlaylists } from '../store';
import { AGENT_BRIEF } from '@ifakepro/lib/brief';

/**
 * For someone's AI agent: how to read and edit charts (brief), and the
 * playlists the person it acts for can edit, with their songs. ?q= keeps the
 * songs (or playlists) whose title has it.
 */
export const GET = handle(async (req) => {
  const agent = await agentFor(req);
  const { user } = agent;
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().toLowerCase();
  const playlists = (await listPlaylists(user)).filter((p) => p.role);
  const rows = playlists.length
    ? await getDb().query(
        `SELECT s.id, s.playlist_id, s.meta, s.revision, jsonb_array_length(s.chart->'bars') AS bars
         FROM ifp_songs s WHERE s.playlist_id = ANY($1::uuid[]) AND s.deleted_at IS NULL ORDER BY s.position`,
        [playlists.map((p) => p.id)],
      )
    : [];
  const origin = req.nextUrl.origin;
  return {
    brief: AGENT_BRIEF,
    actingFor: { name: user.name, email: user.email },
    agent: agent.name,
    playlists: playlists
      .map((p) => {
        const songs = rows
          .filter((s) => s.playlist_id === p.id)
          .filter((s) => !q || p.title.toLowerCase().includes(q) || String(s.meta?.title ?? '').toLowerCase().includes(q))
          .map((s) => ({
            id: s.id,
            title: s.meta?.title ?? 'Untitled',
            key: String(s.meta?.key ?? '').replace(/-$/, 'm'),
            bars: s.bars ?? 0,
            revision: s.revision,
            url: `${origin}/ifakepro/p/${p.slug}/s/${s.id}`,
          }));
        return { slug: p.slug, title: p.title, url: `${origin}/ifakepro/p/${p.slug}`, songs };
      })
      .filter((p) => !q || p.songs.length),
  };
});
