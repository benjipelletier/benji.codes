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
 * The base URL and the cookie secret are resolved together, as a pair, and
 * never merged across prefixes. They identify one Neon Auth project: pairing a
 * base URL from one project with a secret from another yields an instance that
 * redirects correctly and then fails to verify the cookie it gets back, which
 * looks like "sign-in silently does nothing". This environment has a stale
 * unprefixed NEON_AUTH_BASE_URL left over from a retired project and no
 * matching secret, so a prefix is only used when both halves are present.
 */
const CANDIDATES = [
  { baseUrl: process.env.NEON_AUTH_BASE_URL, secret: process.env.NEON_AUTH_COOKIE_SECRET },
  {
    baseUrl: process.env.JAZZ_NEON_AUTH_BASE_URL,
    secret: process.env.JAZZ_NEON_AUTH_COOKIE_SECRET,
  },
];

const config = CANDIDATES.find((c) => c.baseUrl && c.secret) ?? CANDIDATES[1];

export const auth = createNeonAuth({
  baseUrl: config.baseUrl!,
  cookies: {
    secret: config.secret!,
    // OAuth redirects from Google → Neon Auth → our app are cross-site top-level
    // navigations. SameSite=Strict (the SDK default) drops the cookie at the
    // last hop, so the session never lands. 'lax' is the standard for OAuth.
    sameSite: 'lax',
  },
});
