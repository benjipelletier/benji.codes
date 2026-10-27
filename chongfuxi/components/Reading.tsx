"use client";

// A question to answer in Chinese by voice (the phone's speech recognition)
// or keyboard, each try graded by the app's model or kept for Muse. It came
// from reading with retelling (app/api/chongfuxi/reading.ts), whose screen
// was folded into Muse's page; episodes and the page's ask blocks use it.

import { useEffect, useRef, useState } from "react";
import type { Retell } from "@chongfuxi/lib/api";
import { message } from "./shared";

const GRADE: Record<Retell["grade"], string> = { correct: "✓ Correct", almost: "≈ Almost", wrong: "✗ Wrong" };

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

/** An answer kept for Muse to answer later, not graded now. */
export type KeptAnswer = { kept: true; answer: string; at: number };

/** A question to answer in Chinese, by voice or keyboard, each try graded (`check`) and kept, newest first; or, when `check` gives null, kept for Muse. Used by readings, episodes and Muse's page. */
export function Question({
  question,
  q,
  initial,
  canWrite,
  check,
}: {
  question: { zh: string; en: string };
  q: number;
  initial: Array<Retell | KeptAnswer>;
  canWrite: boolean;
  check: (answer: string) => Promise<Retell | null>;
}) {
  const [answer, setAnswer] = useState("");
  const [english, setEnglish] = useState(false);
  const [tries, setTries] = useState<Array<Retell | KeptAnswer>>(() => [...initial].reverse());
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
      const said = answer.trim();
      setTries((t) => [retell ?? { kept: true, answer: said, at: Date.now() }, ...t]);
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
      {tries.map((t, i) =>
        "kept" in t ? (
          <div key={t.at + i} className="cf-read-try is-kept">
            <p className="cf-read-grade">
              <b>Kept for Muse</b>
              <span> · it answers on your next page</span>
            </p>
            <p className="cf-zh cf-read-said">{t.answer}</p>
          </div>
        ) : (
        <div key={t.at + i} className={`cf-read-try is-${t.grade}`}>
          <p className="cf-read-grade">
            <b>{GRADE[t.grade]}</b>
            {!t.understood && <span> · not what the piece says</span>}
          </p>
          <p className="cf-zh cf-read-said">{t.answer}</p>
          {t.fixed && t.fixed !== t.answer && <p className="cf-zh cf-read-fixed">{t.fixed}</p>}
          {t.why && <p className="cf-muted">{t.why}</p>}
        </div>
        ),
      )}
    </div>
  );
}
