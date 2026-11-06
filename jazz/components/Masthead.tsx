'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

interface Viewer {
  signedIn: boolean;
  isSpectator: boolean;
  isOwner: boolean;
  sessionUser: { id: string; name: string | null; email: string; image: string | null } | null;
}

async function signOut() {
  await fetch('/api/auth/sign-out', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  window.location.reload();
}

export function Masthead() {
  const pathname = usePathname();
  const [viewer, setViewer] = useState<Viewer | null>(null);

  useEffect(() => {
    fetch('/api/jazz/viewer').then(r => r.json()).then(setViewer).catch(() => {});
  }, []);

  const onLibrary = pathname?.startsWith('/jazz/standards') || pathname === '/jazz';
  const onSessions = pathname?.startsWith('/jazz/sessions');
  const onImport = pathname?.startsWith('/jazz/import');

  const displayName = viewer?.isOwner ? 'Benji' : viewer?.sessionUser?.name ?? viewer?.sessionUser?.email ?? null;

  return (
    <header className="masthead">
      <div className="mast-top">
        <Link href="/jazz/standards" className="brand">
          <span className="brand-mark">JAZZ</span>
          <span className="brand-sub">
            shed log <span className="vol">· lp.09</span>
          </span>
        </Link>
        <nav className="nav">
          <Link href="/jazz/standards" className={onLibrary ? 'nav-item on' : 'nav-item'}>
            Library
          </Link>
          <Link href="/jazz/sessions" className={onSessions ? 'nav-item on' : 'nav-item'}>
            Woodshed
          </Link>
          {viewer?.signedIn && (
            <Link href="/jazz/import" className={onImport ? 'nav-item on' : 'nav-item'}>
              Import
            </Link>
          )}
        </nav>
        <div className="auth">
          {viewer?.signedIn && viewer.sessionUser && (
            <>
              <span className="auth-name">{displayName}</span>
              <span className="avatar">{(displayName ?? '?').charAt(0).toUpperCase()}</span>
              <button className="auth-link" onClick={signOut}>sign out</button>
            </>
          )}
          {/* Sign-in CTA lives in the SpectatorBanner so it's not duplicated here. */}
        </div>
      </div>
      <div className="mast-rule"></div>
    </header>
  );
}
