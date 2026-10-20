"use client";

// Stuck words (app/api/chongfuxi/rescue.ts): a word forgotten RESCUE_STREAK
// or more times in a row gets an AI rescue, made from everything known about
// it, to get it out of "forgotten land" (the owner's words). Three parts:
// the Stuck section on Today, listing them; the rescue screen, full screen
// like Fast review (why it slips, a hook, what it's mixed up with, then a
// short quiz on the owner's own sentences); and the hook on the backs of its
// cards once worked through, until RESCUE_CLEAR Goods in a row.

import { useEffect, useRef, useState } from "react";
import type { Rescue as RescueData, StuckWord } from "@chongfuxi/lib/api";
import { get, send } from "@chongfuxi/lib/client";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import { RESCUE_CLEAR, RESCUE_STREAK } from "@chongfuxi/lib/review";
import * as wordpage from "@chongfuxi/lib/wordpage";
import { Loading, fmt, message, type Shell } from "./shared";

const STATE: Record<StuckWord["rescue"], string> = { none: "Rescue", ready: "Ready", done: "Done", stale: "Missed again" };

/** On Today: the stuck words, each opening its rescue. Nothing shows when none are stuck. */
export function StuckWords({ onOpen }: { onOpen: (word: string) => void }) {
  const [words, setWords] = useState<StuckWord[] | null>(null);
  useEffect(() => {
    get<{ words: StuckWord[] }>("rescue")
      .then((r) => setWords(r.words))
      .catch(() => setWords([]));
  }, []);
  if (!words?.length) return null;
  return (
    <section className="cf-stuck">
      <h3>
        Stuck <small>forgotten {RESCUE_STREAK}+ times in a row</small>
      </h3>
      <ul>
        {words.map((w) => (
          <li key={w.word}>
            <button onClick={() => onOpen(w.word)}>
              <span className="cf-stuck-zh cf-zh">{w.word}</span>
              <span className="cf-stuck-body">
                {w.pinyin && <span className="cf-stuck-py">{displayPinyin(w.pinyin)}</span>}
                {w.gloss && <span className="cf-stuck-gloss">{w.gloss}</span>}
              </span>
              <span className="cf-stuck-n" title={`${w.missed} on its cards, ${w.tripped} in sentences`}>
                ×{w.streak}
              </span>
              <span className={`cf-stuck-state is-${w.rescue}`}>{STATE[w.rescue]}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** On a rescued word's card back, until it is got right RESCUE_CLEAR times in a row. */
export function RescueHook({ hook }: { hook: string }) {
  return (
    <p className="cf-rescue-hook is-card">
      <span className="cf-rescue-hook-label">
        Hook <span className="cf-ai-pill">AI</span>
      </span>
      {hook}
    </p>
  );
}

/** A stuck word's rescue, full screen: the sheet, then the quiz, then done. */
export function Rescue({ shell, word, onEnd }: { shell: Shell; word: string; onEnd: () => void }) {
  const { canWrite } = shell;
  const [r, setR] = useState<RescueData | null>(null);
  const [making, setMaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<"sheet" | "quiz" | "done">("sheet");
  // The quiz: which question, the choice made on it, and every result so far.
  const [at, setAt] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [results, setResults] = useState<Array<{ i: number; right: boolean }>>([]);

  const make = async (fresh: boolean) => {
    setMaking(true);
    setError(null);
    try {
      const made = await send<{ rescue: RescueData }>("rescue", { word, fresh });
      setR(made.rescue);
      setStage("sheet");
    } catch (e) {
      setError(message(e));
    } finally {
      setMaking(false);
    }
  };

  // The rescue made already, or, for the owner, one made now (it costs a model call, so only when
  // opened, and once: React runs this twice in development).
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (asked.current === word) return;
    asked.current = word;
    get<{ rescue: RescueData | null }>("rescue", { w: word })
      .then((got) => {
        if (got.rescue) setR(got.rescue);
        else if (canWrite) void make(false);
      })
      .catch((e) => setError(message(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word]);

  const startQuiz = () => {
    setAt(0);
    setPicked(null);
    setResults([]);
    setStage("quiz");
  };
  const pick = (choice: string) => {
    if (!r || picked) return;
    setPicked(choice);
    setResults((x) => [...x, { i: at, right: choice === r.drill[at].answer }]);
  };
  const next = async () => {
    if (!r) return;
    if (at + 1 < r.drill.length) {
      setAt(at + 1);
      setPicked(null);
      return;
    }
    setStage("done");
    if (!canWrite) return;
    try {
      await send("rescue", { word, done: true, drill: results });
      setR({ ...r, doneAt: Date.now() });
    } catch (e) {
      setError(message(e));
    }
  };

  const right = results.filter((x) => x.right).length;
  const q = r && stage === "quiz" ? r.drill[at] : null;

  return (
    <div className="cf-rescue">
      <div className="cf-fast-top">
        <button className="cf-close" onClick={onEnd} aria-label="Leave the rescue">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <p className="cf-rescue-top">
          Stuck word{stage === "quiz" && r ? ` · ${at + 1} of ${r.drill.length}` : ""}
        </p>
      </div>

      <div className="cf-rescue-in">
        {error && <p className="cf-error">{error}</p>}
        {making && <Loading label="Going through everything about it… this can take a minute." />}
        {!r && !making && !error && !canWrite && <p className="cf-muted">No rescue has been made for {word} yet.</p>}
        {!r && !making && !error && canWrite && <Loading label="Opening…" />}

        {r && !making && stage === "sheet" && (
          <>
            <header className="cf-rescue-head">
              <button className="cf-rescue-word cf-zh" onClick={() => wordpage.openWordPage(r.word)}>
                {r.word}
              </button>
              {r.pinyin && <p className="cf-rescue-py">{displayPinyin(r.pinyin)}</p>}
              {r.gloss && <p className="cf-rescue-gloss">{r.gloss}</p>}
            </header>

            {r.stale && (
              <div className="cf-rescue-stale">
                <p>Forgotten again since this was made.</p>
                {canWrite && (
                  <button className="cf-btn cf-btn-ghost" onClick={() => void make(true)}>
                    Make it again
                  </button>
                )}
              </div>
            )}

            <section>
              <h3 className="cf-rescue-h">Why it slips</h3>
              <p>{r.diagnosis}</p>
            </section>

            <p className="cf-rescue-hook">
              <span className="cf-rescue-hook-label">
                Hook <span className="cf-ai-pill">AI</span>
              </span>
              {r.hook}
            </p>

            {r.confusions.length > 0 && (
              <section>
                <h3 className="cf-rescue-h">Mixed up with</h3>
                <ul className="cf-rescue-conf">
                  {r.confusions.map((c) => (
                    <li key={c.zh}>
                      <button className="cf-lk-wchip" onClick={() => wordpage.openWordPage(c.zh)}>
                        <span className="cf-zh">{c.zh}</span> ›
                      </button>
                      <span>
                        {c.pinyin && <span className="cf-rescue-cpy">{c.pinyin}</span>} {c.difference}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <p className="cf-rescue-from">
              From {fmt(r.evidence.missed)} {r.evidence.missed === 1 ? "miss" : "misses"}, {fmt(r.evidence.tripped)} tripped{" "}
              {r.evidence.tripped === 1 ? "sentence" : "sentences"}, {fmt(r.evidence.notes)} {r.evidence.notes === 1 ? "note" : "notes"},{" "}
              {fmt(r.evidence.lookups)} {r.evidence.lookups === 1 ? "lookup" : "lookups"}
              {r.doneAt ? ` · worked through ${new Date(r.doneAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}
            </p>

            <div className="cf-buttons cf-rescue-go">
              <button className="cf-btn" onClick={startQuiz}>
                {r.doneAt ? "Quiz again" : "Start the quiz"} ({r.drill.length})
              </button>
            </div>
          </>
        )}

        {r && q && (
          <section className="cf-rescue-q">
            <p className="cf-rescue-qkind">{q.kind === "cloze" ? "Fill the gap" : q.kind === "meaning" ? "What does it mean?" : "Which word?"}</p>
            <p className={q.kind === "meaning" ? "cf-rescue-prompt" : "cf-rescue-prompt cf-zh"}>{q.prompt}</p>
            {q.sentence?.en && picked && <p className="cf-muted cf-rescue-en">{q.sentence.en}</p>}
            <ul className="cf-rescue-choices">
              {q.choices.map((c) => {
                const state = !picked ? "" : c === q.answer ? " is-right" : c === picked ? " is-wrong" : " is-off";
                return (
                  <li key={c}>
                    <button className={`cf-rescue-choice${state}`} disabled={picked !== null} onClick={() => pick(c)}>
                      <span className={/[㐀-鿿]/.test(c) ? "cf-zh" : ""}>{c}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {picked && (
              <>
                <p className={`cf-rescue-verdict${picked === q.answer ? " is-right" : " is-wrong"}`}>
                  {picked === q.answer ? "Right." : `It's ${q.answer}.`} {q.explain}
                </p>
                <div className="cf-buttons">
                  <button className="cf-btn" onClick={() => void next()}>
                    {at + 1 < (r?.drill.length ?? 0) ? "Next" : "Finish"}
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {r && stage === "done" && (
          <section className="cf-rescue-end">
            <p className="cf-rescue-score">
              {right} of {results.length} right
            </p>
            <p className="cf-rescue-hook">
              <span className="cf-rescue-hook-label">
                Hook <span className="cf-ai-pill">AI</span>
              </span>
              {r.hook}
            </p>
            <p className="cf-muted">
              {canWrite
                ? `The hook now shows on ${r.word}'s cards until you get it right ${RESCUE_CLEAR} times in a row.`
                : "Only Benji's quiz results are kept."}
            </p>
            <div className="cf-buttons">
              <button className="cf-btn cf-btn-ghost" onClick={startQuiz}>
                Quiz again
              </button>
              <button className="cf-btn" onClick={onEnd}>
                Back to Today
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
