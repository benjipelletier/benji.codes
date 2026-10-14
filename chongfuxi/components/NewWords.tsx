"use client";

// New words: when a batch of words joins the deck (from an Anki sync), the
// owner sees it once, over whatever screen is open. What came, what it did
// (sentences unlocked, cards to learn, the deck's size), and the choice to
// keep it or undo it. Undo is there until one of its words is answered.

import { useState } from "react";
import type { Addition } from "@chongfuxi/lib/api";
import { send } from "@chongfuxi/lib/client";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import { Highlighted, ago, fmt, message } from "./shared";

const SOURCE = { anki: "Anki" } as Record<string, string>;

export function NewWordsScreen({
  addition,
  onDone,
  canWrite = true,
}: {
  addition: Addition;
  onDone: () => void;
  canWrite?: boolean;
}) {
  const [busy, setBusy] = useState<"keep" | "undo" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const a = addition;
  const n = a.words.length;
  const canUndo = canWrite && !a.undone && a.answered.length === 0;
  // Opened again from the sync log: it has been dealt with, so the main button just closes.
  const settled = a.seen || a.undone || !canWrite;

  const act = async (action: "seen" | "undo") => {
    setBusy(action === "seen" ? "keep" : "undo");
    setError(null);
    try {
      await send(`additions/${a.id}`, { action });
      onDone();
    } catch (e) {
      setError(message(e));
      setBusy(null);
    }
  };

  return (
    <div className="cf-arrival-back">
      <div className="cf-arrival" role="dialog" aria-modal="true" aria-labelledby="cf-arrival-title">
        <p className="cf-arrival-from">
          From {SOURCE[a.source] ?? a.source}, {ago(a.at)}
          {a.undone && <span className="cf-tag cf-arrival-undone">undone</span>}
        </p>
        <h2 id="cf-arrival-title" className="cf-arrival-title">
          <b>+{fmt(n)}</b> {n === 1 ? "new word" : "new words"}
        </h2>

        <dl className="cf-arrival-stats">
          <div>
            <dt>Words in the deck</dt>
            <dd>{fmt(a.deck)}</dd>
          </div>
          <div className={a.unlocked ? "is-up" : undefined}>
            <dt>Sentences unlocked</dt>
            <dd>{a.unlocked ? `+${fmt(a.unlocked)}` : "0"}</dd>
          </div>
          <div>
            <dt>New Read cards</dt>
            <dd>{fmt(n)}</dd>
          </div>
        </dl>

        <ul className="cf-arrival-words">
          {a.words.map((w) => (
            <li key={w.word}>
              <span className="cf-arrival-zh">{w.word}</span>
              <span className="cf-arrival-what">
                <span className="cf-arrival-py">{w.pinyin ? displayPinyin(w.pinyin) : "no reading on file"}</span>
                <span className="cf-arrival-gloss">{w.gloss ?? "No definition on file."}</span>
                <span className="cf-arrival-tags">
                  {w.hsk.old && <span className={`cf-tag cf-hsk cf-level is-l${w.hsk.old}`}>HSK {w.hsk.old}</span>}
                  {w.hsk.v3 && (
                    <span className={`cf-tag cf-hsk cf-level is-l${w.hsk.v3.split("-")[0]}`}>
                      HSK 3.0: {w.hsk.v3.replace("-", "–")}
                    </span>
                  )}
                  {!w.hsk.old && !w.hsk.v3 && <span className="cf-tag cf-hsk is-none">not HSK</span>}
                  {w.was === "listed" && <span className="cf-tag">was on a list</span>}
                  {w.was === "name" && <span className="cf-tag">was a name</span>}
                  <span className="cf-arrival-in">
                    in {fmt(w.readable)} readable {w.readable === 1 ? "sentence" : "sentences"}
                  </span>
                </span>
              </span>
            </li>
          ))}
        </ul>

        {a.examples.length > 0 && (
          <section className="cf-arrival-sentences">
            <h3>Now readable</h3>
            <ul>
              {a.examples.map((s) => (
                <li key={s.zh}>
                  <p className="cf-zh">{s.by ? <Highlighted text={s.zh} word={s.by} /> : s.zh}</p>
                  {s.en && <p className="cf-en">{s.en}</p>}
                </li>
              ))}
            </ul>
            {a.unlocked > a.examples.length && <p className="cf-muted">and {fmt(a.unlocked - a.examples.length)} more</p>}
          </section>
        )}

        {error && <p className="cf-error">{error}</p>}
        {canWrite && !a.undone && a.answered.length > 0 && (
          <p className="cf-muted cf-arrival-note">Can't undo: {a.answered.join(" ")} already answered.</p>
        )}

        <div className="cf-arrival-actions">
          {!a.undone && canWrite && (
            <button
              className={`cf-answer-btn cf-answer-ghost cf-arrival-undo${confirming ? " is-confirming" : ""}`}
              disabled={!canUndo || busy !== null}
              onClick={() => (confirming ? act("undo") : setConfirming(true))}
            >
              {busy === "undo" ? "Undoing…" : confirming ? "Tap again to undo" : "Undo"}
            </button>
          )}
          <button
            className="cf-answer-btn cf-answer-good"
            disabled={busy !== null}
            onClick={() => (settled ? onDone() : act("seen"))}
          >
            {settled ? "Close" : busy === "keep" ? "Keeping…" : "Keep"}
          </button>
        </div>
      </div>
    </div>
  );
}
