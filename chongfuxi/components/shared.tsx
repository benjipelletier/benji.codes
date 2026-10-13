"use client";

// Pieces every panel uses: the API the shell hands down, effect chips, and the
// preview-then-act controls for a single word.

import { useEffect, useState } from "react";
import type { ChongEvent, Effects, MachineState, MarkReason } from "@chongfuxi/lib/machine";
import type { Text } from "@chongfuxi/lib/corpus";

export interface AppApi {
  /** The state being shown — the present, or a past one when time travelling. */
  state: MachineState;
  /** True while looking at a past state: nothing can be changed from there. */
  readOnly: boolean;
  /** What an event would do to the present state. Synchronous and ~100ms. */
  preview(event: ChongEvent): Effects;
  dispatch(event: ChongEvent): Promise<void>;
}

export function plecoHref(word: string): string {
  return `plecoapi://x-callback-url/s?q=${encodeURIComponent(word)}`;
}

const fmt = (n: number) => n.toLocaleString("en-US");

/** Signed deltas of an effect, the way the log and every preview show them. */
export function EffectChips({ fx, empty = "no change" }: { fx: Effects | null; empty?: string }) {
  if (!fx) return null;
  const chips: Array<{ label: string; tone: "up" | "down" }> = [];
  if (fx.wordsAdded.length) chips.push({ label: `+${fmt(fx.wordsAdded.length)} known`, tone: "up" });
  if (fx.wordsRemoved.length) chips.push({ label: `−${fmt(fx.wordsRemoved.length)} known`, tone: "down" });
  if (fx.unlocked.length) chips.push({ label: `+${fmt(fx.unlocked.length)} readable`, tone: "up" });
  if (fx.relocked.length) chips.push({ label: `−${fmt(fx.relocked.length)} readable`, tone: "down" });
  if (!chips.length) return <span className="cf-chip cf-chip-none">{empty}</span>;
  return (
    <span className="cf-chips">
      {chips.map((c) => (
        <span key={c.label} className={`cf-chip cf-chip-${c.tone}`}>
          {c.label}
        </span>
      ))}
    </span>
  );
}

/** A preview worked out after paint, so the tap that asks for it feels instant. */
export function usePreview(api: AppApi, event: ChongEvent | null): Effects | null {
  const [fx, setFx] = useState<Effects | null>(null);
  const key = event ? JSON.stringify({ ...event, at: 0 }) : "";
  useEffect(() => {
    setFx(null);
    if (!event || api.readOnly) return;
    const handle = window.setTimeout(() => setFx(api.preview(event)), 16);
    return () => window.clearTimeout(handle);
    // The event is identified by its key, and a preview is stale once state moves.
  }, [key, api.state]);
  return fx;
}

/** A sentence with one word picked out, where it appears as written. */
export function Highlighted({ text, word }: { text: string; word: string }) {
  const at = word ? text.indexOf(word) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="cf-mark">{word}</mark>
      {text.slice(at + word.length)}
    </>
  );
}

export function textsById(state: MachineState, ids: number[], limit: number): Text[] {
  if (!state.corpus) return [];
  const wanted = new Set(ids.slice(0, limit * 4));
  const out: Text[] = [];
  for (const t of state.corpus.texts) {
    if (wanted.has(t.id)) out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Everything you can do to one word, each with what it would do first.
 * Marking known and marking as a name unlock the same texts; they differ in
 * what they say about the word, which the log keeps.
 */
export function WordActions({ api, word }: { api: AppApi; word: string }) {
  const marked: MarkReason | undefined = api.state.marks.get(word);
  const event: ChongEvent = marked
    ? { kind: "unmark", at: Date.now(), word }
    : { kind: "mark", at: Date.now(), word, as: "known" };
  const fx = usePreview(api, event);
  const [busy, setBusy] = useState(false);
  const act = async (e: ChongEvent) => {
    setBusy(true);
    try {
      await api.dispatch(e);
    } finally {
      setBusy(false);
    }
  };
  const examples = fx ? textsById(api.state, marked ? fx.relocked : fx.unlocked, 3) : [];

  return (
    <div className="cf-actions">
      <div className="cf-actions-preview">
        {api.readOnly ? (
          <span className="cf-muted">Viewing a past state — return to now to act.</span>
        ) : fx ? (
          <>
            <span className="cf-muted">{marked ? "Unmarking would:" : "Knowing it would:"}</span>{" "}
            <EffectChips fx={fx} />
          </>
        ) : (
          <span className="cf-muted">Working out what it would change…</span>
        )}
      </div>
      {examples.length > 0 && (
        <ul className="cf-examples">
          {examples.map((t) => (
            <li key={t.id}>
              <span className="cf-zh">
                <Highlighted text={t.zh} word={word} />
              </span>
              {t.en && <span className="cf-en">{t.en}</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="cf-buttons">
        <a className="cf-btn cf-btn-ghost" href={plecoHref(word)}>
          Open in Pleco
        </a>
        {!api.readOnly &&
          (marked ? (
            <button className="cf-btn" disabled={busy} onClick={() => act(event)}>
              Unmark ({marked === "name" ? "name" : "known"})
            </button>
          ) : (
            <>
              <button
                className="cf-btn cf-btn-ghost"
                disabled={busy}
                onClick={() => act({ kind: "mark", at: Date.now(), word, as: "name" })}
              >
                It&apos;s a name
              </button>
              <button
                className="cf-btn"
                disabled={busy}
                onClick={() => act({ kind: "mark", at: Date.now(), word, as: "known" })}
              >
                I know it
              </button>
            </>
          ))}
      </div>
    </div>
  );
}
