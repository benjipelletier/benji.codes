import 'server-only';
import { createNeonAuth } from '@neondatabase/auth/next/server';

/**
 * Site-wide Neon Auth (Better Auth) server instance.
 *
 * There is one auth mount for the whole site at /api/auth/[...path], so there
 * must be one instance behind it — a second instance would mint cookies the
 * first can't verify. Projects share the session and each decide separately
 * who counts as their owner (see longku/lib/session.ts, jazz/lib/session-user.ts).
 *
 * Env vars keep the JAZZ_ names as a fallback because that is what the existing
 * Neon ↔ Vercel integration injects; the unprefixed names are preferred for new
 * deploys now that this is shared infrastructure.
 */
export const auth = createNeonAuth({
  baseUrl: (process.env.NEON_AUTH_BASE_URL ?? process.env.JAZZ_NEON_AUTH_BASE_URL)!,
  cookies: {
    secret: (process.env.NEON_AUTH_COOKIE_SECRET ??
      process.env.JAZZ_NEON_AUTH_COOKIE_SECRET)!,
    // OAuth redirects from Google → Neon Auth → our app are cross-site top-level
    // navigations. SameSite=Strict (the SDK default) drops the cookie at the
    // last hop, so the session never lands. 'lax' is the standard for OAuth.
    sameSite: 'lax',
  },
});
