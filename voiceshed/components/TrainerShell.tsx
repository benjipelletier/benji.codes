'use client';

// Voiceshed's frame, phone first: a slim top bar (name, sync state) and the
// three pages as a tab bar along the bottom, in thumb reach; on a wide screen
// the tabs move up into the top bar. How the device stands with the server:
// synced, offline with answers waiting, or a failed sync.
// Links between the pages are plain <a>: a full load the service worker
// can answer with no connection, where a client-side route change would
// need the server.

import { useMemo, useEffect, useState } from 'react';
import { TrainerProvider, useTrainer } from './TrainerProvider';
import { groupAttempts, hasContextGap, modeStats, targetFor, type ModeStats } from '@voiceshed/lib/srs';
import type { Attempt } from '@voiceshed/lib/types';

export type TrainerPage = 'review' | 'practice' | 'voicings';

const PAGES: { id: TrainerPage; href: string; label: string }[] = [
  { id: 'review', href: '/voiceshed', label: 'Review' },
  { id: 'practice', href: '/voiceshed/practice', label: 'Practice' },
  { id: 'voicings', href: '/voiceshed/voicings', label: 'Voicings' },
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
  voicings: <path d="M5 4v16M9 4v16M13 5l4 15" />,
};

/**
 * The Lick — D E F G E C D, the jazz cliché (the owner: "the loader's piano
 * should play it") — on the loader's white keys, C to C: each step a key (0 = C)
 * and how long it sounds, in eighth notes; the last D held, then a breath.
 */
const THE_LICK: [key: number, eighths: number][] = [
  [1, 1], // D
  [2, 1], // E
  [3, 1], // F
  [4, 1], // G
  [2, 1], // E
  [0, 1], // C
  [1, 3], // D, held
];
const EIGHTH_MS = 170;
const BREATH_EIGHTHS = 3;

/** A little piano playing The Lick, notes floating off it, for while the app loads. */
export function PianoLoader({ label }: { label: string }) {
  const whites = 8;
  const blacks = [0, 1, 3, 4, 5]; // after these white keys
  // Which step is sounding (-1 between rounds); still with reduced motion.
  const [step, setStep] = useState(-1);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const play = () => {
      if (i < THE_LICK.length) {
        setStep(i);
        timer = setTimeout(play, THE_LICK[i++][1] * EIGHTH_MS);
      } else {
        setStep(-1);
        i = 0;
        timer = setTimeout(play, BREATH_EIGHTHS * EIGHTH_MS);
      }
    };
    timer = setTimeout(play, 250);
    return () => clearTimeout(timer);
  }, []);
  const down = step >= 0 ? THE_LICK[step][0] : -1;
  return (
    <div className="vt-loader" role="status">
      <svg viewBox="0 0 160 70" aria-hidden="true">
        {Array.from({ length: whites }, (_, i) => (
          <rect key={`w${i}`} className={`vt-loader-w ${i === down ? 'on' : ''}`} x={i * 20 + 1} y={1} width={18} height={66} rx={2.5} />
        ))}
        {blacks.map(i => (
          <rect key={`b${i}`} className="vt-loader-b" x={i * 20 + 14} y={1} width={12} height={40} rx={2} />
        ))}
      </svg>
      <span className="vt-loader-notes" aria-hidden="true">
        <i>♪</i>
        <i>♫</i>
        <i>♪</i>
      </span>
      <span>{label}</span>
    </div>
  );
}

const TAP_NOTES = ['♪', '♫', '♩', '♬'];

/**
 * A note floats up from a tapped button (the owner: "cute jazz or piano
 * animations on any loading and button clicking"). Not on a run's keys or note
 * pad, where speed counts, and not at all with reduced motion.
 */
function useTapNotes() {
  useEffect(() => {
    if (typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const onDown = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest('button, a.vt-tab');
      if (!el || (el as HTMLButtonElement).disabled || el.closest('.cr-input, .cr-kb, .np, .vk')) return;
      const n = document.createElement('span');
      n.className = 'vt-tapnote';
      n.textContent = TAP_NOTES[Math.floor(Math.random() * TAP_NOTES.length)];
      n.style.left = `${e.clientX}px`;
      n.style.top = `${e.clientY}px`;
      n.style.setProperty('--dx', `${Math.round(Math.random() * 36 - 18)}px`);
      n.style.setProperty('--rot', `${Math.round(Math.random() * 40 - 20)}deg`);
      document.body.appendChild(n);
      n.addEventListener('animationend', () => n.remove());
      setTimeout(() => n.remove(), 1200);
    };
    document.addEventListener('pointerdown', onDown, { passive: true });
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);
}

function Frame({ page, children }: { page: TrainerPage; children: React.ReactNode }) {
  const { ready, error, voicings, status } = useTrainer();
  useTapNotes();
  return (
    <div className="vt">
      {/* A phone on its side outside a run (CSS decides; a run sets html.vt-running). */}
      <div className="vt-rotate" role="status">
        <span className="vt-rotate-icon" aria-hidden>
          ↻
        </span>
        <b>Turn your phone upright</b>
        <span>Sideways is for playing cards: start a review or a practice run.</span>
      </div>
      <header className="vt-bar">
        <a href="/voiceshed" className="vt-brand" aria-label="Voiceshed home">
          Voice<em>shed</em>
        </a>
        <nav className="vt-tabs" aria-label="Voiceshed">
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
          <PianoLoader label="Warming up…" />
        ) : !voicings.length ? (
          status === 'syncing' || status === 'loading' ? (
            <PianoLoader label="Downloading the voicings…" />
          ) : (
            <p className="vt-empty">{status === 'offline' ? 'No voicings on this device yet. Open Voiceshed once with a connection to download it.' : 'No voicings yet.'}</p>
          )
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
