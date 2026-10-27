import { HttpError, requireUser } from '@ifakepro/lib/session';
import type { AgentToken } from '@ifakepro/lib/types';
import { getDb } from '../db';
import { DEFAULT_AGENT_NAME, newAgentToken } from '../agent';
import { handle, readBody } from '../store';

/** Live tokens a person may have at once. */
const MAX_TOKENS = 10;

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : d == null ? null : String(d));
const toToken = (r: Row): AgentToken => ({ id: r.id, name: r.name, prefix: r.prefix, createdAt: iso(r.created_at)!, lastUsedAt: iso(r.last_used_at) });

/** The signed-in person's agent tokens (never the tokens themselves: only their start). */
export const GET = handle(async () => {
  const user = await requireUser();
  const rows = await getDb()`
    SELECT id, name, prefix, created_at, last_used_at FROM ifp_agent_tokens
    WHERE user_id = ${user.id} AND revoked_at IS NULL ORDER BY created_at DESC`;
  return { tokens: rows.map(toToken) };
});

/** { name? }: a new token for the person's agent, shown this once. */
export const POST = handle(async (req) => {
  const user = await requireUser();
  const body = await readBody(req);
  const name = (typeof body.name === 'string' ? body.name.replace(/\s+/g, ' ').trim() : '').slice(0, 24) || DEFAULT_AGENT_NAME;
  const sql = getDb();
  const live = await sql`SELECT count(*)::int AS n FROM ifp_agent_tokens WHERE user_id = ${user.id} AND revoked_at IS NULL`;
  if (live[0].n >= MAX_TOKENS) throw new HttpError(400, `You have ${MAX_TOKENS} agent tokens already; revoke one first`);
  const t = newAgentToken();
  const rows = await sql`
    INSERT INTO ifp_agent_tokens (user_id, name, token_hash, prefix) VALUES (${user.id}, ${name}, ${t.hash}, ${t.prefix})
    RETURNING id, name, prefix, created_at, last_used_at`;
  return { ...toToken(rows[0]), token: t.token };
});
