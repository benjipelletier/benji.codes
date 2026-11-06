'use client';

// Voicebox's frame, phone first: a slim top bar (name, sync state) and the
// three pages as a tab bar along the bottom, in thumb reach; on a wide screen
// the tabs move up into the top bar. How the device stands with the server:
// synced, offline with answers waiting, or a failed sync.
// Links between the pages are plain <a>: a full load the service worker
// can answer with no connection, where a client-side route change would
// need the server.

import { useMemo } from 'react';
import { TrainerProvider, useTrainer } from './TrainerProvider';
import { groupAttempts, hasContextGap, modeStats, targetFor, type ModeStats } from '@voicebox/lib/srs';
import type { Attempt } from '@voicebox/lib/types';

export type TrainerPage = 'review' | 'practice' | 'library';

const PAGES: { id: TrainerPage; href: string; label: string }[] = [
  { id: 'review', href: '/voicebox', label: 'Review' },
  { id: 'practice', href: '/voicebox/practice', label: 'Practice' },
  { id: 'library', href: '/voicebox/library', label: 'Library' },
];

/** Site-wide Google sign-in (the same account as the rest of benji.codes), back to this page. */
export async function signIn() {
  const res = await fetch('/api/auth/sign-in/social', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'google', callbackURL: window.location.href }),
  });
  const data = await res.json().catch(() => ({}));
  if (data?.url) window.location.href = data.url;
}

export async function signOut() {
  await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  window.location.reload();
}

function SyncChip() {
  const { status, pending, syncError, sync, viewer } = useTrainer();
  let text: string;
  let cls = 'vt-sync';
  let onClick = () => void sync();
  if (status === 'loading') text = 'loading…';
  else if (status === 'syncing') text = 'syncing…';
  else if (status === 'offline') {
    text = pending ? `✈ ${pending} waiting` : '✈ offline';
    cls += ' vt-sync-off';
  } else if (status === 'error') {
    text = `sync failed${pending ? ` · ${pending}` : ''}`;
    cls += ' vt-sync-err';
  } else if (!viewer?.isOwner) {
    // Practising works signed out; it just stays on this device.
    text = 'Sign in';
    cls += ' vt-sync-off';
    onClick = () => void signIn();
  } else text = pending ? `${pending} waiting` : '● synced';
  return (
    <button type="button" className={cls} onClick={onClick} title={syncError ?? (viewer?.isOwner ? 'Sync now' : 'Sign in to save your progress')} disabled={status === 'syncing' || status === 'loading'}>
      {text}
    </button>
  );
}

const TAB_ICONS: Record<TrainerPage, React.ReactNode> = {
  // A card, a metronome-ish run, a shelf.
  review: <path d="M5 4h11a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2V4Zm2 13h9M8 8h7M8 11h5" />,
  practice: <path d="M4 18h16M7 18V9m5 9V5m5 13v-6" />,
  library: <path d="M5 4v16M9 4v16M13 5l4 15" />,
};

function Frame({ page, children }: { page: TrainerPage; children: React.ReactNode }) {
  const { ready, error, voicings, status } = useTrainer();
  return (
    <div className="vt">
      <header className="vt-bar">
        <a href="/voicebox" className="vt-brand" aria-label="Voicebox home">
          Voice<em>box</em>
        </a>
        <nav className="vt-tabs" aria-label="Voicebox">
          {PAGES.map(p => (
            <a key={p.id} href={p.href} className={p.id === page ? 'vt-tab on' : 'vt-tab'} aria-current={p.id === page ? 'page' : undefined}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {TAB_ICONS[p.id]}
              </svg>
              <span>{p.label}</span>
            </a>
          ))}
        </nav>
        <SyncChip />
      </header>
      <main className="vt-main">
        {error && <p className="vt-error">{error}</p>}
        {!ready ? (
          <p className="vt-empty">Loading…</p>
        ) : !voicings.length ? (
          <p className="vt-empty">{status === 'syncing' || status === 'loading' ? 'Downloading the library…' : status === 'offline' ? 'No library on this device yet. Open Voicebox once with a connection to download it.' : 'The library is empty.'}</p>
        ) : (
          children
        )}
      </main>
    </div>
  );
}

export function TrainerShell({ page, children }: { page: TrainerPage; children: React.ReactNode }) {
  return (
    <TrainerProvider>
      <Frame page={page}>{children}</Frame>
    </TrainerProvider>
  );
}

/** Per-card stats and the context-gap flags, from every answer on the device. */
export function useCardStats(): { stats: Map<string, ModeStats>; gapKeys: Set<string>; grouped: Map<string, Attempt[]> } {
  const { attempts, srs, settings } = useTrainer();
  return useMemo(() => {
    const grouped = groupAttempts(attempts);
    const stats = new Map<string, ModeStats>();
    const gapKeys = new Set<string>();
    for (const [k, list] of grouped) {
      const s = modeStats(list);
      stats.set(k, s);
      const mode = list[0].mode;
      if (hasContextGap(s, targetFor(srs.get(k), mode, settings))) gapKeys.add(k);
    }
    return { stats, gapKeys, grouped };
  }, [attempts, srs, settings]);
}

export const fmtSecs = (ms: number | null | undefined) => (ms == null ? '—' : `${(ms / 1000).toFixed(2)}s`);
export const fmtPct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');

export function relTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(ms);
  const fmt = (n: number, u: string) => `${n} ${u}${n === 1 ? '' : 's'}`;
  let s: string;
  if (abs < 60_000) s = 'moments';
  else if (abs < 3_600_000) s = fmt(Math.round(abs / 60_000), 'minute');
  else if (abs < 86_400_000) s = fmt(Math.round(abs / 3_600_000), 'hour');
  else s = fmt(Math.round(abs / 86_400_000), 'day');
  return ms >= 0 ? `${s} ago` : `in ${s}`;
}
