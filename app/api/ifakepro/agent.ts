import 'server-only';
// People's agents (their "Muse") edit charts for them through a bearer token
// (`Authorization: Bearer <token>`), the way the owner's Muse writes word
// lists in 重复习 (app/api/chongfuxi/agent.ts). Two kinds of token:
//
//   ifp_…  one a person made for their own agent, in the app (ifp_agent_tokens).
//          The agent acts as them, with their playlists, under the name they gave it.
//   IFAKEPRO_AGENT_TOKEN  the owner's, set on the server. It acts as
//          IFAKEPRO_AGENT_EMAIL (or else the first IFAKEPRO_ADMIN_EMAILS).
//
// Either way the agent's edits are the person's, marked with the agent's name:
// a "✦ Muse" pill beside them in the history and the edit log.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { HttpError, type SessionUser, roleIn } from '@ifakepro/lib/session';
import { agentBars, chartText } from '@ifakepro/lib/script';
import { getDb } from './db';
import type { AgentMark } from './store';

/** The agent behind a request: the person it acts for, and its name when its token gives one. */
export interface Agent {
  user: SessionUser;
  name: string | null;
}

export const TOKEN_PREFIX = 'ifp_';

/** A new token for someone's agent: what to show them once, and what to keep. */
export function newAgentToken(): { token: string; hash: string; prefix: string } {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { token, hash: hashToken(token), prefix: token.slice(0, TOKEN_PREFIX.length + 4) };
}

/** Tokens are 256 random bits, so a plain SHA-256 is enough to keep them unreadable at rest. */
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** The owner's token as set on the server (a stray space or newline trimmed), or null when unset or too short to trust. */
function ownerToken(): string | null {
  const want = process.env.IFAKEPRO_AGENT_TOKEN?.trim();
  return want && want.length >= 32 ? want : null;
}

/** Who the request's agent acts for, from its token; 401 for a missing, unknown or revoked one. */
export async function agentFor(req: NextRequest): Promise<Agent> {
  const got = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  if (!got) throw new HttpError(401, 'send Authorization: Bearer <your agent token>');
  const sql = getDb();
  if (got.startsWith(TOKEN_PREFIX)) {
    const rows = await sql`
      UPDATE ifp_agent_tokens t SET last_used_at = now()
      FROM ifp_profiles p
      WHERE t.token_hash = ${hashToken(got)} AND t.revoked_at IS NULL AND p.id = t.user_id
      RETURNING t.name, p.id, p.email, p.name AS pname, p.image`;
    const r = rows[0];
    if (!r) throw new HttpError(401, 'this token isn’t valid (it may have been revoked)');
    return { user: { id: r.id, email: r.email, name: r.pname || r.email.split('@')[0], image: r.image ?? null }, name: r.name };
  }
  const want = ownerToken();
  if (!want || got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) throw new HttpError(401, 'not allowed');
  const email = (process.env.IFAKEPRO_AGENT_EMAIL ?? process.env.IFAKEPRO_ADMIN_EMAILS ?? '').split(',')[0].trim().toLowerCase();
  if (!email) throw new HttpError(503, 'set IFAKEPRO_AGENT_EMAIL (or IFAKEPRO_ADMIN_EMAILS) to the person the agent acts for');
  const rows = await sql`SELECT id, email, name, image FROM ifp_profiles WHERE lower(email) = ${email} ORDER BY seen_at DESC LIMIT 1`;
  if (!rows[0]) throw new HttpError(503, `${email} has never signed in to iFake Pro; sign in once so the agent can act as you`);
  return { user: { id: rows[0].id, email: rows[0].email, name: rows[0].name || email.split('@')[0], image: rows[0].image ?? null }, name: null };
}

/** The agent may change a playlist only if the person it acts for may. */
export async function agentMayEdit(playlistId: string, user: SessionUser) {
  if (!(await roleIn(playlistId, user))) throw new HttpError(403, `${user.email} can’t edit this playlist`);
}

/**
 * Its name and note: the name its token was given, else the request's
 * { agent?: "Muse" }; the note is { note: "what was asked" }.
 */
export function agentMark(agent: Agent, body: Record<string, unknown>): AgentMark {
  const asked = typeof body.agent === 'string' && body.agent.trim() ? body.agent.trim().slice(0, 24) : null;
  const name = agent.name ?? asked ?? 'Muse';
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 240) : '';
  return { name, note };
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
