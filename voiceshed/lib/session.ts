import 'server-only';
import { auth } from '@/lib/auth';

export interface Viewer {
  /** The signed-in account, if any — owner or not. */
  email: string | null;
  /** True only for the one account whose practice this is. */
  isOwner: boolean;
}

/**
 * The owner's email: VOICESHED_OWNER_EMAIL, else the jazz app's owner (the
 * same person). Unset → nobody is the owner, so a misconfigured deploy is
 * read-only rather than open.
 */
export function ownerEmail(): string | null {
  return process.env.VOICESHED_OWNER_EMAIL || process.env.JAZZ_OWNER_EMAIL || null;
}

/**
 * Who is asking. Single-tenant: everyone but the owner is a spectator who
 * sees the owner's progress and practises on their own device only.
 * Answers, schedules and runs are stored under the owner's email.
 */
export async function getViewer(): Promise<Viewer> {
  try {
    const { data } = await auth.getSession();
    const email = data?.user?.email ?? null;
    const owner = ownerEmail();
    return { email, isOwner: Boolean(owner && email && email === owner) };
  } catch {
    // A malformed or expired cookie is a spectator, not an error.
    return { email: null, isOwner: false };
  }
}
