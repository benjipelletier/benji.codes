"use client";

// Who is here, at the right of the header: the owner's initial, opening a
// small menu with the address and Sign out; anyone else, Sign in (and a note
// that the deck is read-only for them).

import { useEffect, useRef, useState } from "react";
import type { Viewer } from "@chongfuxi/lib/api";
import { signInWithGoogle, signOut } from "@chongfuxi/lib/auth-client";
import { message, useBackLayer } from "./shared";

export function Account({ viewer }: { viewer: Viewer }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useBackLayer(open, () => setOpen(false));

  // A tap anywhere else closes the menu.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const go = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };

  if (!viewer.configured) return null;

  if (!viewer.email) {
    return (
      <div className="cf-acct">
        <span className="cf-tag" title="This is Benji's deck: anyone can look, only he can review">
          read-only
        </span>
        <button className="cf-acct-signin" disabled={busy} onClick={() => go(signInWithGoogle)}>
          {busy ? "Opening…" : "Sign in"}
        </button>
        {error && <p className="cf-acct-error cf-error">{error}</p>}
      </div>
    );
  }

  // The owner goes by 笨鸡 (Benji); anyone else by their initial.
  const badge = viewer.isOwner ? "笨鸡" : (viewer.email[0]?.toUpperCase() ?? "?");
  return (
    <div className="cf-acct" ref={box}>
      {!viewer.isOwner && <span className="cf-tag">read-only</span>}
      <button
        className={`cf-acct-me${viewer.isOwner ? " is-owner" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Signed in as ${viewer.email}`}
        onClick={() => setOpen(!open)}
      >
        {badge}
      </button>
      {open && (
        <div className="cf-acct-menu" role="menu">
          <p className="cf-acct-who">
            <b>{viewer.email}</b>
            <span>
              {viewer.isOwner
                ? "Your deck. Everyone else sees it read-only."
                : "This is Benji's deck: only he can review it, so it's read-only for you."}
            </span>
          </p>
          {error && <p className="cf-error">{error}</p>}
          <button className="cf-btn cf-btn-ghost" role="menuitem" disabled={busy} onClick={() => go(signOut)}>
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
