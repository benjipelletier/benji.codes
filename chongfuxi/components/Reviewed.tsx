"use client";

// The answers of this session, to look back over: each card face up again,
// with the answer given and when it is back. The latest can be undone, as from
// the receipt; earlier ones only looked at (changing one would mean replaying
// every later answer that touched the same cards).

import { useState } from "react";
import type { SessionCard } from "@chongfuxi/lib/api";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import type { Grade } from "@chongfuxi/lib/schedule";
import { mainSenses } from "@chongfuxi/lib/senses";
import { AiPill, PlecoTile, Sheet, fmt, span } from "./shared";

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
  onUndo,
  undoing,
  onClose,
}: {
  log: Answered[];
  /** Take back the latest answer, when it can be. */
  onUndo?: () => void;
  undoing: boolean;
  onClose: () => void;
}) {
  const [open, setOpen] = useState<string | null>(log.length ? log[log.length - 1].id : null);
  const got = log.filter((a) => a.grade === "good").length;
  return (
    <Sheet label="This session's answers" onClose={onClose}>
      <header className="cf-sheet-head">
        <h2 className="cf-answered-h">This session</h2>
        <p className="cf-muted">
          {fmt(log.length)} answered · {fmt(got)} got it · {fmt(log.length - got)} forgot. Tap one to see it again.
        </p>
      </header>
      <ol className="cf-answered">
        {[...log].reverse().map((a) => (
          <AnsweredRow
            key={a.id}
            a={a}
            open={open === a.id}
            onToggle={() => setOpen(open === a.id ? null : a.id)}
            onUndo={a.id === log[log.length - 1].id ? onUndo : undefined}
            undoing={undoing}
          />
        ))}
      </ol>
    </Sheet>
  );
}

function AnsweredRow({
  a,
  open,
  onToggle,
  onUndo,
  undoing,
}: {
  a: Answered;
  open: boolean;
  onToggle: () => void;
  onUndo?: () => void;
  undoing: boolean;
}) {
  const word = a.card.word;
  const title = word ? word.word : (a.card.sentence?.zh ?? "Sentence");
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
          <p className="cf-answered-status">
            <span className={`cf-answered-said is-${a.grade}`}>{a.grade === "good" ? "Got it" : "Forgot"}</span> · {comesBack(a.days)}
            {/* Only the latest answer can be taken back: nothing after it depends on it. */}
            {onUndo && (
              <button className="cf-link" onClick={onUndo} disabled={undoing}>
                {undoing ? "Undoing…" : "Undo and answer again"}
              </button>
            )}
          </p>
        </div>
      )}
    </li>
  );
}
