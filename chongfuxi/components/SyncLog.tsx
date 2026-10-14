"use client";

// Every Anki sync, newest first, like a commit log: when, from which client,
// and what it did to the corpus as a diffstat (+ words added, ~ already
// known, ! notes with no word, ↑ sentences unlocked). Any line opens the
// sync's page.

import { useCallback, useEffect, useState } from "react";
import type { AnkiSync } from "@chongfuxi/lib/api";
import { get } from "@chongfuxi/lib/client";
import { DiffStat, SyncPage, clientName, clock } from "./SyncPage";
import { ago, fmt, message, type Shell } from "./shared";

/** Syncs listed at first, and how many more each "Show more" adds. */
const FIRST = 5;
const MORE = 20;

export function SyncLog({ shell }: { shell: Shell }) {
  const [syncs, setSyncs] = useState<AnkiSync[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  // The latest few; more on asking.
  const [shown, setShown] = useState(FIRST);

  const load = useCallback(() => {
    get<{ syncs: AnkiSync[] }>("anki-log")
      .then((r) => setSyncs(r.syncs))
      .catch((e) => setError(message(e)));
  }, []);
  useEffect(load, [load]);

  return (
    <section className="cf-section">
      <h2 className="cf-h2">Anki syncs</h2>
      <p className="cf-lede">
        Words added in Pleco reach the deck through AnkiDroid. Each sync and what it did: <b className="cf-diff-key is-add">+</b>{" "}
        added, <b className="cf-diff-key is-known">~</b> already known, <b className="cf-diff-key is-bad">!</b> no word in the
        note, <b className="cf-diff-key is-unlock">↑</b> sentences unlocked.
      </p>
      {error && <p className="cf-error">{error}</p>}
      {syncs === null && !error && <p className="cf-muted">Loading…</p>}
      {syncs?.length === 0 && <p className="cf-muted">No syncs yet.</p>}
      {syncs && syncs.length > 0 && (
        <ul className="cf-synclog">
          {syncs.slice(0, shown).map((s) => (
            <li key={s.id}>
              <button className="cf-synclog-row" onClick={() => setOpen(s.id)}>
                <span className="cf-synclog-main">
                  <span className="cf-synclog-effect">
                    {s.error ? (
                      <b className="cf-diff-key is-bad">failed</b>
                    ) : s.processed ? (
                      <DiffStat s={s} />
                    ) : (
                      <span className="cf-muted">waiting</span>
                    )}
                    {s.undone && <span className="cf-tag">undone</span>}
                  </span>
                  <span className="cf-synclog-meta">
                    {clock(s.at)} ({ago(s.at)}), {clientName(s.client)}, {fmt(s.notes)} {s.notes === 1 ? "note" : "notes"}
                    {s.newNotes > 0 && ` (${fmt(s.newNotes)} new)`}
                  </span>
                </span>
                <span className="cf-synclog-go" aria-hidden="true">
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {syncs && syncs.length > shown && (
        <button className="cf-more" onClick={() => setShown((n) => n + MORE)}>
          Show more ({fmt(syncs.length - shown)} older)
        </button>
      )}
      {open !== null && (
        <SyncPage
          syncId={open}
          canWrite={shell.canWrite}
          onDone={() => {
            setOpen(null);
            load();
            shell.refresh();
          }}
        />
      )}
    </section>
  );
}
