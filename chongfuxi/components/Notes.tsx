"use client";

// The owner's notes after a Forgot, with Muse's answers (app/api/chongfuxi/
// notes.ts): an answer on a word card's back ("You thought 发现"), a note with
// all its answers (the word page and the list), and the full list, newest
// first, on Muse reviews. A note Muse hasn't got to yet says so.

import { useEffect, useState } from "react";
import type { CardNoteAnswer, NoteAnswer, NoteEntry, NotePair } from "@chongfuxi/lib/api";
import { get } from "@chongfuxi/lib/client";
import * as wordpage from "@chongfuxi/lib/wordpage";
import { Highlighted, Loading, fmt, message } from "./shared";

const KIND = { read: "Read", produce: "Recall", sentence: "Sentence" } as const;

const when = (at: number) => new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function WordLink({ word }: { word: string }) {
  return (
    <button className="cf-word-link cf-zh" onClick={() => wordpage.openWordPage(word)}>
      {word}
    </button>
  );
}

function Pair({ pair, mine, theirs }: { pair: NotePair; mine: string | null; theirs: string | null }) {
  return (
    <div className="cf-rescue-pair cf-note-pair">
      <p>
        <span className="cf-zh">{mine ? <Highlighted text={pair.mine.zh} word={mine} /> : pair.mine.zh}</span>
        {pair.mine.en && <span className="cf-muted"> {pair.mine.en}</span>}
      </p>
      <p>
        <span className="cf-zh">{theirs ? <Highlighted text={pair.theirs.zh} word={theirs} /> : pair.theirs.zh}</span>
        {pair.theirs.en && <span className="cf-muted"> {pair.theirs.en}</span>}
      </p>
    </div>
  );
}

/** On a word card's back: what was taken for what, how they differ, and the pair. */
export function CardAnswers({ answers, word }: { answers: CardNoteAnswer[]; word: string }) {
  if (!answers.length) return null;
  return (
    <div className="cf-note-card">
      {answers.map((a, i) => {
        // Shown on the partner's card too: then it was this word that was taken for the other.
        const other = a.word === word ? a.partner : a.word;
        return (
          <div key={i} className="cf-note-answer">
            <p className="cf-note-label">
              {a.word === word ? (other ? <>You thought <span className="cf-zh">{other}</span></> : "Your note") : <>Taken for this on <span className="cf-zh">{a.word}</span></>}
              <span> · {when(a.at)}</span>
            </p>
            <p className="cf-note-diff">{a.difference}</p>
            {a.pair && <Pair pair={a.pair} mine={a.word} theirs={a.partner} />}
          </div>
        );
      })}
    </div>
  );
}

/** A note with every answer to it, newest first; or that Muse hasn't answered it yet. */
export function NoteItem({ n, showWord = true }: { n: NoteEntry; showWord?: boolean }) {
  return (
    <li className="cf-note-item">
      <p className="cf-note-head">
        <span className={`cf-note-kind is-${n.kind}`}>{KIND[n.kind]}</span>
        {showWord && n.word && <WordLink word={n.word} />}
        <span className="cf-muted">{when(n.at)}</span>
      </p>
      {n.sentence && (
        <p className="cf-zh cf-note-sentence">
          {n.word ? <Highlighted text={n.sentence.zh} word={n.word} /> : n.sentence.zh}
        </p>
      )}
      {n.tapped.length > 0 && !n.word && (
        <p className="cf-muted cf-note-tapped">
          Tripped on{" "}
          {n.tapped.map((w, i) => (
            <span key={w}>
              {i > 0 && "、"}
              <WordLink word={w} />
            </span>
          ))}
        </p>
      )}
      <p className="cf-note-text">“{n.note}”</p>
      {n.answers.length === 0 ? (
        <p className="cf-muted cf-note-waiting">Muse hasn&apos;t answered this yet.</p>
      ) : (
        n.answers.map((a: NoteAnswer) => (
          <div key={a.id} className="cf-note-answer">
            <p className="cf-note-label">
              {a.partner ? (
                <>
                  Mixed up with <WordLink word={a.partner} />
                </>
              ) : (
                "Answer"
              )}
              <span>
                {" "}
                · {a.model} · {when(a.at)}
              </span>
            </p>
            <p className="cf-note-diff">{a.difference}</p>
            {a.pair && <Pair pair={a.pair} mine={n.word} theirs={a.partner} />}
          </div>
        ))
      )}
    </li>
  );
}

export function useNoteCounts(): { total: number; answered: number } | null {
  const [counts, setCounts] = useState<{ total: number; answered: number } | null>(null);
  useEffect(() => {
    get<{ total: number; answered: number }>("notes", { offset: 0 })
      .then((r) => setCounts({ total: r.total, answered: r.answered }))
      .catch(() => setCounts(null));
  }, []);
  return counts;
}

/** Every note, newest first, with its answers, full screen. */
export function NotesView({ onEnd }: { onEnd: () => void }) {
  const [notes, setNotes] = useState<NoteEntry[] | null>(null);
  const [counts, setCounts] = useState<{ total: number; answered: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = (offset: number) => {
    setBusy(true);
    get<{ notes: NoteEntry[]; total: number; answered: number }>("notes", { offset })
      .then((r) => {
        setNotes((n) => [...(offset ? (n ?? []) : []), ...r.notes]);
        setCounts({ total: r.total, answered: r.answered });
      })
      .catch((e) => setError(message(e)))
      .finally(() => setBusy(false));
  };
  useEffect(() => load(0), []);

  return (
    <div className="cf-rescue">
      <div className="cf-fast-top">
        <button className="cf-close" onClick={onEnd} aria-label="Back to the list">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <p className="cf-rescue-top">Your notes{counts ? ` · ${fmt(counts.answered)} of ${fmt(counts.total)} answered` : ""}</p>
      </div>
      <div className="cf-rescue-in">
        {error && <p className="cf-error">{error}</p>}
        {!notes && !error && <Loading label="Finding them…" />}
        {notes && !notes.length && <p className="cf-muted">No notes yet. Swipe Forgot up on a card to write what tripped you up.</p>}
        {notes && notes.length > 0 && (
          <ul className="cf-note-list">
            {notes.map((n) => (
              <NoteItem key={n.id} n={n} />
            ))}
          </ul>
        )}
        {notes && counts && notes.length < counts.total && (
          <button className="cf-more" disabled={busy} onClick={() => load(notes.length)}>
            {busy ? "Loading…" : `Show more (${fmt(counts.total - notes.length)})`}
          </button>
        )}
      </div>
    </div>
  );
}
