"use client";

// Who is here, at the right of the header, and the pages that aren't tabs:
// the owner's 笨鸡 (anyone else's initial, or a menu button when signed out)
// opens a small menu with Stats and Settings (taken off the tab bar, which the
// owner found cluttered), then the address and Sign out, or Sign in.

import { useEffect, useRef, useState } from "react";
import type { Viewer } from "@chongfuxi/lib/api";
import { signInWithGoogle, signOut } from "@chongfuxi/lib/auth-client";
import { message, useBackLayer } from "./shared";
import { TabIcon } from "./TabIcon";

/** The pages kept in this menu rather than on the tab bar. */
export type MenuPage = "stats" | "settings";
const PAGES: Array<{ key: MenuPage; label: string; sub: string }> = [
  { key: "stats", label: "Stats", sub: "Reviews, retention, forecast" },
  { key: "settings", label: "Settings", sub: "Bring words in, algorithm, bugs" },
];

export function Account({ viewer, page, onPage }: { viewer: Viewer; page: string; onPage: (p: MenuPage) => void }) {
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

  const pages = (
    <nav className="cf-acct-pages" aria-label="More">
      {PAGES.map((p) => (
        <button
          key={p.key}
          role="menuitem"
          className={`cf-acct-page${page === p.key ? " is-on" : ""}`}
          aria-current={page === p.key ? "page" : undefined}
          onClick={() => {
            setOpen(false);
            onPage(p.key);
          }}
        >
          <span className="cf-acct-page-icon">
            <TabIcon kind={p.key} />
          </span>
          <span>
            {p.label}
            <small>{p.sub}</small>
          </span>
        </button>
      ))}
    </nav>
  );

  if (!viewer.configured) return null;

  // Signed out: the deck is read-only; the menu has the pages and Sign in.
  if (!viewer.email) {
    return (
      <div className="cf-acct" ref={box}>
        <span className="cf-tag" title="This is Benji's deck: anyone can look, only he can review">
          read-only
        </span>
        <button className="cf-acct-me" aria-haspopup="menu" aria-expanded={open} aria-label="Menu" onClick={() => setOpen(!open)}>
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
            <path d="M4 6h12M4 10h12M4 14h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        {open && (
          <div className="cf-acct-menu" role="menu">
            {pages}
            {error && <p className="cf-error">{error}</p>}
            <button className="cf-btn cf-btn-ghost" role="menuitem" disabled={busy} onClick={() => go(signInWithGoogle)}>
              {busy ? "Opening…" : "Sign in"}
            </button>
          </div>
        )}
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
          {pages}
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
