import 'server-only';
// People's AI agents edit charts for them through a token they make in the
// app ("Your agent", ifp_agent_tokens), sent as `Authorization: Bearer <token>`.
// The agent acts as its person, with their playlists, and its edits are
// theirs, marked with the agent's name: an "✦ Agent" pill beside them in the
// history and the edit log.

import { createHash, randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { HttpError, type SessionUser, roleIn } from '@ifakepro/lib/session';
import { agentBars, chartText } from '@ifakepro/lib/script';
import { getDb } from './db';
import type { AgentMark } from './store';

/** The agent behind a request: the person it acts for, and the name its token was given. */
export interface Agent {
  user: SessionUser;
  name: string;
}

export const TOKEN_PREFIX = 'ifp_';

/** What an agent is called when its person doesn't name it. */
export const DEFAULT_AGENT_NAME = 'Agent';

/** A new token for someone's agent: what to show them once, and what to keep. */
export function newAgentToken(): { token: string; hash: string; prefix: string } {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { token, hash: hashToken(token), prefix: token.slice(0, TOKEN_PREFIX.length + 4) };
}

/** Tokens are 256 random bits, so a plain SHA-256 is enough to keep them unreadable at rest. */
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Who the request's agent acts for, from its token; 401 for a missing, unknown or revoked one. */
export async function agentFor(req: NextRequest): Promise<Agent> {
  const got = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  if (!got) throw new HttpError(401, 'send Authorization: Bearer <your agent token> (made in iFake Pro under “Your agent”)');
  const rows = got.startsWith(TOKEN_PREFIX)
    ? await getDb()`
        UPDATE ifp_agent_tokens t SET last_used_at = now()
        FROM ifp_profiles p
        WHERE t.token_hash = ${hashToken(got)} AND t.revoked_at IS NULL AND p.id = t.user_id
        RETURNING t.name, p.id, p.email, p.name AS pname, p.image`
    : [];
  const r = rows[0];
  if (!r) throw new HttpError(401, 'this token isn’t valid (it may have been revoked)');
  return { user: { id: r.id, email: r.email, name: r.pname || r.email.split('@')[0], image: r.image ?? null }, name: r.name };
}

/** The agent may change a playlist only if the person it acts for may. */
export async function agentMayEdit(playlistId: string, user: SessionUser) {
  if (!(await roleIn(playlistId, user))) throw new HttpError(403, `${user.email} can’t edit this playlist`);
}

/** Its name (the one its token was given) and its note: { note: "what was asked" }. */
export function agentMark(agent: Agent, body: Record<string, unknown>): AgentMark {
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 240) : '';
  return { name: agent.name, note };
}

export function songUrl(req: NextRequest, slug: string, id: string): string {
  return `${req.nextUrl.origin}/ifakepro/p/${slug}/s/${id}`;
}

/** A song as the agent reads it. */
export function agentSong(req: NextRequest, s: Record<string, any>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    id: s.id,
    playlist: { slug: s.slug, title: s.ptitle },
    url: songUrl(req, s.slug, s.id),
    revision: s.revision,
    meta: s.meta,
    text: chartText({ meta: s.meta, chart: s.chart }),
    bars: agentBars(s.chart),
  };
}
