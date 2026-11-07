'use client';

// The trainer's state, kept on the device (IndexedDB) and synced with Neon
// when there is a connection. Everything reads and writes the device copy
// first, so all three pages work with no connection: answers wait with
// synced = false and go up once the connection is back.
//
// Sync, each time the page opens, comes back online, or finishes a session:
//   1. push  — unsent answers, changed schedules, runs, library edits (owner only)
//   2. pull  — the library, progressions, schedules, answers and runs; a
//              schedule changed here and not yet sent keeps the device's copy
//   3. tunes — every standard's changes, when the device has none or they
//              are a week old
//   4. the app's pages and code fetched through the service worker, so
//      they open offline too

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { deleteMany, getAll, getMeta, putMany, replaceAll, setMeta } from '@voiceshed/lib/idb';
import type { Attempt, Context, Run, Settings, SrsState, Tune, Voicing } from '@voiceshed/lib/types';
import { DEFAULT_SETTINGS, MODES, srsKey, type Mode } from '@voiceshed/lib/types';
import { newState } from '@voiceshed/lib/srs';

type StoredSrs = SrsState & { key: string };
type OutboxEntry =
  | { seq?: number; kind: 'upsert'; voicing: Voicing }
  | { seq?: number; kind: 'delete'; id: string }
  /** A card taken out of the deck: its schedule goes, its answers stay. */
  | { seq?: number; kind: 'unschedule'; voicing_id: string; mode: Mode };

export interface Viewer {
  isOwner: boolean;
  isSpectator: boolean;
}

export type SyncStatus = 'loading' | 'syncing' | 'synced' | 'offline' | 'error';

export interface OfflineInfo {
  /** When the app's pages were last saved through the service worker. */
  appSavedAt: string | null;
  dataAt: string | null;
  tunesAt: string | null;
  tunes: number;
}

interface TrainerState {
  ready: boolean;
  error: string | null;
  voicings: Voicing[];
  contexts: Context[];
  srs: Map<string, SrsState>;
  attempts: Attempt[];
  runs: Run[];
  settings: Settings;
  viewer: Viewer | null;
  status: SyncStatus;
  syncError: string | null;
  pending: number;
  lastSyncAt: string | null;
  offline: OfflineInfo;
}

interface TrainerApi extends TrainerState {
  canEdit: boolean;
  recordAttempts: (rows: Omit<Attempt, 'synced' | 'local_only'>[]) => Promise<void>;
  saveSrs: (rows: SrsState[]) => Promise<void>;
  saveRun: (run: Omit<Run, 'synced' | 'local_only'>) => Promise<void>;
  saveVoicing: (v: Voicing) => Promise<void>;
  deleteVoicing: (id: string) => Promise<void>;
  saveSettings: (s: Settings) => Promise<void>;
  /** Voicings into the deck (all three modes); returns the cards added. */
  addToDeck: (voicingIds: string[]) => Promise<number>;
  /** Voicings out of the deck; returns how many came out. */
  removeFromDeck: (voicingIds: string[]) => Promise<number>;
  sync: (opts?: { tunes?: boolean }) => Promise<void>;
  loadTunes: () => Promise<Tune[]>;
}

const Ctx = createContext<TrainerApi | null>(null);

export function useTrainer(): TrainerApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTrainer outside TrainerProvider');
  return v;
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * A voicing and its other inversion: the same chord in the same voicing type
 * (Cm7's two drop-2s, 3 7 9 5 and 7 3 5 9). Ones with no partner (the 6, the
 * m7♭5s) stand alone.
 */
export function partnersOf(voicings: Voicing[], v: Voicing): Voicing[] {
  return voicings.filter(o => o.chord_label === v.chord_label && o.family === v.family);
}

function withPartners(voicings: Voicing[], ids: string[]): string[] {
  const byId = new Map(voicings.map(v => [v.id, v]));
  const out = new Set(ids);
  for (const id of ids) {
    const v = byId.get(id);
    if (v) for (const o of partnersOf(voicings, v)) out.add(o.id);
  }
  return [...out];
}

const TUNES_MAX_AGE = 7 * 86_400_000;
const PUSH_CHUNK = 2000;
export const TRAINER_ROUTES = ['/voiceshed', '/voiceshed/practice', '/voiceshed/voicings'];

const strip = ({ key: _k, ...s }: StoredSrs): SrsState => s;

function countPending(attempts: Attempt[], srs: Map<string, SrsState>, runs: Run[], outbox: number): number {
  let n = outbox;
  for (const a of attempts) if (!a.synced && !a.local_only) n++;
  for (const s of srs.values()) if (s.dirty) n++;
  for (const r of runs) if (!r.synced && !r.local_only) n++;
  return n;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error((body as { error?: string }).error ?? `HTTP ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

/**
 * The pages and their code fetched again through the service worker, which
 * keeps them: what a page loaded before the worker controlled it isn't kept
 * otherwise. Each page's own scripts and styles are read off its HTML.
 */
async function warmAppCache(): Promise<boolean> {
  if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return false;
  try {
    await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(r, 4000))]);
    if (!navigator.serviceWorker.controller) {
      await new Promise(r => {
        navigator.serviceWorker.addEventListener('controllerchange', r, { once: true });
        setTimeout(r, 4000);
      });
    }
    if (!navigator.serviceWorker.controller) return false;
    const assets = new Set(
      performance
        .getEntriesByType('resource')
        .map(e => e.name)
        .filter(u => u.startsWith(`${location.origin}/_next/static/`) || u.startsWith('https://fonts.')),
    );
    for (const route of TRAINER_ROUTES) {
      const html = await fetch(route, { cache: 'no-store' }).then(r => r.text());
      for (const m of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)) assets.add(`${location.origin}${m[1]}`);
    }
    await Promise.all([...assets].map(u => fetch(u, u.startsWith(location.origin) ? undefined : { mode: 'no-cors' }).catch(() => undefined)));
    return true;
  } catch {
    return false;
  }
}

export function TrainerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<TrainerState>({
    ready: false,
    error: null,
    voicings: [],
    contexts: [],
    srs: new Map(),
    attempts: [],
    runs: [],
    settings: DEFAULT_SETTINGS,
    viewer: null,
    status: 'loading',
    syncError: null,
    pending: 0,
    lastSyncAt: null,
    offline: { appSavedAt: null, dataAt: null, tunesAt: null, tunes: 0 },
  });
  const ref = useRef(state);
  ref.current = state;
  const outboxCount = useRef(0);
  const syncing = useRef<Promise<void> | null>(null);
  /** A sync asked for while one runs: one more goes after it, so nothing saved meanwhile waits. */
  const again = useRef<{ tunes?: boolean } | null>(null);
  const syncRef = useRef<(opts?: { tunes?: boolean }) => Promise<void>>(async () => undefined);
  const tunesCache = useRef<Tune[] | null>(null);

  const patch = useCallback((p: Partial<TrainerState> | ((s: TrainerState) => Partial<TrainerState>)) => {
    setState(s => {
      const next = { ...s, ...(typeof p === 'function' ? p(s) : p) };
      next.pending = countPending(next.attempts, next.srs, next.runs, outboxCount.current);
      ref.current = next;
      return next;
    });
  }, []);

  // ── load from the device ──────────────────────────────────────────────
  const loadLocal = useCallback(async () => {
    const [voicings, contexts, srsRows, attempts, runs, outbox, settings, viewer, lastSyncAt, offline] = await Promise.all([
      getAll<Voicing>('voicings'),
      getAll<Context>('contexts'),
      getAll<StoredSrs>('srs'),
      getAll<Attempt>('attempts'),
      getAll<Run>('runs'),
      getAll<OutboxEntry>('outbox'),
      getMeta<Settings>('settings'),
      getMeta<Viewer>('viewer'),
      getMeta<string>('lastSyncAt'),
      getMeta<OfflineInfo>('offline'),
    ]);
    outboxCount.current = outbox.length;
    patch({
      ready: true,
      voicings: voicings.sort((a, b) => a.sort_order - b.sort_order || a.chord_label.localeCompare(b.chord_label)),
      contexts: contexts.sort((a, b) => a.sort_order - b.sort_order),
      srs: new Map(srsRows.map(r => [r.key, strip(r)])),
      attempts: attempts.sort((a, b) => a.created_at.localeCompare(b.created_at)),
      runs: runs.sort((a, b) => a.finished_at.localeCompare(b.finished_at)),
      settings: { ...DEFAULT_SETTINGS, ...settings, target_ms: { ...DEFAULT_SETTINGS.target_ms, ...settings?.target_ms } },
      viewer: viewer ?? null,
      lastSyncAt: lastSyncAt ?? null,
      offline: offline ?? { appSavedAt: null, dataAt: null, tunesAt: null, tunes: 0 },
    });
  }, [patch]);

  // ── push ──────────────────────────────────────────────────────────────
  const push = useCallback(async () => {
    const s = ref.current;
    if (!s.viewer?.isOwner) return;
    const outbox = await getAll<OutboxEntry>('outbox');
    const attempts = s.attempts.filter(a => !a.synced && !a.local_only);
    const srs = [...s.srs.values()].filter(r => r.dirty);
    const runs = s.runs.filter(r => !r.synced && !r.local_only);
    if (!outbox.length && !attempts.length && !srs.length && !runs.length) return;

    // The latest edit of each voicing; a delete after an edit wins.
    const upserts = new Map<string, Voicing>();
    const deletes = new Set<string>();
    const unschedule = new Map<string, { voicing_id: string; mode: Mode }>();
    for (const e of outbox) {
      if (e.kind === 'upsert') {
        upserts.set(e.voicing.id, e.voicing);
        deletes.delete(e.voicing.id);
      } else if (e.kind === 'delete') {
        upserts.delete(e.id);
        deletes.add(e.id);
      } else unschedule.set(srsKey(e.voicing_id, e.mode), { voicing_id: e.voicing_id, mode: e.mode });
    }
    // Taken out and put back since: the schedule now on the device is what's sent.
    for (const r of srs) unschedule.delete(srsKey(r.voicing_id, r.mode));
    const wire = <T extends object>(r: T) => {
      const { synced: _s, local_only: _l, dirty: _d, ...rest } = r as T & { synced?: boolean; local_only?: boolean; dirty?: boolean };
      return rest;
    };
    for (let i = 0; i === 0 || i < attempts.length; i += PUSH_CHUNK) {
      const first = i === 0;
      await fetch('/api/voiceshed/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voicingUpserts: first ? [...upserts.values()] : [],
          voicingDeletes: first ? [...deletes] : [],
          srsDeletes: first ? [...unschedule.values()] : [],
          attempts: attempts.slice(i, i + PUSH_CHUNK).map(wire),
          srs: first ? srs.map(wire) : [],
          runs: first ? runs.map(wire) : [],
        }),
      }).then(json);
    }

    // Sent: marked so, unless changed again while sending.
    await deleteMany('outbox', outbox.map(e => e.seq!).filter(x => x != null));
    outboxCount.current = Math.max(0, outboxCount.current - outbox.length);
    const sentAttempts = new Set(attempts.map(a => a.id));
    const sentRuns = new Set(runs.map(r => r.id));
    const sentSrs = new Map(srs.map(r => [srsKey(r.voicing_id, r.mode), r.updated_at]));
    const cur = ref.current;
    const nextAttempts = cur.attempts.map(a => (sentAttempts.has(a.id) ? { ...a, synced: true } : a));
    const nextRuns = cur.runs.map(r => (sentRuns.has(r.id) ? { ...r, synced: true } : r));
    const nextSrs = new Map(cur.srs);
    const cleaned: StoredSrs[] = [];
    for (const [k, r] of nextSrs) {
      if (r.dirty && sentSrs.get(k) === r.updated_at) {
        const c = { ...r, dirty: false };
        nextSrs.set(k, c);
        cleaned.push({ ...c, key: k });
      }
    }
    await putMany('attempts', nextAttempts.filter(a => sentAttempts.has(a.id)));
    await putMany('runs', nextRuns.filter(r => sentRuns.has(r.id)));
    await putMany('srs', cleaned);
    patch({ attempts: nextAttempts, runs: nextRuns, srs: nextSrs });
  }, [patch]);

  // ── pull ──────────────────────────────────────────────────────────────
  const pull = useCallback(async () => {
    const b = await fetch('/api/voiceshed/bundle', { cache: 'no-store' }).then(r =>
      json<{
        at: string;
        viewer: Viewer;
        voicings: Voicing[];
        contexts: Context[];
        srs: SrsState[];
        attempts: Omit<Attempt, 'synced'>[];
        runs: Omit<Run, 'synced'>[];
      }>(r),
    );
    const outbox = await getAll<OutboxEntry>('outbox');
    const pendingUp = new Map<string, Voicing>();
    const pendingDel = new Set<string>();
    const pendingUnsched = new Set<string>();
    for (const e of outbox) {
      if (e.kind === 'upsert') pendingUp.set(e.voicing.id, e.voicing);
      else if (e.kind === 'delete') pendingDel.add(e.id);
      else pendingUnsched.add(srsKey(e.voicing_id, e.mode));
    }
    const toIso = (x: unknown) => (typeof x === 'string' ? new Date(x).toISOString() : x instanceof Date ? x.toISOString() : String(x));

    const serverVoicings = b.voicings.map(v => ({ ...v, updated_at: toIso(v.updated_at) }));
    const voicings = serverVoicings.filter(v => !pendingDel.has(v.id)).map(v => pendingUp.get(v.id) ?? v);
    for (const [id, v] of pendingUp) if (!voicings.some(x => x.id === id)) voicings.push(v);
    voicings.sort((a, b) => a.sort_order - b.sort_order || a.chord_label.localeCompare(b.chord_label));

    const cur = ref.current;
    const srs = new Map<string, SrsState>();
    for (const r of b.srs) {
      const s: SrsState = { ...r, ease: Number(r.ease), interval_days: Number(r.interval_days), due_at: toIso(r.due_at), created_at: toIso(r.created_at), updated_at: toIso(r.updated_at), dirty: false };
      // Taken out of the deck here and not yet sent: stays out.
      if (!pendingUnsched.has(srsKey(s.voicing_id, s.mode))) srs.set(srsKey(s.voicing_id, s.mode), s);
    }
    for (const [k, r] of cur.srs) if (r.dirty) srs.set(k, r);

    const haveAttempts = new Set(cur.attempts.map(a => a.id));
    const newAttempts: Attempt[] = b.attempts
      .filter(a => !haveAttempts.has(a.id))
      .map(a => ({ ...a, created_at: toIso(a.created_at), synced: true }));
    const attempts = [...cur.attempts, ...newAttempts].sort((x, y) => x.created_at.localeCompare(y.created_at));
    const haveRuns = new Set(cur.runs.map(r => r.id));
    const newRuns: Run[] = b.runs
      .filter(r => !haveRuns.has(r.id))
      .map(r => ({ ...r, started_at: toIso(r.started_at), finished_at: toIso(r.finished_at), synced: true }));
    const runs = [...cur.runs, ...newRuns].sort((x, y) => x.finished_at.localeCompare(y.finished_at));

    await replaceAll('voicings', voicings);
    await replaceAll('contexts', b.contexts);
    await replaceAll('srs', [...srs].map(([key, s]) => ({ ...s, key })));
    await putMany('attempts', newAttempts);
    await putMany('runs', newRuns);
    await setMeta('viewer', b.viewer);
    await setMeta('lastSyncAt', b.at);
    patch(s => {
      const offline = { ...s.offline, dataAt: b.at };
      void setMeta('offline', offline);
      return { voicings, contexts: b.contexts, srs, attempts, runs, viewer: b.viewer, lastSyncAt: b.at, offline };
    });
  }, [patch]);

  const pullTunes = useCallback(
    async (force: boolean) => {
      const at = ref.current.offline.tunesAt;
      if (!force && at && Date.now() - new Date(at).getTime() < TUNES_MAX_AGE) return;
      const t = await fetch('/api/voiceshed/tunes', { cache: 'no-store' }).then(r => json<{ at: string; tunes: Tune[] }>(r));
      await replaceAll('tunes', t.tunes);
      tunesCache.current = t.tunes;
      patch(s => {
        const offline = { ...s.offline, tunesAt: t.at, tunes: t.tunes.length };
        void setMeta('offline', offline);
        return { offline };
      });
    },
    [patch],
  );

  const sync = useCallback(
    async (opts?: { tunes?: boolean }) => {
      if (syncing.current) {
        again.current = { tunes: !!(again.current?.tunes || opts?.tunes) };
        return syncing.current;
      }
      const run = (async () => {
        patch({ status: 'syncing', syncError: null });
        try {
          // Who's viewing decides whether there is anything to send.
          const v = await fetch('/api/voiceshed/viewer', { cache: 'no-store' }).then(r => json<Viewer>(r));
          patch({ viewer: { isOwner: v.isOwner, isSpectator: v.isSpectator } });
          void setMeta('viewer', { isOwner: v.isOwner, isSpectator: v.isSpectator });
          try {
            await push();
          } catch (err) {
            // Signed out since: keep everything waiting, still bring the library down.
            if ((err as { status?: number }).status !== 401) throw err;
          }
          await pull();
          await pullTunes(!!opts?.tunes);
          patch({ status: 'synced' });
          void warmAppCache().then(ok => {
            if (!ok) return;
            patch(s => {
              const offline = { ...s.offline, appSavedAt: new Date().toISOString() };
              void setMeta('offline', offline);
              return { offline };
            });
          });
        } catch (err) {
          const offline = err instanceof TypeError || (typeof navigator !== 'undefined' && !navigator.onLine);
          patch({ status: offline ? 'offline' : 'error', syncError: offline ? null : (err as Error).message });
        }
      })().finally(() => {
        syncing.current = null;
        const next = again.current;
        again.current = null;
        if (next) void syncRef.current(next);
      });
      syncing.current = run;
      return run;
    },
    [patch, push, pull, pullTunes],
  );
  syncRef.current = sync;

  useEffect(() => {
    let alive = true;
    loadLocal()
      .then(() => alive && sync())
      .catch(err => patch({ ready: true, error: (err as Error).message, status: 'error' }));
    const onOnline = () => void sync();
    window.addEventListener('online', onOnline);
    // Anything waiting is retried every couple of minutes.
    const timer = setInterval(() => {
      if (ref.current.pending > 0 && ref.current.status !== 'syncing') void sync();
    }, 120_000);
    return () => {
      alive = false;
      window.removeEventListener('online', onOnline);
      clearInterval(timer);
    };
  }, [loadLocal, sync, patch]);

  // The pages open with no connection (public/voiceshed-sw.js); in production only, so it never caches a dev build.
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/voiceshed-sw.js', { scope: '/voiceshed' }).catch(() => undefined);
  }, []);

  // ── writes ────────────────────────────────────────────────────────────
  const recordAttempts = useCallback(
    async (rows: Omit<Attempt, 'synced' | 'local_only'>[]) => {
      const localOnly = !ref.current.viewer?.isOwner;
      const full: Attempt[] = rows.map(r => ({ ...r, synced: false, local_only: localOnly || undefined }));
      await putMany('attempts', full);
      patch(s => ({ attempts: [...s.attempts, ...full] }));
    },
    [patch],
  );

  const saveSrs = useCallback(
    async (rows: SrsState[]) => {
      // A spectator's practice changes this device only: the next pull replaces it.
      const owner = !!ref.current.viewer?.isOwner;
      const stored = rows.map(r => ({ ...r, dirty: owner ? r.dirty !== false : false, key: srsKey(r.voicing_id, r.mode) }));
      patch(s => {
        const srs = new Map(s.srs);
        for (const r of stored) srs.set(r.key, strip(r));
        return { srs };
      });
      await putMany('srs', stored);
    },
    [patch],
  );

  const saveRun = useCallback(
    async (run: Omit<Run, 'synced' | 'local_only'>) => {
      const full: Run = { ...run, synced: false, local_only: !ref.current.viewer?.isOwner || undefined };
      await putMany('runs', [full]);
      patch(s => ({ runs: [...s.runs, full] }));
    },
    [patch],
  );

  const saveVoicing = useCallback(
    async (v: Voicing) => {
      const next = { ...v, updated_at: new Date().toISOString() };
      // On screen at once; the device copy and the outbox follow.
      outboxCount.current++;
      patch(s => {
        const exists = s.voicings.some(x => x.id === v.id);
        const voicings = exists ? s.voicings.map(x => (x.id === v.id ? next : x)) : [...s.voicings, next];
        return { voicings };
      });
      await putMany('voicings', [next]);
      await putMany<OutboxEntry>('outbox', [{ kind: 'upsert', voicing: next }]);
    },
    [patch],
  );

  const deleteVoicing = useCallback(
    async (id: string) => {
      await deleteMany('voicings', [id]);
      await putMany<OutboxEntry>('outbox', [{ kind: 'delete', id }]);
      outboxCount.current++;
      const keys = [...ref.current.srs.keys()].filter(k => k.startsWith(`${id}|`));
      await deleteMany('srs', keys);
      patch(s => {
        const srs = new Map(s.srs);
        for (const k of keys) srs.delete(k);
        return { voicings: s.voicings.filter(v => v.id !== id), srs };
      });
    },
    [patch],
  );

  /**
   * Into the deck: each voicing — with its other inversion, the two being
   * connected (the owner: "both inversions… added automatically") — brings its
   * Play, Spell and Name cards, new and due now (any already there stay).
   */
  const addToDeck = useCallback(
    async (voicingIds: string[]) => {
      const now = new Date();
      const rows: SrsState[] = [];
      for (const id of withPartners(ref.current.voicings, voicingIds))
        for (const m of MODES) if (!ref.current.srs.has(srsKey(id, m))) rows.push({ ...newState(id, m, now), dirty: true });
      if (rows.length) await saveSrs(rows);
      return rows.length;
    },
    [saveSrs],
  );

  /** Out of the deck: the voicings, with their other inversions, leave the schedule; their answers stay, for the stats. */
  const removeFromDeck = useCallback(
    async (voicingIds: string[]) => {
      const keys = withPartners(ref.current.voicings, voicingIds)
        .flatMap(id => MODES.map(m => srsKey(id, m)))
        .filter(k => ref.current.srs.has(k));
      if (!keys.length) return 0;
      outboxCount.current += keys.length;
      patch(s => {
        const srs = new Map(s.srs);
        for (const k of keys) srs.delete(k);
        return { srs };
      });
      await deleteMany('srs', keys);
      await putMany<OutboxEntry>(
        'outbox',
        keys.map(k => {
          const [voicing_id, mode] = k.split('|') as [string, Mode];
          return { kind: 'unschedule', voicing_id, mode };
        }),
      );
      return new Set(keys.map(k => k.split('|')[0])).size;
    },
    [patch],
  );

  // A voicing in the deck without its other inversion (added before they were
  // connected) gets it: the pair is one thing.
  useEffect(() => {
    if (!state.ready || !state.viewer?.isOwner || !state.srs.size) return;
    const inDeck = new Set([...state.srs.values()].map(r => r.voicing_id));
    const missing = withPartners(state.voicings, [...inDeck]).filter(id => !inDeck.has(id));
    if (missing.length) void addToDeck(missing).then(() => sync());
  }, [state.ready, state.viewer, state.srs, state.voicings, addToDeck, sync]);

  const saveSettings = useCallback(
    async (settings: Settings) => {
      await setMeta('settings', settings);
      patch({ settings });
    },
    [patch],
  );

  const loadTunes = useCallback(async () => {
    tunesCache.current ??= (await getAll<Tune>('tunes')).sort((a, b) => a.title.localeCompare(b.title));
    return tunesCache.current;
  }, []);

  const api = useMemo<TrainerApi>(
    () => ({
      ...state,
      canEdit: !!state.viewer?.isOwner,
      recordAttempts,
      saveSrs,
      saveRun,
      saveVoicing,
      deleteVoicing,
      saveSettings,
      addToDeck,
      removeFromDeck,
      sync,
      loadTunes,
    }),
    [state, recordAttempts, saveSrs, saveRun, saveVoicing, deleteVoicing, saveSettings, addToDeck, removeFromDeck, sync, loadTunes],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
