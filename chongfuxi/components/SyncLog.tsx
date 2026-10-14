"use client";

// Every Anki sync, newest first, and what it did to the corpus: words added,
// sentences unlocked, notes already known or unreadable. A sync that added
// words opens its new-words screen, where it can still be undone.

import { useCallback, useEffect, useState } from "react";
import type { Addition, AnkiSync } from "@chongfuxi/lib/api";
import { get } from "@chongfuxi/lib/client";
import { NewWordsScreen } from "./NewWords";
import { ago, fmt, message, type Shell } from "./shared";

/** "26.05,e64c6b1a,android" → "AnkiDroid 26.05". */
function clientName(client: string | null): string {
  if (!client) return "Anki";
  const [version, , platform] = client.split(",");
  return `${platform === "android" ? "AnkiDroid" : platform === "ios" ? "AnkiMobile" : "Anki"} ${version}`;
}

const clock = (at: number) =>
  new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;

/** What a sync did, in a line. */
function effect(s: AnkiSync): { text: string; tone: "up" | "flat" | "down" | "wait" } {
  if (s.error) return { text: `Couldn't read the upload: ${s.error}`, tone: "down" };
  if (!s.processed) return { text: "Waiting: its notes are added on the next sync", tone: "wait" };
  if (s.wordsAdded + s.known + s.unreadable === 0 && s.newNotes > 0) return { text: "Its new notes went in with a later sync", tone: "flat" };
  if (s.wordsAdded > 0) {
    const parts = [`+${plural(s.wordsAdded, "word")}`];
    parts.push(s.unlocked ? `${plural(s.unlocked, "sentence")} unlocked` : "no sentences unlocked");
    return { text: parts.join(", "), tone: s.undone ? "flat" : "up" };
  }
  const why = [
    s.known && `${plural(s.known, "word")} already known`,
    s.unreadable && `${plural(s.unreadable, "note")} without a word`,
  ].filter(Boolean);
  return { text: why.length ? `No new words: ${why.join(", ")}` : "No new notes", tone: "flat" };
}

export function SyncLog({ shell }: { shell: Shell }) {
  const [syncs, setSyncs] = useState<AnkiSync[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Addition | null>(null);
  const [opening, setOpening] = useState<number | null>(null);

  const load = useCallback(() => {
    get<{ syncs: AnkiSync[] }>("anki-log")
      .then((r) => setSyncs(r.syncs))
      .catch((e) => setError(message(e)));
  }, []);
  useEffect(load, [load]);

  const show = async (id: number) => {
    setOpening(id);
    try {
      const r = await get<{ additions: Addition[] }>("additions", { id });
      if (r.additions[0]) setOpen(r.additions[0]);
    } catch (e) {
      setError(message(e));
    } finally {
      setOpening(null);
    }
  };

  return (
    <section className="cf-section">
      <h2 className="cf-h2">Anki syncs</h2>
      <p className="cf-lede">
        Words added in Pleco reach the deck through AnkiDroid: each sync, and what it did. Tap one that added words to see them,
        or undo it.
      </p>
      {error && <p className="cf-error">{error}</p>}
      {syncs === null && !error && <p className="cf-muted">Loading…</p>}
      {syncs?.length === 0 && <p className="cf-muted">No syncs yet.</p>}
      {syncs && syncs.length > 0 && (
        <ul className="cf-synclog">
          {syncs.map((s) => {
            const e = effect(s);
            const body = (
              <>
                <span className={`cf-synclog-dot is-${e.tone}`} aria-hidden="true" />
                <span className="cf-synclog-main">
                  <span className="cf-synclog-effect">
                    {e.text}
                    {s.undone && <span className="cf-tag">undone</span>}
                  </span>
                  <span className="cf-synclog-meta">
                    {clock(s.at)} ({ago(s.at)}), {clientName(s.client)}, {plural(s.notes, "note")}
                    {s.newNotes > 0 && ` (${fmt(s.newNotes)} new)`}, {fmt(Math.round(s.bytes / 1024))} KB
                  </span>
                </span>
                {s.additionId !== null && (
                  <span className="cf-synclog-go" aria-hidden="true">
                    {opening === s.additionId ? "…" : "›"}
                  </span>
                )}
              </>
            );
            return (
              <li key={s.id}>
                {s.additionId !== null ? (
                  <button className="cf-synclog-row" onClick={() => void show(s.additionId!)}>
                    {body}
                  </button>
                ) : (
                  <div className="cf-synclog-row">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {open && (
        <NewWordsScreen
          addition={open}
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
