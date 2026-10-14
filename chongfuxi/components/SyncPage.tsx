"use client";

// One Anki sync, in full, like a commit: its counts as a diffstat, each note
// it handled as a line (+ added, ~ already known, ! no word in it, − undone),
// and, if it added words, what they brought, with Keep or Undo. Opens by
// itself for a new sync that added words; any sync's opens from the log.

import { useEffect, useState } from "react";
import type { AnkiSync, AnkiSyncDetail } from "@chongfuxi/lib/api";
import { get, send } from "@chongfuxi/lib/client";
import { AdditionDetails } from "./NewWords";
import { ago, fmt, message } from "./shared";

/** "26.05,e64c6b1a,android" → "AnkiDroid 26.05". */
export function clientName(client: string | null): string {
  if (!client) return "Anki";
  const [version, , platform] = client.split(",");
  return `${platform === "android" ? "AnkiDroid" : platform === "ios" ? "AnkiMobile" : "Anki"} ${version}`;
}

export const clock = (at: number) =>
  new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** A sync's counts as a commit's: + words added, ~ already known, ! no word, and sentences unlocked. */
export function DiffStat({ s }: { s: AnkiSync }) {
  const added = s.undone ? 0 : s.wordsAdded;
  const total = s.wordsAdded + s.known + s.unreadable;
  // Five squares, like GitHub's: added, known, no word, in proportion; the rest empty.
  const squares: string[] = [];
  if (total > 0) {
    const share = (n: number) => Math.round((5 * n) / total);
    const a = Math.min(5, added ? Math.max(1, share(added)) : 0);
    const k = Math.min(5 - a, s.known ? Math.max(1, share(s.known)) : 0);
    const u = Math.min(5 - a - k, s.unreadable ? Math.max(1, share(s.unreadable)) : 0);
    squares.push(...Array(a).fill("is-add"), ...Array(k).fill("is-known"), ...Array(u).fill("is-bad"));
  }
  while (squares.length < 5) squares.push("");
  return (
    <span className="cf-diffstat">
      {s.wordsAdded > 0 && <b className={s.undone ? "is-gone" : "is-add"}>+{fmt(s.wordsAdded)}</b>}
      {s.known > 0 && <b className="is-known">~{fmt(s.known)}</b>}
      {s.unreadable > 0 && <b className="is-bad">!{fmt(s.unreadable)}</b>}
      {s.unlocked > 0 && !s.undone && <b className="is-unlock">↑{fmt(s.unlocked)}</b>}
      {total === 0 && <b className="is-none">±0</b>}
      <span className="cf-diffstat-squares" aria-hidden="true">
        {squares.map((c, i) => (
          <i key={i} className={c} />
        ))}
      </span>
    </span>
  );
}

const LINE = {
  added: { mark: "+", label: "added to the deck" },
  known: { mark: "~", label: "already in your deck" },
  unreadable: { mark: "!", label: "no word found in it" },
  undone: { mark: "−", label: "added, then undone" },
  removed: { mark: "−", label: "added, later removed" },
} as const;

export function SyncPage({ syncId, canWrite, onDone }: { syncId: number; canWrite: boolean; onDone: () => void }) {
  const [d, setD] = useState<AnkiSyncDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"keep" | "undo" | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    get<AnkiSyncDetail>(`anki-log/${syncId}`)
      .then(setD)
      .catch((e) => setError(message(e)));
  }, [syncId]);

  const a = d?.addition ?? null;
  const canUndo = canWrite && a !== null && !a.undone && a.answered.length === 0;
  const fresh = canWrite && d !== null && !d.sync.seen;

  /** Close; a sync seen for the first time is marked seen, which keeps what it added. */
  const close = async () => {
    if (!fresh) return onDone();
    setBusy("keep");
    try {
      await send(`anki-log/${syncId}`, { action: "seen" });
      onDone();
    } catch (e) {
      setError(message(e));
      setBusy(null);
    }
  };
  const undo = async () => {
    if (!a) return;
    setBusy("undo");
    setError(null);
    try {
      await send(`additions/${a.id}`, { action: "undo" });
      if (fresh) await send(`anki-log/${syncId}`, { action: "seen" });
      onDone();
    } catch (e) {
      setError(message(e));
      setBusy(null);
    }
  };

  return (
    <div className="cf-arrival-back" onClick={() => !fresh && onDone()}>
      <div
        className="cf-arrival"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cf-sync-title"
        onClick={(e) => e.stopPropagation()}
      >
        {!d && !error && <p className="cf-muted">Loading the sync…</p>}
        {d && (
          <>
            <p className="cf-arrival-from">
              {clientName(d.sync.client)}, {clock(d.sync.at)} ({ago(d.sync.at)})
              {d.sync.undone && <span className="cf-tag cf-arrival-undone">undone</span>}
            </p>
            <h2 id="cf-sync-title" className="cf-arrival-title">
              {d.sync.wordsAdded > 0 ? (
                <>
                  <b>+{fmt(d.sync.wordsAdded)}</b> {d.sync.wordsAdded === 1 ? "new word" : "new words"}
                </>
              ) : (
                "Nothing new"
              )}
            </h2>
            <p className="cf-sync-stat">
              <DiffStat s={d.sync} />
              <span className="cf-sync-size">
                {fmt(d.sync.notes)} {d.sync.notes === 1 ? "note" : "notes"} in AnkiDroid, {fmt(Math.round(d.sync.bytes / 1024))}{" "}
                KB
              </span>
            </p>

            {d.sync.error && <p className="cf-error">Couldn&apos;t read the upload: {d.sync.error}</p>}
            {!d.sync.processed && !d.sync.error && (
              <p className="cf-muted">Its notes are still being looked at. Open it again in a moment.</p>
            )}

            {d.notes.length > 0 ? (
              <ul className="cf-diff">
                {d.notes.map((n, i) => (
                  <li key={i} className={`is-${n.outcome}`}>
                    <span className="cf-diff-mark" aria-hidden="true">
                      {LINE[n.outcome].mark}
                    </span>
                    <span className="cf-diff-word">{n.text || "(empty note)"}</span>
                    <span className="cf-diff-label">{LINE[n.outcome].label}</span>
                  </li>
                ))}
              </ul>
            ) : (
              d.sync.processed && (
                <p className="cf-muted">No notes it hadn&apos;t seen before: everything in AnkiDroid was already here.</p>
              )
            )}

            {a && !a.undone && <AdditionDetails addition={a} />}
          </>
        )}

        {error && <p className="cf-error">{error}</p>}
        {a && canWrite && !a.undone && a.answered.length > 0 && (
          <p className="cf-muted cf-arrival-note">Can&apos;t undo: {a.answered.join(" ")} already answered.</p>
        )}

        <div className="cf-arrival-actions">
          {a && !a.undone && canWrite && (
            <button
              className={`cf-answer-btn cf-answer-ghost cf-arrival-undo${confirming ? " is-confirming" : ""}`}
              disabled={!canUndo || busy !== null}
              onClick={() => (confirming ? void undo() : setConfirming(true))}
            >
              {busy === "undo" ? "Undoing…" : confirming ? "Tap again to undo" : "Undo"}
            </button>
          )}
          <button className="cf-answer-btn cf-answer-good" disabled={busy !== null} onClick={() => void close()}>
            {busy === "keep" ? "Keeping…" : fresh && a && !a.undone ? "Keep" : "Close"}
          </button>
        </div>
      </div>
    </div>
  );
}
