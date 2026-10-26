'use client';

// Keeps an open song in step with the server and with everyone else on it.
//
// Edits apply locally at once and save 800ms after the last one. A save names
// the revision it started from; if someone saved first the server answers 409
// with their version, which is merged bar by bar with ours (merge.ts) and
// saved again. Meanwhile the song is polled every few seconds for other
// people's saves (merged the same way if we have unsaved edits), who else is
// on it, and whether its comments changed.
//
// Undo and redo only take back your own changes: each step is replayed as a
// three-way merge against the current chart, so a collaborator's edits made
// since stay put.

import { useCallback, useEffect, useRef, useState } from 'react';
import { canon } from '@ifakepro/lib/chart';
import { api, ApiError } from '@ifakepro/lib/client';
import { diffCharts } from '@ifakepro/lib/diff';
import { type Doc, mergeDocs } from '@ifakepro/lib/merge';
import type { Person, PollResult, PresenceDTO } from '@ifakepro/lib/types';

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'offline' | 'readonly';

interface Server {
  revision: number;
  doc: Doc;
}

const SAVE_DELAY = 800;
const MAX_UNDO = 200;

export function useSongSync(opts: {
  songId: string;
  initial: Doc;
  revision: number;
  canEdit: boolean;
  /** The bar the user is on, reported to others. */
  barId: string | null;
  onConflict: (by: Person, count: number) => void;
  /** Someone else's save came in: who, the agent if it was theirs (Muse), and the numbers of the bars it changed. */
  onRemote: (by: Person | null, agent: string | null, bars: number[]) => void;
  onDeleted: () => void;
}) {
  const { songId, canEdit } = opts;
  const [doc, setDocState] = useState<Doc>(opts.initial);
  const [status, setStatus] = useState<SaveStatus>(canEdit ? 'saved' : 'readonly');
  const [presence, setPresence] = useState<PresenceDTO[]>([]);
  const [commentsStamp, setCommentsStamp] = useState('');
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [revision, setRevision] = useState(opts.revision);
  const [undoDepth, setUndoDepth] = useState({ undo: 0, redo: 0 });

  const docRef = useRef(doc);
  const server = useRef<Server>({ revision: opts.revision, doc: opts.initial });
  const inFlight = useRef(false);
  const timer = useRef<number | null>(null);
  const retry = useRef(0);
  type Step = { before: Doc; after: Doc; key?: string; t?: number };
  const undo = useRef<Step[]>([]);
  const redo = useRef<Step[]>([]);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const dirty = () => canon(docRef.current) !== canon(server.current.doc);

  const show = (next: Doc) => {
    docRef.current = next;
    setDocState(next);
  };

  /** Light up the bars that changed; returns their numbers. */
  const flashBars = (before: Doc, after: Doc): number[] => {
    const d = diffCharts(before.chart, after.chart);
    if (!d.changed.size) return [];
    setFlash(d.changed);
    window.setTimeout(() => setFlash(new Set()), 2500);
    return after.chart.bars.flatMap((b, i) => (d.changed.has(b.id) ? [i + 1] : []));
  };

  const save = useCallback(async () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    if (inFlight.current || !optsRef.current.canEdit) return;
    if (!dirty()) {
      setStatus('saved');
      return;
    }
    inFlight.current = true;
    setStatus('saving');
    const sent = docRef.current;
    const base = server.current;
    try {
      const r = await api<{ revision: number }>(`/songs/${songId}`, {
        method: 'PATCH',
        body: { baseRevision: base.revision, meta: sent.meta, chart: sent.chart },
      });
      server.current = { revision: r.revision, doc: sent };
      setRevision(r.revision);
      retry.current = 0;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const theirs = (e.body as { song: { meta: Doc['meta']; chart: Doc['chart']; revision: number; updatedBy: Person } }).song;
        const theirDoc = { meta: theirs.meta, chart: theirs.chart };
        const merged = mergeDocs(base.doc, docRef.current, theirDoc);
        server.current = { revision: theirs.revision, doc: theirDoc };
        setRevision(theirs.revision);
        flashBars(docRef.current, merged.value);
        show(merged.value);
        if (merged.conflicts.length) optsRef.current.onConflict(theirs.updatedBy, merged.conflicts.length);
        retry.current = 0;
      } else if (e instanceof ApiError && (e.status === 403 || e.status === 410)) {
        setStatus('readonly');
        inFlight.current = false;
        if (e.status === 410) optsRef.current.onDeleted();
        return;
      } else {
        // Offline or a server error: keep the edits, try again with backoff.
        retry.current = Math.min(retry.current + 1, 5);
        setStatus('offline');
        inFlight.current = false;
        timer.current = window.setTimeout(save, 1000 * 2 ** retry.current);
        return;
      }
    }
    inFlight.current = false;
    if (dirty()) timer.current = window.setTimeout(save, 50);
    else setStatus('saved');
  }, [songId]);

  const schedule = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    setStatus('pending');
    timer.current = window.setTimeout(save, SAVE_DELAY);
  }, [save]);

  /**
   * Apply an edit. Edits sharing a `coalesce` key within a couple of seconds
   * (a drag, typing a chord letter by letter) are one undo step.
   */
  const change = useCallback(
    (fn: (d: Doc) => Doc, opts?: { coalesce?: string }) => {
      if (!optsRef.current.canEdit) return;
      const before = docRef.current;
      const after = fn(before);
      if (canon(after) === canon(before)) return;
      const last = undo.current[undo.current.length - 1];
      if (opts?.coalesce && last?.key === opts.coalesce && Date.now() - (last.t ?? 0) < 2500 && !redo.current.length) {
        last.after = after;
        last.t = Date.now();
        show(after);
        schedule();
        return;
      }
      undo.current.push({ before, after, key: opts?.coalesce, t: Date.now() });
      if (undo.current.length > MAX_UNDO) undo.current.shift();
      redo.current = [];
      setUndoDepth({ undo: undo.current.length, redo: 0 });
      show(after);
      schedule();
    },
    [schedule],
  );

  const step = useCallback(
    (from: typeof undo, to: typeof undo, back: boolean) => {
      const entry = from.current.pop();
      if (!entry) return;
      const target = back ? entry.before : entry.after;
      const base = back ? entry.after : entry.before;
      const merged = mergeDocs(base, target, docRef.current).value;
      to.current.push(entry);
      setUndoDepth({ undo: undo.current.length, redo: redo.current.length });
      show(merged);
      schedule();
    },
    [schedule],
  );
  const doUndo = useCallback(() => step(undo, redo, true), [step]);
  const doRedo = useCallback(() => step(redo, undo, false), [step]);

  // Poll.
  useEffect(() => {
    let stop = false;
    let t: number;
    const tick = async () => {
      if (stop) return;
      const o = optsRef.current;
      if (document.visibilityState === 'visible' && !inFlight.current) {
        try {
          const q = new URLSearchParams({ rev: String(server.current.revision) });
          if (o.barId) q.set('bar', o.barId);
          if (o.canEdit) q.set('editing', '1');
          const r = await api<PollResult>(`/songs/${songId}/poll?${q}`);
          if (stop) return;
          setPresence(r.presence);
          setCommentsStamp(r.commentsStamp);
          if (r.deleted) o.onDeleted();
          if (r.song && r.song.revision > server.current.revision && !inFlight.current) {
            const theirs = { meta: r.song.meta, chart: r.song.chart };
            const next = dirty() ? mergeDocs(server.current.doc, docRef.current, theirs).value : theirs;
            server.current = { revision: r.song.revision, doc: theirs };
            setRevision(r.song.revision);
            const bars = flashBars(docRef.current, next);
            show(next);
            o.onRemote(r.song.updatedBy, r.song.agent ?? null, bars);
            if (dirty()) schedule();
          }
          setStatus((st) => (st === 'offline' && !dirty() ? 'saved' : st));
        } catch {
          /* the next tick will try again */
        }
      }
      t = window.setTimeout(tick, o.canEdit ? 3000 : 8000);
    };
    t = window.setTimeout(tick, 1200);
    return () => {
      stop = true;
      window.clearTimeout(t);
    };
  }, [songId, schedule]); // eslint-disable-line react-hooks/exhaustive-deps

  // Don't lose unsaved edits on the way out.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (inFlight.current || dirty()) {
        e.preventDefault();
        save();
      }
    };
    const hide = () => {
      if (document.visibilityState === 'hidden' && dirty()) save();
    };
    window.addEventListener('beforeunload', warn);
    document.addEventListener('visibilitychange', hide);
    return () => {
      window.removeEventListener('beforeunload', warn);
      document.removeEventListener('visibilitychange', hide);
      if (dirty()) save();
    };
  }, [save]);

  useEffect(() => {
    setStatus(canEdit ? (dirty() ? 'pending' : 'saved') : 'readonly');
  }, [canEdit]);

  /** Replace the document from outside (a restore): no undo step, and the server already has it. */
  const reload = useCallback((d: Doc, rev: number) => {
    server.current = { revision: rev, doc: d };
    setRevision(rev);
    undo.current = [];
    redo.current = [];
    setUndoDepth({ undo: 0, redo: 0 });
    show(d);
    setStatus(optsRef.current.canEdit ? 'saved' : 'readonly');
  }, []);

  return {
    doc,
    change,
    undo: doUndo,
    redo: doRedo,
    canUndo: undoDepth.undo > 0,
    canRedo: undoDepth.redo > 0,
    status,
    revision,
    presence,
    commentsStamp,
    flash,
    saveNow: save,
    reload,
  };
}
