// Next.js 16 proxy (formerly middleware). Neon Auth's `auth.middleware()`
// handles the OAuth verifier → session cookie exchange after the Google
// callback redirects back to our app. But by default it ALSO redirects
// unauthenticated visitors to a sign-in page on every protected route, which
// would break spectator mode (we want unauthenticated users to browse).
//
// So we only run Neon's middleware when the verifier query param is present —
// exactly the case where we need it to set the cookie and redirect to a clean
// URL. All other requests pass straight through.
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

const neonMiddleware = auth.middleware();

export default async function proxy(request: NextRequest) {
  if (request.nextUrl.searchParams.has('neon_auth_session_verifier')) {
    return neonMiddleware(request);
  }
  return NextResponse.next();
}

export const config = {
  // Every user-facing route, not a per-project list. The matcher used to name
  // /jazz only, so signing in from anywhere else left the verifier sitting in
  // the URL with nothing to exchange it — sign-in appeared to do nothing, and
  // the only way in was to detour through /jazz. Auth is site-wide, so the
  // exchange has to be too; the guard above keeps every other request to a
  // single searchParams check.
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico).*)'],
};
