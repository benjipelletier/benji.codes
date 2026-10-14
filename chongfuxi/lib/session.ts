import "server-only";
import { auth } from "@/lib/auth";

export interface Viewer {
  /** The signed-in account, if any — regardless of ownership. */
  email: string | null;
  /** True only for the one account whose log this is. */
  isOwner: boolean;
}

/**
 * Whose log the server keeps. CHONGFUXI_OWNER_EMAIL when set; otherwise the
 * owner the site's other projects name, since the site has one owner and this
 * spares another variable to keep in step. (Both are tried because neither is
 * set everywhere: 龙库's is missing from preview deployments.) With none set
 * nobody is the owner and nothing is stored.
 */
export function ownerEmail(): string | null {
  return (
    process.env.CHONGFUXI_OWNER_EMAIL || process.env.LONGKU_OWNER_EMAIL || process.env.JAZZ_OWNER_EMAIL || null
  );
}

/**
 * Who is asking.
 *
 * The session is the site-wide one (lib/auth.ts). Anyone can complete the
 * OAuth flow and hold a valid cookie, so signed-in is not the same as allowed:
 * ownership is decided here, by email, and nowhere else. As with 龙库, everyone
 * else is a spectator: they read the owner's log and can change nothing.
 */
export async function getViewer(): Promise<Viewer> {
  try {
    const { data } = await auth.getSession();
    const email = data?.user?.email ?? null;
    const owner = ownerEmail();
    return { email, isOwner: Boolean(owner && email && email === owner) };
  } catch {
    // A malformed or expired cookie is a visitor, not an error.
    return { email: null, isOwner: false };
  }
}
