"use client";

// Reading with retelling (app/api/chongfuxi/reading.ts): native pieces Muse
// found that the owner can mostly read. One opens full screen with every word
// marked as the text analyser marks it (not known, still learning), a tap
// giving its reading and meaning; then questions to retell it by, answered
// in Chinese by voice (the phone's speech recognition) or keyboard, each
// graded by the app's model. Tapped words and how the retelling went go back
// to Muse.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Reading, Retell, TextAnalysis, TextToken } from "@chongfuxi/lib/api";
import { get, send } from "@chongfuxi/lib/client";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import * as wordpage from "@chongfuxi/lib/wordpage";
import { Loading, fmt, message } from "./shared";

/** Paragraphs shown before "Show the rest": a film's captions run long. */
const PARAGRAPHS_SHOWN = 60;
const GRADE: Record<Retell["grade"], string> = { correct: "✓ Correct", almost: "≈ Almost", wrong: "✗ Wrong" };

/** The week's readings, newest first. */
export function useReadings(): Reading[] | null {
  const [readings, setReadings] = useState<Reading[] | null>(null);
  useEffect(() => {
    get<{ readings: Reading[] }>("reading")
      .then((r) => setReadings(r.readings))
      .catch(() => setReadings([]));
  }, []);
  return readings;
}

/** The latest day's readings: today's, or the last Muse found. */
export const latestReadings = (rs: Reading[] | null) => (rs?.length ? rs.filter((r) => r.day === rs[0].day) : []);
export const unread = (rs: Reading[]) => rs.filter((r) => !r.doneAt && !r.retells.length).length;

const where = (r: Reading) => {
  if (r.kind === "youtube") return "YouTube";
  try {
    return new URL(r.url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

function stateOf(r: Reading): { label: string; cls: string } {
  const answered = new Set(r.retells.map((t) => t.q)).size;
  if (answered >= r.questions.length) return { label: "Retold", cls: "done" };
  if (answered) return { label: `${answered}/${r.questions.length} retold`, cls: "ready" };
  if (r.doneAt) return { label: "Read", cls: "ready" };
  if (r.openedAt) return { label: "Started", cls: "ready" };
  return { label: "New", cls: "none" };
}

/** The readings as rows on the Muse reviews screen. */
export function ReadingRows({ readings, onOpen }: { readings: Reading[]; onOpen: (id: number) => void }) {
  if (!readings.length) return null;
  return (
    <section className="cf-revive-group cf-read-group">
      <h3 className="cf-revive-h">
        Read <span>{fmt(readings.length)}</span>
      </h3>
      <p className="cf-muted cf-stuck-about">Native pieces Muse found that you can mostly read, then retell.</p>
      <ul className="cf-stuck-list cf-read-list">
        {readings.map((r) => {
          const s = stateOf(r);
          return (
            <li key={r.id}>
              <button onClick={() => onOpen(r.id)}>
                <span className="cf-stuck-body">
                  <span className="cf-read-title cf-zh">{r.title || r.url}</span>
                  <span className="cf-stuck-gloss">
                    {where(r)} · {Math.round(r.knownPct * 100)}% known · {fmt(r.chars)} 字
                  </span>
                  {r.why && <span className="cf-stuck-why cf-read-why">{r.why}</span>}
                </span>
                <span className={`cf-stuck-state is-${s.cls}`}>{s.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function ReadingView({ id, canWrite, onEnd }: { id: number; canWrite: boolean; onEnd: () => void }) {
  const [data, setData] = useState<{ reading: Reading; text: TextAnalysis } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const tapped = useRef(new Set<string>());
  const sent = useRef(0);
  const retellRef = useRef<HTMLElement>(null);

  useEffect(() => {
    get<{ reading: Reading; text: TextAnalysis }>("reading", { id })
      .then(setData)
      .catch((e) => setError(message(e)));
  }, [id]);

  // Tapped words go back as they gather, and on leaving.
  const flush = useCallback(
    (done = false) => {
      if (!canWrite || (!done && tapped.current.size === sent.current)) return;
      sent.current = tapped.current.size;
      send("reading", { id, tapped: [...tapped.current], done }).catch(() => {});
    },
    [canWrite, id],
  );
  useEffect(() => () => flush(), [flush]);

  const pick = (w: string, unknownish: boolean) => {
    setPicked(picked === w ? null : w);
    if (unknownish) tapped.current.add(w);
  };

  const r = data?.reading;
  const a = data?.text;
  const paragraphs = a ? (all ? a.paragraphs : a.paragraphs.slice(0, PARAGRAPHS_SHOWN)) : [];
  const look = picked && a ? a.looks[picked] : null;
  return (
    <div className="cf-rescue cf-reading">
      <div className="cf-fast-top">
        <button
          className="cf-close"
          onClick={() => {
            flush();
            onEnd();
          }}
          aria-label="Back to the list"
        >
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <p className="cf-rescue-top">Read</p>
      </div>
      <div className="cf-rescue-in">
        {error && (
          <>
            <p className="cf-error">{error}</p>
            <p className="cf-muted">Only Benji can open these here; the original is a tap away from the list.</p>
          </>
        )}
        {!data && !error && <Loading label="Fetching it…" />}
        {r && a && (
          <>
            <h1 className="cf-read-h cf-zh">{r.title || a.title || "Untitled"}</h1>
            <p className="cf-muted cf-read-meta">
              <a className="cf-link" href={r.url} target="_blank" rel="noreferrer">
                {where(r)} ↗
              </a>{" "}
              {a.words.total > 0 && <>{Math.round((a.words.known / a.words.total) * 100)}% known · </>}
              by {r.model}
            </p>
            {r.why && <p className="cf-read-note">{r.why}</p>}
            <p className="cf-an-key">
              <span className="cf-an-w is-unknown">not known</span> <span className="cf-an-w is-learning">still learning</span> tap any word
            </p>
            <div className="cf-an-body cf-read-body">
              {paragraphs.map((p, i) => (
                <p key={i} className="cf-zh">
                  {p.flat().map((t: TextToken, j) =>
                    t.k ? (
                      <button key={j} className={`cf-an-w is-${t.k}${picked === t.t ? " is-picked" : ""}`} onClick={() => pick(t.t, t.k !== "known")}>
                        {t.t}
                      </button>
                    ) : (
                      <span key={j}>{t.t}</span>
                    ),
                  )}
                </p>
              ))}
              {!all && a.paragraphs.length > PARAGRAPHS_SHOWN && (
                <button className="cf-more" onClick={() => setAll(true)}>
                  Show the rest ({fmt(a.paragraphs.length - PARAGRAPHS_SHOWN)} more paragraphs)
                </button>
              )}
            </div>
            <div className="cf-buttons">
              <button
                className="cf-btn"
                onClick={() => {
                  flush(true);
                  retellRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                Done reading · retell it
              </button>
            </div>
            <section ref={retellRef} className="cf-read-retell">
              <h2 className="cf-kits-h">Retell it</h2>
              <p className="cf-muted">Answer in Chinese, out loud or typed. Each answer is checked for the Chinese and for whether you got the piece.</p>
              {r.questions.map((q, i) => (
                <Question
                  key={i}
                  question={q}
                  q={i}
                  initial={r.retells.filter((t) => t.q === i)}
                  canWrite={canWrite}
                  check={(answer) => send<{ retell: Retell }>("reading", { id: r.id, q: i, answer }).then((x) => x.retell)}
                />
              ))}
            </section>
          </>
        )}
      </div>
      {picked && (
        <div className="cf-an-picked cf-read-picked">
          <p>
            <span className="cf-zh">{picked}</span> {look?.p && <b>{displayPinyin(look.p)}</b>}
          </p>
          {look?.gloss && <p className="cf-muted">{look.gloss}</p>}
          <div className="cf-an-picked-foot">
            <button className="cf-link" onClick={() => wordpage.openWordPage(picked)}>
              Word page ›
            </button>
            <button className="cf-link" onClick={() => setPicked(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
};

/** The phone's speech recognition, in Mandarin, if the browser has it. */
function recogniser(): Recognition | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const R = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!R) return null;
  const r = new R();
  r.lang = "zh-CN";
  r.interimResults = true;
  r.continuous = true;
  return r;
}

/** A question to answer in Chinese, by voice or keyboard, each try graded (`check`) and kept, newest first. Used by readings and episodes. */
export function Question({
  question,
  q,
  initial,
  canWrite,
  check,
}: {
  question: { zh: string; en: string };
  q: number;
  initial: Retell[];
  canWrite: boolean;
  check: (answer: string) => Promise<Retell>;
}) {
  const [answer, setAnswer] = useState("");
  const [english, setEnglish] = useState(false);
  const [tries, setTries] = useState<Retell[]>(() => [...initial].reverse());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const [canListen, setCanListen] = useState(false);
  useEffect(() => setCanListen(recogniser() !== null), []);
  useEffect(() => () => rec.current?.stop(), []);

  const listen = () => {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const r = recogniser();
    if (!r) return;
    const before = answer;
    r.onresult = (e) => {
      let said = "";
      for (let i = 0; i < e.results.length; i++) said += e.results[i][0].transcript;
      setAnswer(before + said);
    };
    r.onend = () => setListening(false);
    r.onerror = (e) => {
      setListening(false);
      if (e.error !== "no-speech" && e.error !== "aborted") setError(`The microphone stopped (${e.error}).`);
    };
    rec.current = r;
    setError(null);
    setListening(true);
    r.start();
  };

  const submit = async () => {
    rec.current?.stop();
    if (!answer.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const retell = await check(answer.trim());
      setTries((t) => [retell, ...t]);
      setAnswer("");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cf-read-q">
      <p className="cf-read-qzh cf-zh">
        {q + 1}. {question.zh}
      </p>
      {question.en &&
        (english ? (
          <p className="cf-muted">{question.en}</p>
        ) : (
          <button className="cf-link" onClick={() => setEnglish(true)}>
            English
          </button>
        ))}
      {canWrite && (
        <form
          className="cf-read-answer"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <textarea
            lang="zh"
            rows={3}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder={tries.length ? "Try again" : canListen ? "Tap the mic and say it, or type" : "Type your answer"}
            aria-label={`Your answer to question ${q + 1}`}
            disabled={busy}
          />
          <div className="cf-read-actions">
            {canListen && (
              <button type="button" className={`cf-btn cf-btn-ghost cf-read-mic${listening ? " is-on" : ""}`} onClick={listen} disabled={busy}>
                {listening ? "■ Stop" : "🎙 Say it"}
              </button>
            )}
            <button className="cf-btn" type="submit" disabled={busy || !answer.trim()}>
              {busy ? "Checking…" : "Check"}
            </button>
          </div>
        </form>
      )}
      {error && <p className="cf-error">{error}</p>}
      {tries.map((t, i) => (
        <div key={t.at + i} className={`cf-read-try is-${t.grade}`}>
          <p className="cf-read-grade">
            <b>{GRADE[t.grade]}</b>
            {!t.understood && <span> · not what the piece says</span>}
          </p>
          <p className="cf-zh cf-read-said">{t.answer}</p>
          {t.fixed && t.fixed !== t.answer && <p className="cf-zh cf-read-fixed">{t.fixed}</p>}
          {t.why && <p className="cf-muted">{t.why}</p>}
        </div>
      ))}
    </div>
  );
}
