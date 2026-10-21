"use client";

// Stuck words (app/api/chongfuxi/rescue.ts): a word forgotten RESCUE_STREAK
// or more times in a row gets an AI rescue, made from everything known about
// it, to get it out of "forgotten land" (the owner's words). Four parts: one
// button on Today with the count (the list there was clutter, the owner
// found); the list, full screen; a word's rescue (why it slips, a hook, what
// it's mixed up with, then a quiz that makes the word be produced, not
// picked: multiple choice was too easy to help); and the hook on the backs
// of its cards once worked through, until RESCUE_CLEAR Goods in a row.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Rescue as RescueData, RescueDrillItem, StuckStory, StuckWord } from "@chongfuxi/lib/api";
import { get, send } from "@chongfuxi/lib/client";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import { RESCUE_CLEAR, RESCUE_STREAK } from "@chongfuxi/lib/review";
import * as wordpage from "@chongfuxi/lib/wordpage";
import { Loading, fmt, message, useBackLayer, type Shell } from "./shared";

const STATE: Record<StuckWord["rescue"], string> = { none: "Rescue", ready: "Ready", done: "Done", stale: "Missed again" };
const KIND: Record<RescueDrillItem["kind"], string> = {
  recall: "Say the word",
  cloze: "Fill the gap",
  contrast: "Which one fits?",
  translate: "Say it in Chinese",
  meaning: "What does it mean?",
  pick: "Which word?",
};

/** The stuck words, loaded once per mount. */
function useStuck(): StuckWord[] | null {
  const [words, setWords] = useState<StuckWord[] | null>(null);
  useEffect(() => {
    get<{ words: StuckWord[] }>("rescue")
      .then((r) => setWords(r.words))
      .catch(() => setWords([]));
  }, []);
  return words;
}

/** On Today: one button with how many words are stuck, opening their list. Nothing when none are. */
export function StuckWords({ onOpen }: { onOpen: () => void }) {
  const words = useStuck();
  if (!words?.length) return null;
  const waiting = words.filter((w) => w.rescue !== "done").length;
  return (
    <button className="cf-stuck" onClick={onOpen}>
      <span className="cf-stuck-text">
        <b>Stuck words</b>
        <small>forgotten {RESCUE_STREAK}+ times in a row</small>
      </span>
      {waiting > 0 && waiting < words.length && <span className="cf-stuck-state">{fmt(waiting)} to rescue</span>}
      <span className="cf-stuck-count">{fmt(words.length)}</span>
      <i aria-hidden="true">›</i>
    </button>
  );
}

/** The stuck words, full screen; a word opens its rescue over the list, and back comes to it. */
export function StuckList({ shell, onEnd }: { shell: Shell; onEnd: () => void }) {
  // A word's rescue, or the story with them all, over the list.
  const [open, setOpen] = useState<string | null>(null);
  const [story, setStory] = useState(false);
  // Loaded again each time a rescue closes, so states are fresh.
  const [loads, setLoads] = useState(0);
  const close = useCallback(() => {
    setOpen(null);
    setStory(false);
    setLoads((n) => n + 1);
  }, []);
  useBackLayer(open !== null || story, close);
  if (open) return <Rescue shell={shell} word={open} onEnd={close} />;
  if (story) return <StoryView shell={shell} onEnd={close} />;
  return <StuckRows key={loads} onOpen={setOpen} onStory={() => setStory(true)} onEnd={onEnd} />;
}

/** A paragraph with the stuck words in it marked, each opening its page. */
function Marked({ zh, words }: { zh: string; words: string[] }) {
  const sorted = [...words].sort((a, b) => b.length - a.length);
  if (!sorted.length) return <>{zh}</>;
  const parts = zh.split(new RegExp(`(${sorted.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`));
  return (
    <>
      {parts.map((p, i) =>
        words.includes(p) ? (
          <button key={i} className="cf-story-w" onClick={() => wordpage.openWordPage(p)}>
            {p}
          </button>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/** Two paragraphs the model wrote with every stuck word in them; the English under each, on a tap. */
function StoryView({ shell, onEnd }: { shell: Shell; onEnd: () => void }) {
  const { canWrite } = shell;
  const [story, setStory] = useState<StuckStory | null>(null);
  const [making, setMaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [english, setEnglish] = useState<Set<number>>(new Set());
  const make = async () => {
    setMaking(true);
    setError(null);
    try {
      setStory((await send<{ story: StuckStory }>("rescue", { story: true })).story);
      setEnglish(new Set());
    } catch (e) {
      setError(message(e));
    } finally {
      setMaking(false);
    }
  };
  // The one written, or, for the owner, one written now (once: React runs this twice in development).
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    get<{ story: StuckStory | null }>("rescue", { story: 1 })
      .then((r) => {
        if (r.story) setStory(r.story);
        else if (canWrite) void make();
      })
      .catch((e) => setError(message(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="cf-rescue">
      <div className="cf-fast-top">
        <button className="cf-close" onClick={onEnd} aria-label="Back to the list">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <p className="cf-rescue-top">A story with them</p>
      </div>
      <div className="cf-rescue-in">
        {error && <p className="cf-error">{error}</p>}
        {making && <Loading label="Writing a story with every one of them…" />}
        {!story && !making && !error && !canWrite && <p className="cf-muted">No story has been written yet.</p>}
        {story && !making && (
          <>
            {story.title && <h1 className="cf-story-title cf-zh">{story.title}</h1>}
            {story.paragraphs.map((p, i) => (
              <div key={i} className="cf-story-p">
                <p className="cf-zh">
                  <Marked zh={p.zh} words={story.words} />
                </p>
                {english.has(i) ? (
                  <p className="cf-muted cf-story-en">{p.en}</p>
                ) : (
                  <button className="cf-link cf-story-show" onClick={() => setEnglish(new Set([...english, i]))}>
                    Show English
                  </button>
                )}
              </div>
            ))}
            {story.missing.length > 0 && (
              <p className="cf-muted cf-story-note">Left out: {story.missing.join("、")}</p>
            )}
            {story.stale && <p className="cf-muted cf-story-note">Your stuck words have changed since this was written.</p>}
            {canWrite && (
              <div className="cf-buttons cf-rescue-go">
                <button className={`cf-btn${story.stale ? "" : " cf-btn-ghost"}`} onClick={() => void make()}>
                  Write a new one
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StuckRows({ onOpen, onStory, onEnd }: { onOpen: (word: string) => void; onStory: () => void; onEnd: () => void }) {
  const words = useStuck();
  return (
    <div className="cf-rescue">
      <div className="cf-fast-top">
        <button className="cf-close" onClick={onEnd} aria-label="Back to Today">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <p className="cf-rescue-top">Stuck words{words ? ` · ${fmt(words.length)}` : ""}</p>
      </div>
      <div className="cf-rescue-in">
        {!words && <Loading label="Finding them…" />}
        {words && !words.length && <p className="cf-muted">Nothing is stuck.</p>}
        {words && words.length > 0 && (
          <>
            <p className="cf-muted cf-stuck-about">Forgotten {RESCUE_STREAK} or more times in a row, on their cards or in sentences.</p>
            <button className="cf-stuck cf-story-btn" onClick={onStory}>
              <span className="cf-stuck-text">
                <b>A story with them</b>
                <small>Two paragraphs using every one, written by AI</small>
              </span>
              <i aria-hidden="true">›</i>
            </button>
            <ul className="cf-stuck-list">
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
          </>
        )}
      </div>
    </div>
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
  // The quiz: the items in the order they come (one missed comes back once at the end), how far in,
  // the answer given to the one showing (a choice, or what was typed and then revealed), and first tries.
  const [order, setOrder] = useState<number[]>([]);
  const [pos, setPos] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [shown, setShown] = useState(false);
  const [graded, setGraded] = useState<boolean | null>(null);
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
        // One of an older shape is made again for the owner (the first quiz was too easy).
        if (got.rescue && !(got.rescue.outdated && canWrite)) setR(got.rescue);
        else if (canWrite) void make(false);
      })
      .catch((e) => setError(message(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word]);

  const clearItem = () => {
    setPicked(null);
    setTyped("");
    setShown(false);
    setGraded(null);
  };
  const startQuiz = () => {
    if (!r) return;
    setOrder(r.drill.map((_, i) => i));
    setPos(0);
    setResults([]);
    setStage("quiz");
    clearItem();
  };
  /** How the one showing went: kept on its first try, and a miss asked again once at the end. */
  const grade = (right: boolean) => {
    if (graded !== null) return;
    setGraded(right);
    const i = order[pos];
    if (!results.some((x) => x.i === i)) setResults((x) => [...x, { i, right }]);
    if (!right && order.indexOf(i) === pos && order.lastIndexOf(i) === pos) setOrder((o) => [...o, i]);
  };
  const pick = (choice: string) => {
    if (!r || picked) return;
    setPicked(choice);
    grade(choice === r.drill[order[pos]].answer);
  };
  const same = (a: string, b: string) => a.replace(/[\s，。！？,.!?]/g, "") === b.replace(/[\s，。！？,.!?]/g, "");
  /** Reveal a typed or unspoken answer: a typed word that is the word is right; the rest is graded by hand. */
  const reveal = () => {
    if (!r) return;
    setShown(true);
    const q = r.drill[order[pos]];
    if (typed.trim() && q.kind !== "translate" && same(typed, q.answer)) grade(true);
  };
  const next = async () => {
    if (!r) return;
    if (pos + 1 < order.length) {
      setPos(pos + 1);
      clearItem();
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
  const q = r && stage === "quiz" ? r.drill[order[pos]] : null;
  const again = q !== null && order.indexOf(order[pos]) !== pos;
  const choosing = q !== null && q.choices.length >= 2;

  return (
    <div className="cf-rescue">
      <div className="cf-fast-top">
        <button className="cf-close" onClick={onEnd} aria-label="Leave the rescue">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <p className="cf-rescue-top">
          Stuck word{stage === "quiz" && r ? ` · ${pos + 1} of ${order.length}` : ""}
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
            <p className="cf-rescue-qkind">
              {KIND[q.kind]}
              {again && <span className="cf-rescue-again">again</span>}
            </p>
            <p className={q.kind === "recall" || q.kind === "translate" || q.kind === "meaning" ? "cf-rescue-prompt" : "cf-rescue-prompt cf-zh"}>
              {q.prompt}
            </p>
            {q.sentence?.en && (graded !== null || shown) && <p className="cf-muted cf-rescue-en">{q.sentence.en}</p>}

            {choosing ? (
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
            ) : (
              <>
                {/* Typed, or said in one's head: either way it is produced before it is seen. */}
                <form
                  className="cf-rescue-type"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!shown) reveal();
                  }}
                >
                  <input
                    lang="zh"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    value={typed}
                    disabled={shown}
                    onChange={(e) => setTyped(e.target.value)}
                    placeholder={q.kind === "translate" ? "Write it in Chinese, or say it" : "Type it, or just say it"}
                    aria-label="Your answer"
                  />
                  {!shown && (
                    <button className="cf-btn" type="submit">
                      Show
                    </button>
                  )}
                </form>
                {shown && (
                  <p className="cf-rescue-answer">
                    <span>Answer</span>
                    <span className="cf-zh">{q.answer}</span>
                  </p>
                )}
                {shown && graded === null && (
                  <div className="cf-buttons cf-rescue-self">
                    <button className="cf-btn cf-btn-ghost" onClick={() => grade(false)}>
                      Missed
                    </button>
                    <button className="cf-btn" onClick={() => grade(true)}>
                      Got it
                    </button>
                  </div>
                )}
              </>
            )}

            {graded !== null && (
              <>
                <p className={`cf-rescue-verdict${graded ? " is-right" : " is-wrong"}`}>
                  {graded ? "Right." : choosing ? `It's ${q.answer}.` : "It comes back at the end."} {q.explain}
                </p>
                <div className="cf-buttons">
                  <button className="cf-btn" onClick={() => void next()}>
                    {pos + 1 < order.length ? "Next" : "Finish"}
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {r && stage === "done" && (
          <section className="cf-rescue-end">
            <p className="cf-rescue-score">
              {right} of {results.length} right first time
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
                Back to the list
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
