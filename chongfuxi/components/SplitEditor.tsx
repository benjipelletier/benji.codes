"use client";

// Fixing how a sentence is split into words (app/api/chongfuxi/resplit.ts):
// the owner met 乱翻 cut into 乱 + 翻 and couldn't tap the word that tripped
// them. "Fix the words" turns the sentence's words into pieces: the + between
// two joins them, a tap on a piece of two or more characters cuts it into its
// characters. Save writes the new split and checks the sentence again.

import { useState } from "react";
import type { SentenceInfo } from "@chongfuxi/lib/api";
import { send } from "@chongfuxi/lib/client";
import * as wordpage from "@chongfuxi/lib/wordpage";
import { message } from "./shared";

export function SplitEditor({ sentence, onSaved }: { sentence: SentenceInfo; onSaved: (sentence: SentenceInfo) => void }) {
  const [words, setWords] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState<string[]>([]);

  const save = async () => {
    if (!words) return;
    setBusy(true);
    setError(null);
    try {
      const r = await send<{ sentence: SentenceInfo; blockers: string[] }>("sentence", { id: sentence.id, action: "split", words });
      // Words new to the split that now hold the sentence back.
      setLocked(r.blockers.filter((b) => !sentence.words.includes(b)));
      onSaved(r.sentence);
      setWords(null);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  if (!words)
    return (
      <div className="cf-split">
        <button className="cf-link cf-split-open" onClick={() => setWords([...sentence.words])}>
          Fix the words
        </button>
        {locked.length > 0 && (
          <p className="cf-muted cf-split-note">
            {locked.map((w, i) => (
              <span key={w}>
                {i > 0 && "、"}
                <button className="cf-word-link cf-zh" onClick={() => wordpage.openWordPage(w)}>
                  {w}
                </button>
              </span>
            ))}{" "}
            {locked.length === 1 ? "isn't" : "aren't"} in your deck, so this sentence locks until you learn {locked.length === 1 ? "it" : "them"}.
          </p>
        )}
      </div>
    );

  const join = (i: number) => setWords([...words.slice(0, i), words[i] + words[i + 1], ...words.slice(i + 2)]);
  const cut = (i: number) => [...words[i]].length > 1 && setWords([...words.slice(0, i), ...words[i], ...words.slice(i + 1)]);
  const changed = words.length !== sentence.words.length || words.some((w, i) => w !== sentence.words[i]);
  return (
    <div className="cf-split is-editing">
      <p className="cf-muted">Tap + to join two words, a word to cut it into characters.</p>
      <div className="cf-split-pieces">
        {words.map((w, i) => (
          <span key={`${i}-${w}`} className="cf-split-piece">
            <button className="cf-token cf-zh" onClick={() => cut(i)} aria-label={[...w].length > 1 ? `Cut ${w}` : w}>
              {w}
            </button>
            {i < words.length - 1 && (
              <button className="cf-split-join" onClick={() => join(i)} aria-label={`Join ${w} and ${words[i + 1]}`}>
                +
              </button>
            )}
          </span>
        ))}
      </div>
      {error && <p className="cf-error">{error}</p>}
      <div className="cf-split-actions">
        <button className="cf-link" onClick={() => setWords(null)} disabled={busy}>
          Cancel
        </button>
        <button className="cf-btn" onClick={() => void save()} disabled={busy || !changed}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
