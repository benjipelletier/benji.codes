"use client";

// The answers of this session, to look back over: each card face up again,
// with the answer given, which can be changed (Got it to Forgot or back) as if
// it had been given that way (app/api/chongfuxi/review.ts, `changeAnswer`).

import { useState } from "react";
import type { ReviewResult, SessionCard } from "@chongfuxi/lib/api";
import { ApiError, send } from "@chongfuxi/lib/client";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import * as outbox from "@chongfuxi/lib/outbox";
import type { Grade } from "@chongfuxi/lib/schedule";
import { mainSenses } from "@chongfuxi/lib/senses";
import { AiPill, PlecoTile, Sheet, fmt, message, span } from "./shared";

/** One answer given this session. `days` is when the card is back (null: retired; undefined: not heard yet). */
export interface Answered {
  id: string;
  card: SessionCard;
  grade: Grade;
  days: number | null | undefined;
}

const KIND = { read: "Read", produce: "Recall", sentence: "Sentence" } as const;

const comesBack = (days: number | null | undefined) =>
  days === undefined ? "Still being sent." : days === null ? "Retired." : `Back in ${span(days)}.`;

const back = (days: number | null | undefined) => (days === undefined ? "" : days === null ? "retired" : span(days));

export function ReviewedSheet({
  log,
  canWrite,
  onChanged,
  onClose,
}: {
  log: Answered[];
  canWrite: boolean;
  onChanged: (id: string, grade: Grade, result: ReviewResult) => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState<string | null>(log.length ? log[log.length - 1].id : null);
  const got = log.filter((a) => a.grade === "good").length;
  return (
    <Sheet label="This session's answers" onClose={onClose}>
      <header className="cf-sheet-head">
        <h2 className="cf-answered-h">This session</h2>
        <p className="cf-muted">
          {fmt(log.length)} answered · {fmt(got)} got it · {fmt(log.length - got)} forgot. Tap one to see it again
          {canWrite ? " or change your answer" : ""}.
        </p>
      </header>
      <ol className="cf-answered">
        {[...log].reverse().map((a) => (
          <AnsweredRow key={a.id} a={a} open={open === a.id} onToggle={() => setOpen(open === a.id ? null : a.id)} canWrite={canWrite} onChanged={onChanged} />
        ))}
      </ol>
    </Sheet>
  );
}

function AnsweredRow({
  a,
  open,
  onToggle,
  canWrite,
  onChanged,
}: {
  a: Answered;
  open: boolean;
  onToggle: () => void;
  canWrite: boolean;
  onChanged: (id: string, grade: Grade, result: ReviewResult) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const word = a.card.word;
  const title = word ? word.word : (a.card.sentence?.zh ?? "Sentence");

  const change = async (grade: Grade) => {
    if (busy || grade === a.grade) return;
    // An answer still on the device (offline, or on its way) isn't in the log to change yet.
    if (outbox.waitingCards().includes(a.card.id)) {
      setError("That answer is still being sent. Try again in a moment.");
      return;
    }
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await send<{ result: ReviewResult; replayed: number; dropped: number }>("review/change", { id: a.id, grade });
      onChanged(a.id, grade, r.result);
      setNote(
        `Changed to ${grade === "good" ? "Got it" : "Forgot"}.` +
          (r.dropped ? ` ${r.dropped === 1 ? "A later answer no longer applies and was" : `${r.dropped} later answers no longer apply and were`} dropped.` : ""),
      );
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? e.message : message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={`cf-answered-item is-${a.card.kind}${open ? " is-open" : ""}`}>
      <button className="cf-answered-row" onClick={onToggle} aria-expanded={open}>
        <i className={`cf-bubble${a.grade === "forgot" ? " is-forgot" : ""}`} aria-label={a.grade === "good" ? "Got it" : "Forgot"} />
        <span className={`cf-answered-title${word ? " is-word" : ""}`}>{title}</span>
        <span className="cf-answered-kind">{KIND[a.card.kind]}</span>
        <span className="cf-answered-back">{back(a.days)}</span>
      </button>
      {open && (
        <div className="cf-answered-body">
          {word && (
            <>
              <p className="cf-answered-word">
                <span className="cf-zh">{word.word}</span>
                {word.pinyin && <span className="cf-answered-py">{displayPinyin(word.pinyin)}</span>}
                <PlecoTile word={word.word} inline />
              </p>
              {a.card.meaning ? (
                <p className="cf-answered-senses">{a.card.meaning.gloss}</p>
              ) : (
                <ul className="cf-answered-senses">
                  {mainSenses(word.defs, word.pinyin, { n: 3 }).map((s) => (
                    <li key={s}>
                      {s} <AiPill word={word.word} still />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {a.card.sentence && (
            <div className="cf-answered-sentence">
              <p className="cf-zh">{a.card.sentence.zh}</p>
              {a.card.sentence.en && <p className="cf-muted">{a.card.sentence.en}</p>}
            </div>
          )}
          <div className="cf-answered-grade" role="group" aria-label="Your answer">
            {(["forgot", "good"] as const).map((g) => (
              <button
                key={g}
                className={`cf-answered-g is-${g}${a.grade === g ? " is-on" : ""}`}
                aria-pressed={a.grade === g}
                disabled={busy || !canWrite}
                onClick={() => void change(g)}
              >
                {g === "good" ? "Got it" : "Forgot"}
              </button>
            ))}
          </div>
          <p className="cf-answered-status">{busy ? "Changing it…" : [note, comesBack(a.days)].filter(Boolean).join(" ")}</p>
          {error && <p className="cf-error">{error}</p>}
        </div>
      )}
    </li>
  );
}
