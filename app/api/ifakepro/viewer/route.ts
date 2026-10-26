import { getSessionUser, isAdmin } from '@ifakepro/lib/session';
import type { Viewer } from '@ifakepro/lib/types';
import { handle } from '../store';

export const GET = handle(async (): Promise<Viewer> => {
  const user = await getSessionUser();
  return {
    user: user ? { id: user.id, email: user.email, name: user.name, image: user.image } : null,
    isAdmin: isAdmin(user),
  };
});
