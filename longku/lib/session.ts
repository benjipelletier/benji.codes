import "server-only";
import { auth } from "@/lib/auth";

export interface Viewer {
  /** The signed-in account, if any — regardless of ownership. */
  email: string | null;
  /** True only for the single account allowed to modify the bank. */
  isOwner: boolean;
}

/**
 * Who is asking.
 *
 * Single-tenant by design: 龙库 holds one person's corpus, and everyone else is
 * a spectator. Anyone can complete the OAuth flow and be handed a valid session
 * cookie, so signed-in is not the same as allowed — ownership is decided here,
 * by email, and nowhere else.
 *
 * Fails closed: with LONGKU_OWNER_EMAIL unset nobody is the owner, so a
 * misconfigured deploy is read-only rather than wide open.
 */
export async function getViewer(): Promise<Viewer> {
  try {
    const { data } = await auth.getSession();
    const email = data?.user?.email ?? null;
    const owner = process.env.LONGKU_OWNER_EMAIL;
    return { email, isOwner: Boolean(owner && email && email === owner) };
  } catch {
    // A malformed or expired cookie is a spectator, not an error.
    return { email: null, isOwner: false };
  }
}

/** Throws a 403-shaped marker unless the caller owns the bank. */
export class NotOwnerError extends Error {
  constructor() {
    super("Only the owner can modify this bank");
    this.name = "NotOwnerError";
  }
}

export async function requireOwner(): Promise<void> {
  const { isOwner } = await getViewer();
  if (!isOwner) throw new NotOwnerError();
}
