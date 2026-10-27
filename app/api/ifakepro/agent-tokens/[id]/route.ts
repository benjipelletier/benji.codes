import { HttpError, requireUser } from '@ifakepro/lib/session';
import { getDb } from '../../db';
import { handle, isUuid } from '../../store';

/** Revoke one of your own agent tokens: the agent using it is shut out at once. */
export const DELETE = handle<{ id: string }>(async (_req, { id }) => {
  const user = await requireUser();
  if (!isUuid(id)) throw new HttpError(404, 'No such token');
  const rows = await getDb()`
    UPDATE ifp_agent_tokens SET revoked_at = now()
    WHERE id = ${id} AND user_id = ${user.id} AND revoked_at IS NULL RETURNING id`;
  if (!rows.length) throw new HttpError(404, 'No such token');
  return { ok: true };
});
