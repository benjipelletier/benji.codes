"use client";

// Learn: new words taught with sentences before they join the review. Each
// word climbs a ladder (lib/learn.ts): meet it, read it in a sentence, fill it
// into a gap, the word alone. Five words are on it at a time. The steps come
// in the review session, one every fifth card (`useLadder`, used by Session
// in ReviewPanel), and in a list's drill (`Learn`, from Cards › Lists), one
// after another. Each step is saved on the card as it is taken, so leaving
// loses nothing and the next session carries on where this one stopped.
// Nothing here counts as an answer: a word through every step comes up in
// Review the next day, new.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LearnSentence, LearnStep, LearnStepDone, LearnWord, LookupFrom } from "@chongfuxi/lib/api";
import * as bugs from "@chongfuxi/lib/bugs";
import { get, send, today } from "@chongfuxi/lib/client";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import { afterStep, isLearned, pickNext, progressOf, sentencesFor, startItems, stepDone, stepOf, type LearnItem } from "@chongfuxi/lib/learn";
import { newId } from "@chongfuxi/lib/upload";
import { LookupPanel } from "./LookupPanel";
import { Loading, AiPill, DefineButton, HskTags, LongkuTag, PlecoTile, SentenceText, Sheet, Word, fmt, message, type Shell } from "./shared";
import type { Definition } from "@chongfuxi/lib/dict";

const STEP_NAME: Record<LearnStep, string> = {
  meet: "New word",
  context: "In context",
  cloze: "Fill the gap",
  word: "The word",
};

type Grade = "seen" | "good" | "forgot" | "known";

export interface Ladder {
  /** The words, as they stand; null while loading. */
  items: LearnItem[] | null;
  error: string | null;
  /** Steps taken that the server doesn't have yet: kept, and sent with the next. */
  saveError: string | null;
  /** The step on show, if one is. */
  current: { i: number; sentences: LearnSentence[] } | null;
  revealed: boolean;
  reveal: () => void;
  /** Put the next step on show; false when every word is learned. */
  begin: () => boolean;
  /** The step on show, taken: saved, and the word moves on. */
  take: (grade: Grade) => void;
  /** The word of each step taken here, in order: for the session's recap. */
  taken: string[];
  /** The step on show put away untaken, to come again (Undo of the card before it). */
  setAside: () => void;
  /** Send whatever steps are waiting. */
  flush: () => Promise<void>;
  /** Whether steps are saved (the owner): only then can a word be taken off as known. */
  canWrite: boolean;
  /** A word given a definition by the model while on the ladder (it had none): its later steps show it. */
  defined: (word: string, pinyin: string | null, senses: string[]) => void;
}

/**
 * The ladder's words and the step on show. Loads the words (a list's, or the
 * deck's), each where it was left; saves each step as it is taken, in order,
 * one request at a time.
 */
export function useLadder({ list, enabled, canWrite }: { list: string | null; enabled: boolean; canWrite: boolean }): Ladder {
  const [items, setItems] = useState<LearnItem[] | null>(null);
  const itemsRef = useRef<LearnItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [current, setCurrent] = useState<Ladder["current"]>(null);
  const [revealed, setRevealed] = useState(false);
  const [taken, setTaken] = useState<string[]>([]);
  const turn = useRef(0);
  const last = useRef<number | null>(null);
  const session = useRef(`learn:${newId()}`);
  const unsent = useRef<LearnStepDone[]>([]);
  const sending = useRef(false);

  const put = (next: LearnItem[]) => {
    itemsRef.current = next;
    setItems(next);
  };

  useEffect(() => {
    if (!enabled) return put([]);
    get<{ words: LearnWord[] }>("learn", { list: list ?? undefined })
      .then((r) => put(startItems(r.words)))
      .catch((e) => {
        setError(message(e));
        put([]);
      });
  }, [enabled, list]);

  // One request at a time, in order: a later step must never land before an earlier one.
  const flush = useCallback(async () => {
    if (!canWrite || sending.current || !unsent.current.length) return;
    sending.current = true;
    const steps = unsent.current;
    try {
      await send("learn", { session: session.current, steps }, "POST", today());
      unsent.current = unsent.current.filter((s) => !steps.includes(s));
      setSaveError(null);
    } catch (e) {
      setSaveError(`${message(e)} Your place on the ladder is kept and sent with the next step.`);
      return;
    } finally {
      sending.current = false;
    }
    if (unsent.current.length) void flush();
  }, [canWrite]);

  // Anything still waiting goes when the screen does.
  useEffect(() => () => void flush(), [flush]);

  const begin = useCallback(() => {
    const all = itemsRef.current;
    if (!all) return false;
    const i = pickNext(all, turn.current, last.current);
    if (i === null) return false;
    setCurrent({ i, sentences: sentencesFor(all[i]) });
    setRevealed(false);
    return true;
  }, []);

  const take = (grade: Grade) => {
    const all = itemsRef.current;
    if (!all || !current) return;
    const before = all[current.i];
    const after = afterStep(before, grade, turn.current, current.sentences);
    unsent.current = [...unsent.current, stepDone(before, after, grade, current.sentences, newId())];
    void flush();
    put(all.map((it, k) => (k === current.i ? after : it)));
    last.current = current.i;
    turn.current++;
    setTaken((t) => [...t, before.word.word]);
    setCurrent(null);
    setRevealed(false);
  };

  // For a bug filed now: the word and step on screen.
  const item = items && current ? items[current.i] : null;
  useEffect(() => {
    if (!item) return;
    return bugs.note("learn", { word: item.word.word, step: stepOf(item), sentence: current?.sentences[0]?.id ?? null });
  }, [item, current]);

  const defined = (word: string, pinyin: string | null, senses: string[]) => {
    const all = itemsRef.current;
    if (!all) return;
    put(all.map((it) => (it.word.word === word ? { ...it, word: { ...it.word, pinyin: it.word.pinyin ?? pinyin, senses } } : it)));
  };

  const setAside = () => {
    setCurrent(null);
    setRevealed(false);
  };

  return { items, error, saveError, current, revealed, reveal: () => setRevealed(true), begin, take, taken, setAside, flush, canWrite, defined };
}

/** The step on show, as a card. */
export function LearnCard({ ladder, shell }: { ladder: Ladder; shell: Shell }) {
  const { items, current, revealed } = ladder;
  // Look up over the card, as on a review card; the card goes with what is asked.
  const [looking, setLooking] = useState<LookupFrom | null>(null);
  if (!items || !current) return null;
  const item = items[current.i];
  const step = stepOf(item);
  return (
    <>
    <article className="cf-card is-learn">
      <div className="cf-card-kind">
        <span className="cf-kind-pill">
          <i className="cf-dot" />
          {STEP_NAME[step]}
        </span>
        <span className="cf-learn-steps" aria-label={`Step ${Math.min(item.at, item.steps.length - 1) + 1} of ${item.steps.length}`}>
          {item.steps.map((s, k) => (
            <i key={s} className={k < item.at ? "is-done" : k === item.at ? "is-here" : ""} />
          ))}
        </span>
        <span className="cf-card-tags">
          <HskTags hsk={item.word.hsk} />
          {item.word.longku && <LongkuTag />}
        </span>
      </div>

      {step === "meet" && (
        <Meet
          w={item.word}
          sentences={current.sentences}
          onDefined={ladder.canWrite ? (r) => ladder.defined(item.word.word, r.pinyin, r.defs.flatMap((d) => d.senses)) : undefined}
        />
      )}
      {step === "context" && <Context w={item.word} s={current.sentences[0]} revealed={revealed} />}
      {step === "cloze" && <Cloze w={item.word} s={current.sentences[0] ?? null} revealed={revealed} />}
      {step === "word" && (
        <>
          <Word word={item.word.word} />
          {revealed && <Meaning w={item.word} />}
          {revealed && !item.word.senses.length && ladder.canWrite && (
            <DefineButton word={item.word.word} onDefined={(r) => ladder.defined(item.word.word, r.pinyin, r.defs.flatMap((d) => d.senses))} />
          )}
        </>
      )}

      {/* Pleco once the answer shows; 会 at any step, for a word already known: off the ladder,
          into the review from the next study day, as if it had climbed every step. */}
      {(revealed || ladder.canWrite) && (
        <div className="cf-card-foot">
          {(revealed || step === "meet") && <PlecoTile word={item.word.word} />}
          {ladder.canWrite && (
            <button
              className="cf-foot-btn is-look"
              aria-label="Look up"
              onClick={() =>
                setLooking({
                  card: item.word.card,
                  word: item.word.word,
                  kind: "read",
                  via: "learn",
                  sentence: current.sentences[0]?.id ?? null,
                  session: null,
                  step,
                })
              }
            >
              <span className="cf-foot-zh" aria-hidden="true">
                查
              </span>
              <small>Look up</small>
            </button>
          )}
          {ladder.canWrite && (
            <button className="cf-foot-btn is-known" onClick={() => ladder.take("known")} aria-label="I know it: take it out of new words">
              <span className="cf-foot-zh" aria-hidden="true">
                会
              </span>
              <small>Know it</small>
            </button>
          )}
        </div>
      )}
    </article>
    {/* Over the page, outside the card (whose motion would carry a fixed sheet with it). */}
    {looking && (
      <Sheet label="Look up" onClose={() => setLooking(null)}>
        <div className="cf-lk-sheet">
          <LookupPanel shell={shell} start={item.word.word} from={looking} />
        </div>
      </Sheet>
    )}
    </>
  );
}

/** The buttons for the step on show: Next to meet a word, else Show answer, then Forgot or Got it. */
export function LearnAnswers({ ladder }: { ladder: Ladder }) {
  const { items, current, revealed } = ladder;
  if (!items || !current) return null;
  const item = items[current.i];
  const step = stepOf(item);
  return (
    <div className="cf-answer is-floor">
      {step === "meet" ? (
        <button className="cf-answer-btn cf-answer-show" onClick={() => ladder.take("seen")}>
          Next
        </button>
      ) : !revealed ? (
        <button className="cf-answer-btn cf-answer-show" onClick={ladder.reveal}>
          Show answer
        </button>
      ) : (
        <>
          <button className="cf-answer-btn cf-answer-forgot" onClick={() => ladder.take("forgot")}>
            Forgot
            <small>again soon</small>
          </button>
          <button className="cf-answer-btn cf-answer-good" onClick={() => ladder.take("good")}>
            Got it
            <small>{item.at + 1 >= item.steps.length ? "learned" : STEP_NAME[item.steps[item.at + 1]].toLowerCase()}</small>
          </button>
        </>
      )}
    </div>
  );
}

/** A list's drill: its new words, one step after another, ten at a time. */
export function Learn({ shell, list, onEnd }: { shell: Shell; list: string; onEnd: () => void }) {
  const { canWrite, refresh } = shell;
  const ladder = useLadder({ list, enabled: true, canWrite });
  const { items, current, begin } = ladder;

  // The next step, whenever the last one is done with.
  useEffect(() => {
    if (items && !current) begin();
  }, [items, current, begin]);

  const finish = () => {
    void ladder.flush().finally(() => {
      refresh();
      onEnd();
    });
  };

  const progress = useMemo(() => (items ? progressOf(items) : { done: 0, total: 0 }), [items]);
  const learned = items?.filter(isLearned) ?? [];
  const finished = items !== null && items.length > 0 && learned.length === items.length;
  const pct = progress.total ? (100 * progress.done) / progress.total : 0;

  return (
    <div className="cf-review cf-learn">
      <div className="cf-session-top">
        <button className="cf-close" onClick={finish} aria-label="End Learn">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden>
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
          </svg>
        </button>
        <span className="cf-session-list cf-zh">{list.slice(list.lastIndexOf("/") + 1)}</span>
        <div className="cf-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
          <i style={{ width: `${pct}%` }} />
        </div>
        <span className="cf-left">{items ? `${fmt(learned.length)}/${fmt(items.length)}` : ""}</span>
      </div>

      {ladder.error && <p className="cf-error">{ladder.error}</p>}
      {ladder.saveError && <p className="cf-error">{ladder.saveError}</p>}
      {!items && !ladder.error && <Loading label="Finding sentences for your new words…" />}

      {items && items.length === 0 && (
        <div className="cf-done">
          <p className="cf-done-zh">学</p>
          <p className="cf-muted">No new words waiting on this list.</p>
          <button className="cf-btn" onClick={onEnd}>
            Back
          </button>
        </div>
      )}

      {finished && (
        <div className="cf-done">
          <p className="cf-done-zh">学</p>
          <p className="cf-muted">
            {canWrite
              ? `${fmt(learned.length)} ${learned.length === 1 ? "word" : "words"} learned. They come up in Review tomorrow, as new cards.`
              : "Read-only: nothing was saved. Only Benji's own Learn counts."}
          </p>
          <ul className="cf-learn-summary">
            {learned.map((it) => (
              <li key={it.word.card}>
                <span className="cf-zh">{it.word.word}</span>
                <small>{it.misses ? `${it.misses} ${it.misses === 1 ? "miss" : "misses"}` : "no misses"}</small>
              </li>
            ))}
          </ul>
          <button className="cf-btn" onClick={finish}>
            Done
          </button>
        </div>
      )}

      <LearnCard ladder={ladder} shell={shell} />
      <LearnAnswers ladder={ladder} />
    </div>
  );
}

/** Pinyin and the first few senses. */
function Meaning({ w }: { w: LearnWord }) {
  return (
    <div className="cf-back">
      {w.pinyin && (
        <div className="cf-card-pinyin">{displayPinyin(w.pinyin)}</div>
      )}
      {w.senses.length > 0 && (
        <ul className="cf-prompt cf-learn-meaning">
          {w.senses.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A sentence's one word not known yet, with its meaning, so it doesn't stand in the way. */
function Unknown({ s }: { s: LearnSentence }) {
  if (!s.unknown) return null;
  const i = s.words.indexOf(s.unknown);
  const look = i >= 0 ? s.looks?.[i] : null;
  return (
    <p className="cf-learn-unknown">
      <span className="cf-zh">{s.unknown}</span>
      {look?.p && <> {displayPinyin(look.p)}</>}
      {look?.gloss && (
        <>
          : {look.gloss} <AiPill word={s.unknown} />
        </>
      )}
    </p>
  );
}

/** Meeting the word: everything, with sentences to see it used. Not a test. */
function Meet({
  w,
  sentences,
  onDefined,
}: {
  w: LearnWord;
  sentences: LearnSentence[];
  /** The owner's, for a word with no definition: the model writes one, as on a Read card. */
  onDefined?: (r: { pinyin: string | null; defs: Definition[] }) => void;
}) {
  return (
    <>
      <Word word={w.word} />
      <Meaning w={w} />
      {!w.senses.length && onDefined && <DefineButton word={w.word} onDefined={onDefined} />}
      {sentences.length > 0 ? (
        <ul className="cf-learn-sentences">
          {sentences.map((s) => (
            <li key={s.id}>
              <p className="cf-card-zh">
                <SentenceText sentence={s} word={w.word} taps />
              </p>
              {s.en && <p className="cf-en">{s.en}</p>}
              <Unknown s={s} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="cf-muted cf-learn-none">
          No sentences with it yet: learn it from the meaning.
        </p>
      )}
    </>
  );
}

/** Reading it in a sentence: what does it mean here? */
function Context({
  w,
  s,
  revealed,
}: {
  w: LearnWord;
  s: LearnSentence;
  revealed: boolean;
}) {
  return (
    <>
      <p className="cf-card-sentence">
        <SentenceText sentence={s} word={w.word} taps={revealed} />
      </p>
      <Unknown s={s} />
      {!revealed && (
        <p className="cf-card-hint">What does {w.word} mean here?</p>
      )}
      {revealed && (
        <>
          {s.en && <p className="cf-card-en">{s.en}</p>}
          <Meaning w={w} />
        </>
      )}
    </>
  );
}

/** Filling the gap from the English; from the meaning alone when no sentence will do. */
function Cloze({
  w,
  s,
  revealed,
}: {
  w: LearnWord;
  s: LearnSentence | null;
  revealed: boolean;
}) {
  return (
    <>
      {s ? (
        <>
          {s.en && <p className="cf-card-en">{s.en}</p>}
          {!revealed && <p className="cf-card-zh">{s.blanked}</p>}
          <Unknown s={s} />
        </>
      ) : (
        <ul className="cf-prompt">
          {w.senses.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
      {!revealed && (
        <p className="cf-card-hint">
          Which word goes {s ? "in the gap" : "with this meaning"}?
        </p>
      )}
      {revealed && (
        <div className="cf-back">
          <Word word={w.word} />
          {w.pinyin && (
            <div className="cf-card-pinyin">{displayPinyin(w.pinyin)}</div>
          )}
          {s && (
            <p className="cf-card-zh">
              <SentenceText sentence={s} word={w.word} taps />
            </p>
          )}
        </div>
      )}
    </>
  );
}
