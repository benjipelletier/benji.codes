// Browser-side helpers for the site-wide Neon Auth mount at /api/auth.

/** Send the user to Google; they come back to the page they left. */
export async function signInWithGoogle(): Promise<void> {
  const callbackURL = `${window.location.origin}${window.location.pathname}`;
  const res = await fetch("/api/auth/sign-in/social", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "google", callbackURL }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data?.url) throw new Error("Sign-in isn't available right now.");
  window.location.href = data.url;
}

/**
 * Drop the session and reload, so the shell starts again as a visitor: what is
 * in this browser stays, and nothing more is sent.
 */
export async function signOut(): Promise<void> {
  await fetch("/api/auth/sign-out", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  window.location.reload();
}
