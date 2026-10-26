import 'server-only';
import { cookies } from 'next/headers';
import { auth } from '@/lib/auth';
import { getDb } from '../../app/api/ifakepro/db';
import type { Role } from './types';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  image: string | null;
}

/** Thrown by the require* helpers; the routes turn it into a JSON error with this status. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const DEV_COOKIE = 'ifp_dev_user';

/**
 * Local development only: the ifp_dev_user cookie (an email) signs you in
 * without Google, so several people can be tried at once in separate
 * browsers. `next dev` is the only thing that sets NODE_ENV=development;
 * builds and Vercel run as production, where this is never read.
 */
async function devUser(): Promise<SessionUser | null> {
  if (process.env.NODE_ENV !== 'development') return null;
  const email = (await cookies()).get(DEV_COOKIE)?.value;
  if (!email) return null;
  const name = email.split('@')[0];
  return { id: `dev:${email}`, email, name: name[0].toUpperCase() + name.slice(1), image: null };
}

const upserted = new Map<string, number>();

/**
 * The signed-in person, or null for a guest. Anyone with a Google account can
 * sign in; what they may do is decided per playlist, by membership. A broken
 * or expired cookie is a guest, not an error.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  let user = await devUser();
  if (!user) {
    try {
      const { data } = await auth.getSession();
      const u = data?.user;
      if (u?.id && u.email) user = { id: u.id, email: u.email, name: u.name || u.email.split('@')[0], image: u.image ?? null };
    } catch {
      return null;
    }
  }
  if (!user) return null;
  // Copy the profile into this database so names and avatars can be joined on.
  const last = upserted.get(user.id) ?? 0;
  if (Date.now() - last > 5 * 60_000) {
    upserted.set(user.id, Date.now());
    await getDb()`
      INSERT INTO ifp_profiles (id, email, name, image) VALUES (${user.id}, ${user.email}, ${user.name}, ${user.image})
      ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, image = EXCLUDED.image, seen_at = now()
    `;
  }
  return user;
}

/** Emails allowed to create playlists. Unset means nobody: fails closed. */
export function isAdmin(user: SessionUser | null): boolean {
  if (!user) return false;
  const list = (process.env.IFAKEPRO_ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(user.email.toLowerCase());
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new HttpError(401, 'Sign in first');
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!isAdmin(user)) throw new HttpError(403, 'Only admins can create playlists');
  return user;
}

/** The user's role in a playlist. Admins can manage every playlist. */
export async function roleIn(playlistId: string, user: SessionUser | null): Promise<Role | null> {
  if (!user) return null;
  if (isAdmin(user)) return 'owner';
  const rows = await getDb()`SELECT role FROM ifp_members WHERE playlist_id = ${playlistId} AND user_id = ${user.id}`;
  return (rows[0]?.role as Role | undefined) ?? null;
}

export async function requireRole(playlistId: string, need: Role): Promise<SessionUser> {
  const user = await requireUser();
  const role = await roleIn(playlistId, user);
  if (!role) throw new HttpError(403, 'Join this playlist with its invite link to edit it');
  if (need === 'owner' && role !== 'owner') throw new HttpError(403, 'Only the playlist’s owner can do that');
  return user;
}
