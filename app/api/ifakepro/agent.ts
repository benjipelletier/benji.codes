import 'server-only';
// The owner's agent (Muse) edits charts for the owner, through a token only
// it holds (IFAKEPRO_AGENT_TOKEN, `Authorization: Bearer <token>`), the way it
// writes word lists in 重复习 (app/api/chongfuxi/agent.ts). It acts as one
// person, IFAKEPRO_AGENT_EMAIL (or else the first IFAKEPRO_ADMIN_EMAILS), so
// it can do what they can and its edits are theirs, marked with its name: a
// "Muse" pill beside them in the history and the edit log.

import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { HttpError, type SessionUser, roleIn } from '@ifakepro/lib/session';
import { agentBars, chartText } from '@ifakepro/lib/script';
import { getDb } from './db';
import type { AgentMark } from './store';

/** The token as set on the server (a stray space or newline trimmed), or null when unset or too short to trust. */
function agentToken(): string | null {
  const want = process.env.IFAKEPRO_AGENT_TOKEN?.trim();
  return want && want.length >= 32 ? want : null;
}

/**
 * The person the agent acts for, after checking its token. Unset (or under
 * 32 characters) on the server is a 503, so a refused token (401) can be told
 * from a missing one.
 */
export async function agentUser(req: NextRequest): Promise<SessionUser> {
  const want = agentToken();
  if (!want) throw new HttpError(503, 'agent token not set on the server (IFAKEPRO_AGENT_TOKEN, 32+ characters)');
  const got = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  if (!got || got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) throw new HttpError(401, 'not allowed');
  const email = (process.env.IFAKEPRO_AGENT_EMAIL ?? process.env.IFAKEPRO_ADMIN_EMAILS ?? '').split(',')[0].trim().toLowerCase();
  if (!email) throw new HttpError(503, 'set IFAKEPRO_AGENT_EMAIL (or IFAKEPRO_ADMIN_EMAILS) to the person the agent acts for');
  const rows = await getDb()`SELECT id, email, name, image FROM ifp_profiles WHERE lower(email) = ${email} ORDER BY seen_at DESC LIMIT 1`;
  if (!rows[0]) throw new HttpError(503, `${email} has never signed in to iFake Pro; sign in once so the agent can act as you`);
  return { id: rows[0].id, email: rows[0].email, name: rows[0].name || email.split('@')[0], image: rows[0].image ?? null };
}

/** The agent may change a playlist only if the person it acts for may. */
export async function agentMayEdit(playlistId: string, user: SessionUser) {
  if (!(await roleIn(playlistId, user))) throw new HttpError(403, `${user.email} can’t edit this playlist`);
}

/** Its name and note from a request: { agent?: "Muse", note: "what was asked" }. */
export function agentMark(body: Record<string, unknown>): AgentMark {
  const name = typeof body.agent === 'string' && body.agent.trim() ? body.agent.trim().slice(0, 24) : 'Muse';
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
