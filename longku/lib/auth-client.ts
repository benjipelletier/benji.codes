// Browser-side helpers for the site-wide Neon Auth mount at /api/auth.
//
// Shared by the spectator banner (which offers the way in) and the rail
// (which offers the way out), so the callback handling only exists once.

/** Send the user to Google; they come back to the page they left. */
export async function signInWithGoogle(): Promise<void> {
  const callbackURL = `${window.location.origin}${window.location.pathname}`;
  const res = await fetch("/api/auth/sign-in/social", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "google", callbackURL }),
  });
  const data = await res.json().catch(() => ({}));
  if (data?.url) window.location.href = data.url;
}

/**
 * Drop the session and reload.
 *
 * The reload matters: the bank in memory belongs to the signed-in owner, and
 * bootstrap() has to re-run to fall back to the spectator view. Mutating React
 * state would leave a writable UI over a session that no longer exists.
 */
export async function signOut(): Promise<void> {
  await fetch("/api/auth/sign-out", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  window.location.reload();
}
