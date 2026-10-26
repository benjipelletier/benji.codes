'use client';

// Browser-side helpers: API calls, sign-in, and per-device preferences.

import { useCallback, useEffect, useState } from 'react';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  const res = await fetch(`/api/ifakepro${path}`, {
    method: init?.method ?? (init?.body !== undefined ? 'POST' : 'GET'),
    headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: init?.signal,
    cache: 'no-store',
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, (json as { error?: string } | null)?.error ?? `Request failed (${res.status})`, json);
  return json as T;
}

/** Send the user to Google; they come back to this page, query string and all (so ?invite= survives). */
export async function signInWithGoogle(): Promise<void> {
  const callbackURL = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  const res = await fetch('/api/auth/sign-in/social', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'google', callbackURL }),
  });
  const data = await res.json().catch(() => ({}));
  if (data?.url) window.location.href = data.url;
}

export async function signOut(): Promise<void> {
  await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  window.location.reload();
}

/** A preference kept in this browser only. Falls back to the default where storage is blocked. */
export function usePref<T extends string>(key: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    try {
      const v = localStorage.getItem(`ifp:${key}`);
      if (v) setValue(v as T);
    } catch {}
  }, [key]);
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(`ifp:${key}`, v);
      } catch {}
      window.dispatchEvent(new CustomEvent('ifp-pref', { detail: { key, v } }));
    },
    [key],
  );
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d.key === key) setValue(d.v);
    };
    window.addEventListener('ifp-pref', on);
    return () => window.removeEventListener('ifp-pref', on);
  }, [key]);
  return [value, set];
}

export function timeAgo(isoTime: string, now = Date.now()): string {
  const t = Date.parse(isoTime);
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d > 300 ? 'numeric' : undefined });
}

export function when(isoTime: string): string {
  const d = new Date(isoTime);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today, ${time}`;
  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })}, ${time}`;
}

/** A steady color per person, for avatars and the bar they're on. */
export function personColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 62% 46%)`;
}

export function displayKey(key: string): string {
  return key.replace('-', 'm').replace(/b/g, '♭').replace(/#/g, '♯');
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function download(name: string, content: string, type = 'text/html') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
