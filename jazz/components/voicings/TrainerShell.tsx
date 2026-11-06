'use client';

// The trainer's frame: title, the three pages, and how the device stands
// with the server (synced, offline with answers waiting, or a failed sync).
// Links between the pages are plain <a>: a full load the service worker
// can answer with no connection, where a client-side route change would
// need the server.

import { useMemo } from 'react';
import { TrainerProvider, useTrainer } from './TrainerProvider';
import { groupAttempts, hasContextGap, modeStats, targetFor, type ModeStats } from '@jazz/lib/voicings/srs';
import type { Attempt } from '@jazz/lib/voicings/types';

export type TrainerPage = 'review' | 'practice' | 'library';

const PAGES: { id: TrainerPage; href: string; label: string }[] = [
  { id: 'review', href: '/jazz/voicings', label: 'Review' },
  { id: 'practice', href: '/jazz/voicings/practice', label: 'Practice' },
  { id: 'library', href: '/jazz/voicings/library', label: 'Library' },
];

function SyncChip() {
  const { status, pending, syncError, sync, viewer } = useTrainer();
  let text: string;
  let cls = 'vt-sync';
  if (status === 'loading') text = 'loading…';
  else if (status === 'syncing') text = 'syncing…';
  else if (status === 'offline') {
    text = pending ? `✈ offline · ${pending} waiting` : '✈ offline';
    cls += ' vt-sync-off';
  } else if (status === 'error') {
    text = `sync failed${pending ? ` · ${pending} waiting` : ''}`;
    cls += ' vt-sync-err';
  } else if (!viewer?.isOwner) {
    text = 'not signed in · kept on this device';
    cls += ' vt-sync-off';
  } else text = pending ? `${pending} waiting` : '● synced';
  return (
    <button type="button" className={cls} onClick={() => void sync()} title={syncError ?? 'Sync now'} disabled={status === 'syncing' || status === 'loading'}>
      {text}
    </button>
  );
}

function Frame({ page, children }: { page: TrainerPage; children: React.ReactNode }) {
  const { ready, error, voicings, status } = useTrainer();
  return (
    <main className="vt">
      <header className="vt-head">
        <div className="vt-title">
          <h1>Voicings</h1>
          <span className="vt-kicker">recognise · produce · faster</span>
        </div>
        <nav className="vt-tabs" aria-label="Voicing trainer">
          {PAGES.map(p => (
            <a key={p.id} href={p.href} className={p.id === page ? 'vt-tab on' : 'vt-tab'} aria-current={p.id === page ? 'page' : undefined}>
              {p.label}
            </a>
          ))}
        </nav>
        <SyncChip />
      </header>
      {error && <p className="vt-error">{error}</p>}
      {!ready ? (
        <p className="vt-empty">Loading…</p>
      ) : !voicings.length ? (
        <p className="vt-empty">{status === 'syncing' || status === 'loading' ? 'Downloading the library…' : status === 'offline' ? 'No library on this device yet. Open this page once with a connection to download it.' : 'The library is empty.'}</p>
      ) : (
        children
      )}
    </main>
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
