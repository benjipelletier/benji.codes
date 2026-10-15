"use client";

// Learn: up to ten new words, taught with sentences before they join the
// review. Each word climbs four steps (lib/learn.ts): meet it, read it in a
// sentence, fill it into a gap, the word alone. Nothing here counts as an
// answer: a word through every step is marked learned and comes up in Review
// the next day, new. Started from Today, or from a list in Cards › Lists.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  LearnResult,
  LearnSentence,
  LearnStep,
  LearnWord,
} from "@chongfuxi/lib/api";
import * as bugs from "@chongfuxi/lib/bugs";
import { get, send, today } from "@chongfuxi/lib/client";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import {
  afterStep,
  isLearned,
  pickNext,
  progressOf,
  resultOf,
  sentencesFor,
  startItems,
  stepOf,
  type LearnItem,
} from "@chongfuxi/lib/learn";
import { newId } from "@chongfuxi/lib/upload";
import {
  HskTags,
  LongkuTag,
  SentenceText,
  Word,
  fmt,
  message,
  plecoHref,
  type Shell,
} from "./shared";

const STEP_NAME: Record<LearnStep, string> = {
  meet: "New word",
  context: "In context",
  cloze: "Fill the gap",
  word: "The word",
};

export function Learn({
  shell,
  list = null,
  onEnd,
}: {
  shell: Shell;
  list?: string | null;
  onEnd: () => void;
}) {
  const { canWrite, refresh } = shell;
  const [items, setItems] = useState<LearnItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [turn, setTurn] = useState(0);
  const [current, setCurrent] = useState<{
    i: number;
    sentences: LearnSentence[];
  } | null>(null);
  const [revealed, setRevealed] = useState(false);
  const session = useRef(`learn:${newId()}`);
  // Words learned and not yet saved: sent as each is learned, again at the end if that failed.
  const unsaved = useRef<LearnResult[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    get<{ words: LearnWord[] }>("learn", { list: list ?? undefined })
      .then((r) => setItems(startItems(r.words)))
      .catch((e) => setError(message(e)));
  }, [list]);

  const save = useCallback(async () => {
    if (!canWrite || !unsaved.current.length) return;
    const words = unsaved.current;
    try {
      await send("learn", { session: session.current, words }, "POST", today());
      unsaved.current = unsaved.current.filter((w) => !words.includes(w));
      setSaveError(null);
    } catch (e) {
      setSaveError(
        `${message(e)} The words stay to learn until it goes through.`,
      );
    }
  }, [canWrite]);

  // The next card, whenever the last one is done with.
  useEffect(() => {
    if (!items || current) return;
    const i = pickNext(items, turn, null);
    if (i !== null) setCurrent({ i, sentences: sentencesFor(items[i]) });
  }, [items, current, turn]);

  const item = items && current ? items[current.i] : null;
  const step = item ? stepOf(item) : null;

  // For a bug filed now: the word and step on screen.
  useEffect(() => {
    if (!item || !step) return;
    return bugs.note("learn", {
      word: item.word.word,
      step,
      sentence: current?.sentences[0]?.id ?? null,
    });
  }, [item, step, current]);

  const done = (grade: "seen" | "good" | "forgot") => {
    if (!items || !current || !item) return;
    const next = afterStep(item, grade, turn, current.sentences);
    const all = items.map((it, i) => (i === current.i ? next : it));
    if (isLearned(next)) {
      unsaved.current = [...unsaved.current, resultOf(next)];
      void save();
    }
    setItems(all);
    setRevealed(false);
    setTurn((t) => t + 1);
    // Picked here rather than by the effect, so the word just shown waits if another can go.
    const i = pickNext(all, turn + 1, current.i);
    setCurrent(i === null ? null : { i, sentences: sentencesFor(all[i]) });
  };

  const finish = () => {
    void save().finally(() => {
      refresh();
      onEnd();
    });
  };

  const progress = useMemo(
    () => (items ? progressOf(items) : { done: 0, total: 0 }),
    [items],
  );
  const learned = items?.filter(isLearned) ?? [];
  const finished =
    items !== null && items.length > 0 && learned.length === items.length;
  const pct = progress.total ? (100 * progress.done) / progress.total : 0;

  return (
    <div className="cf-review cf-learn">
      <div className="cf-session-top">
        <button className="cf-close" onClick={finish} aria-label="End Learn">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden>
            <path
              d="M5 5l10 10M15 5L5 15"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        </button>
        {list && (
          <span className="cf-session-list cf-zh">
            {list.slice(list.lastIndexOf("/") + 1)}
          </span>
        )}
        <div
          className="cf-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
        >
          <i style={{ width: `${pct}%` }} />
        </div>
        <span className="cf-left">
          {items ? `${fmt(learned.length)}/${fmt(items.length)}` : ""}
        </span>
      </div>

      {error && <p className="cf-error">{error}</p>}
      {saveError && <p className="cf-error">{saveError}</p>}
      {!items && !error && (
        <p className="cf-muted cf-pad">Finding sentences for your new words…</p>
      )}

      {items && items.length === 0 && (
        <div className="cf-done">
          <p className="cf-done-zh">学</p>
          <p className="cf-muted">
            No new words waiting{list ? " on this list" : ""}.
          </p>
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
                <small>
                  {it.misses
                    ? `${it.misses} ${it.misses === 1 ? "miss" : "misses"}`
                    : "no misses"}
                </small>
              </li>
            ))}
          </ul>
          <button className="cf-btn" onClick={finish}>
            Done
          </button>
        </div>
      )}

      {item && step && current && (
        <article key={`${current.i}:${turn}`} className="cf-card is-learn">
          <div className="cf-card-kind">
            <i className="cf-dot" />
            {STEP_NAME[step]}
            <span
              className="cf-learn-steps"
              aria-label={`Step ${Math.min(item.at, item.steps.length - 1) + 1} of ${item.steps.length}`}
            >
              {item.steps.map((s, k) => (
                <i
                  key={s}
                  className={
                    k < item.at ? "is-done" : k === item.at ? "is-here" : ""
                  }
                />
              ))}
            </span>
            <span className="cf-card-tags">
              <HskTags hsk={item.word.hsk} />
              {item.word.longku && <LongkuTag />}
            </span>
          </div>

          {step === "meet" && (
            <Meet w={item.word} sentences={current.sentences} />
          )}
          {step === "context" && (
            <Context
              w={item.word}
              s={current.sentences[0]}
              revealed={revealed}
            />
          )}
          {step === "cloze" && (
            <Cloze
              w={item.word}
              s={current.sentences[0] ?? null}
              revealed={revealed}
            />
          )}
          {step === "word" && (
            <>
              <Word word={item.word.word} />
              {revealed && <Meaning w={item.word} />}
            </>
          )}

          {revealed && (
            <div className="cf-card-foot">
              <a className="cf-link" href={plecoHref(item.word.word)}>
                Open in Pleco
              </a>
            </div>
          )}
        </article>
      )}

      {item && step && (
        <div className="cf-answer is-floor">
          {step === "meet" ? (
            <button
              className="cf-answer-btn cf-answer-show"
              onClick={() => done("seen")}
            >
              Next
            </button>
          ) : !revealed ? (
            <button
              className="cf-answer-btn cf-answer-show"
              onClick={() => setRevealed(true)}
            >
              Show answer
            </button>
          ) : (
            <>
              <button
                className="cf-answer-btn cf-answer-forgot"
                onClick={() => done("forgot")}
              >
                Forgot
                <small>again soon</small>
              </button>
              <button
                className="cf-answer-btn cf-answer-good"
                onClick={() => done("good")}
              >
                Got it
                <small>
                  {item.at + 1 >= item.steps.length
                    ? "learned"
                    : STEP_NAME[item.steps[item.at + 1]].toLowerCase()}
                </small>
              </button>
            </>
          )}
        </div>
      )}
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
      {look?.gloss && <>: {look.gloss}</>}
    </p>
  );
}

/** Meeting the word: everything, with sentences to see it used. Not a test. */
function Meet({ w, sentences }: { w: LearnWord; sentences: LearnSentence[] }) {
  return (
    <>
      <Word word={w.word} />
      <Meaning w={w} />
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
