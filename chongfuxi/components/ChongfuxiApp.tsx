"use client";

// The shell: loads the log, folds it into the present state, and hands every
// panel the same API — the state to show, a preview of any event, and dispatch.
//
// The present state is kept rather than refolded on every action: dispatch
// applies the one new event to it. Looking at a past state replays the log up
// to that event; while you do, everything is read-only.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildCorpus, type Corpus, type Settings } from "@chongfuxi/lib/corpus";
import {
  apply,
  diff,
  EMPTY_STATE,
  preview,
  replay,
  type ChongEvent,
  type Env,
  type MachineState,
} from "@chongfuxi/lib/machine";
import type { PlecoSnapshot } from "@chongfuxi/lib/pleco";
import { openStore, type LoggedEvent, type Store, type StoredImport } from "@chongfuxi/lib/store";
import { ImportPanel, type ImportMeta } from "./ImportPanel";
import { LogPanel } from "./LogPanel";
import { SentencesPanel } from "./SentencesPanel";
import { UnlockPanel } from "./UnlockPanel";
import type { AppApi } from "./shared";

type Tab = "unlock" | "sentences" | "log" | "import";

const TABS: Array<{ key: Tab; label: string; zh: string }> = [
  { key: "unlock", label: "Unlock", zh: "解锁" },
  { key: "sentences", label: "Sentences", zh: "句子" },
  { key: "log", label: "Log", zh: "记录" },
  { key: "import", label: "Import", zh: "导入" },
];

/** Corpora are rebuilt from a snapshot on demand; keep a few around. */
const CORPUS_CACHE = 4;

const fmt = (n: number) => n.toLocaleString("en-US");

export function ChongfuxiApp() {
  const [store, setStore] = useState<Store | null>(null);
  const [log, setLog] = useState<LoggedEvent[]>([]);
  const [imports, setImports] = useState<ImportMeta[]>([]);
  const [present, setPresent] = useState<MachineState>(EMPTY_STATE);
  const [viewSeq, setViewSeq] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("unlock");
  const [error, setError] = useState<string | null>(null);

  const snapshots = useRef(new Map<string, PlecoSnapshot>());
  const presentRef = useRef(present);
  presentRef.current = present;

  const env = useMemo<Env>(() => {
    const cache = new Map<string, Corpus>();
    return {
      corpus(importId: string, settings: Settings) {
        const key = `${importId}:${JSON.stringify(settings)}`;
        let corpus = cache.get(key);
        if (!corpus) {
          const snapshot = snapshots.current.get(importId);
          if (!snapshot) throw new Error(`Import ${importId} is missing from storage.`);
          corpus = buildCorpus(snapshot, settings);
          cache.set(key, corpus);
          if (cache.size > CORPUS_CACHE) cache.delete(cache.keys().next().value!);
        }
        return corpus;
      },
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await openStore();
      const { imports: stored, events } = await s.load();
      if (cancelled) return;
      for (const i of stored) snapshots.current.set(i.id, i.snapshot);
      setImports(stored.map(({ id, at, fileName, sha256 }) => ({ id, at, fileName, sha256 })).sort((a, b) => a.at - b.at));
      setLog(events);
      setPresent(replay(events.map((l) => l.event), env));
      setStore(s);
      if (!events.length) setTab("import");
    })().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [env]);

  const viewed = useMemo(() => {
    if (viewSeq === null) return present;
    return replay(
      log.filter((l) => l.seq <= viewSeq).map((l) => l.event),
      env,
    );
  }, [viewSeq, present, log, env]);

  const dispatch = useCallback(
    async (event: ChongEvent) => {
      if (!store) return;
      const before = presentRef.current;
      const next = apply(before, event, env);
      const logged = await store.appendEvent(event, diff(before.derived, next.derived));
      setLog((l) => [...l, logged]);
      setPresent(next);
    },
    [store, env],
  );

  const api: AppApi = useMemo(
    () => ({
      state: viewed,
      readOnly: viewSeq !== null,
      preview: (event) => preview(presentRef.current, event, env),
      dispatch,
    }),
    [viewed, viewSeq, env, dispatch],
  );

  const previewImport = useCallback(
    (id: string, snapshot: PlecoSnapshot, settings: Settings) => {
      snapshots.current.set(id, snapshot);
      return preview(
        presentRef.current,
        { kind: "import", at: Date.now(), importId: id, fileName: "", settings },
        env,
      );
    },
    [env],
  );

  const commitImport = useCallback(
    async (record: StoredImport, settings: Settings) => {
      if (!store) return;
      await store.putImport(record);
      snapshots.current.set(record.id, record.snapshot);
      setImports((list) => [
        ...list,
        { id: record.id, at: record.at, fileName: record.fileName, sha256: record.sha256 },
      ]);
      await dispatch({ kind: "import", at: record.at, importId: record.id, fileName: record.fileName, settings });
      setTab("unlock");
    },
    [store, dispatch],
  );

  const c = viewed.derived?.counts;
  const currentSnapshot = present.importId ? (snapshots.current.get(present.importId) ?? null) : null;

  return (
    <div className="cfx">
      <header className="cf-top">
        <div className="cf-title">
          <h1>
            重复习 <span className="cf-title-py">chóngfùxí</span>
          </h1>
          {store?.mode === "memory" && (
            <span className="cf-tag" title="This browser won't let the app store data; nothing survives a reload">
              not saved
            </span>
          )}
        </div>
        <div className={`cf-state${viewSeq !== null ? " is-past" : ""}`} aria-label="Current state">
          <div>
            <b>{c ? fmt(c.knownWords) : "—"}</b>
            <span>known</span>
          </div>
          <div>
            <b>{c ? fmt(c.unlocked) : "—"}</b>
            <span>readable</span>
          </div>
          <div>
            <b>{c ? fmt(c.oneAway) : "—"}</b>
            <span>one away</span>
          </div>
          <div>
            <b>{c ? fmt(c.locked) : "—"}</b>
            <span>locked</span>
          </div>
        </div>
        {viewSeq !== null && (
          <div className="cf-past">
            Viewing the state after event {viewSeq}.{" "}
            <button className="cf-link" onClick={() => setViewSeq(null)}>
              Back to now
            </button>
          </div>
        )}
        <nav className="cf-tabs">
          {TABS.map((t) => (
            <button key={t.key} className={`cf-tab${tab === t.key ? " is-on" : ""}`} onClick={() => setTab(t.key)}>
              <span className="cf-tab-zh">{t.zh}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
      </header>

      <main className="cf-main">
        {error && <p className="cf-error">{error}</p>}
        {!store && !error && <p className="cf-muted cf-pad">Loading…</p>}
        {store && tab === "import" && (
          <ImportPanel
            api={api}
            imports={imports}
            currentSnapshot={currentSnapshot}
            previewImport={previewImport}
            commitImport={commitImport}
          />
        )}
        {store && tab !== "import" && !viewed.corpus && tab !== "log" && (
          <div className="cf-panel">
            <p className="cf-muted cf-pad">
              Nothing imported yet.{" "}
              <button className="cf-link" onClick={() => setTab("import")}>
                Import a Pleco backup
              </button>{" "}
              to start.
            </p>
          </div>
        )}
        {store && tab === "unlock" && viewed.corpus && <UnlockPanel api={api} />}
        {store && tab === "sentences" && viewed.corpus && <SentencesPanel api={api} />}
        {store && tab === "log" && <LogPanel api={api} log={log} viewSeq={viewSeq} onView={setViewSeq} />}
      </main>
    </div>
  );
}
