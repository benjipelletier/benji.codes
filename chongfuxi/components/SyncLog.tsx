"use client";

// Every Anki sync, newest first, like a commit log: when, from which client,
// and what it did to the corpus as a diffstat (+ words added, ~ already
// known, ! notes with no word, ↑ sentences unlocked). Any line opens the
// sync's page. A run of syncs that brought nothing (AnkiDroid syncs often)
// folds into one line, opened with a tap.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AnkiSync } from "@chongfuxi/lib/api";
import { get } from "@chongfuxi/lib/client";
import { DiffStat, SyncPage, clientName, clock } from "./SyncPage";
import { ago, fmt, message, type Shell } from "./shared";

/** A sync whose notes were all ones already handled: nothing to say about it. */
const quiet = (s: AnkiSync) => s.processed && !s.error && s.wordsAdded + s.known + s.unreadable === 0;

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();
const hour = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

type Line = { kind: "one"; sync: AnkiSync } | { kind: "quiet"; syncs: AnkiSync[] };

/** The log as lines: each sync, but two or more quiet ones in a row as one. */
function fold(syncs: AnkiSync[]): Line[] {
  const out: Line[] = [];
  for (const s of syncs) {
    const last = out[out.length - 1];
    if (quiet(s) && last?.kind === "quiet") last.syncs.push(s);
    else if (quiet(s) && last?.kind === "one" && quiet(last.sync)) out[out.length - 1] = { kind: "quiet", syncs: [last.sync, s] };
    else out.push({ kind: "one", sync: s });
  }
  return out;
}

/** Lines listed at first, and how many more each "Show more" adds. */
const FIRST = 5;
const MORE = 20;

export function SyncLog({ shell }: { shell: Shell }) {
  const [syncs, setSyncs] = useState<AnkiSync[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  // The latest few; more on asking.
  const [shown, setShown] = useState(FIRST);
  // Folded runs opened, by their newest sync.
  const [unfolded, setUnfolded] = useState<Set<number>>(new Set());

  const load = useCallback(() => {
    get<{ syncs: AnkiSync[] }>("anki-log")
      .then((r) => setSyncs(r.syncs))
      .catch((e) => setError(message(e)));
  }, []);
  useEffect(load, [load]);
  const lines = useMemo(() => (syncs ? fold(syncs) : null), [syncs]);

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
      {lines && lines.length > 0 && (
        <ul className="cf-synclog">
          {lines.slice(0, shown).map((line) => {
            if (line.kind === "one") return <Row key={line.sync.id} s={line.sync} onOpen={setOpen} />;
            const newest = line.syncs[0];
            const oldest = line.syncs[line.syncs.length - 1];
            const isOpen = unfolded.has(newest.id);
            return (
              <li key={`q${newest.id}`} className="cf-synclog-fold">
                <button
                  className="cf-synclog-row"
                  aria-expanded={isOpen}
                  onClick={() =>
                    setUnfolded((u) => {
                      const next = new Set(u);
                      if (isOpen) next.delete(newest.id);
                      else next.add(newest.id);
                      return next;
                    })
                  }
                >
                  <span className="cf-synclog-main">
                    <span className="cf-synclog-effect">
                      <span className="cf-diffstat">
                        <b className="is-none">±0</b>
                        <span className="cf-synclog-times">×{fmt(line.syncs.length)}</span>
                      </span>
                    </span>
                    <span className="cf-synclog-meta">
                      {fmt(line.syncs.length)} syncs that brought nothing new, {clock(oldest.at)} to{" "}
                      {sameDay(oldest.at, newest.at) ? hour(newest.at) : clock(newest.at)} ({ago(newest.at)})
                    </span>
                  </span>
                  <span className={`cf-synclog-go cf-synclog-chev${isOpen ? " is-open" : ""}`} aria-hidden="true">
                    ›
                  </span>
                </button>
                {isOpen && (
                  <ul className="cf-synclog cf-synclog-inner">
                    {line.syncs.map((s) => (
                      <Row key={s.id} s={s} onOpen={setOpen} />
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {lines && lines.length > shown && (
        <button className="cf-more" onClick={() => setShown((n) => n + MORE)}>
          Show more ({fmt(lines.length - shown)} older)
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

/** One sync as a line: its diffstat, when, from what, and how many notes. Opens its page. */
function Row({ s, onOpen }: { s: AnkiSync; onOpen: (id: number) => void }) {
  return (
    <li>
      <button className="cf-synclog-row" onClick={() => onOpen(s.id)}>
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
  );
}
