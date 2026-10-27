"use client";

// Muse's weekly debrief (app/api/chongfuxi/week.ts): the week's figures,
// counted by the app, beside the week before, and Muse's reading of them
// (what got better, what is still stuck and why, what was looked up, what it
// will aim at next week). The owner chose it from Muse's next steps.

import { useEffect, useState } from "react";
import type { WeekReport, WeekSection } from "@chongfuxi/lib/api";
import { get } from "@chongfuxi/lib/client";
import * as wordpage from "@chongfuxi/lib/wordpage";
import { Loading, fmt, message } from "./shared";

const KIND: Record<WeekSection["kind"], string> = {
  better: "Got stronger",
  stuck: "Still stuck",
  looked: "What you looked up",
  focus: "Next week",
  note: "Worth knowing",
};

/** The latest debrief, or null when Muse hasn't written one; undefined while loading. */
export function useWeek(): WeekReport | null | undefined {
  const [week, setWeek] = useState<WeekReport | null | undefined>(undefined);
  useEffect(() => {
    get<{ week: WeekReport | null }>("week")
      .then((r) => setWeek(r.week))
      .catch(() => setWeek(null));
  }, []);
  return week;
}

const pct = (got: number, total: number) => (total ? Math.round((got / total) * 100) : null);
const short = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** The days a debrief covers, "Oct 20 – Oct 26". */
export const weekSpan = (w: WeekReport) => `${short(w.figures.from)} – ${short(w.figures.to)}`;

/** A figure beside last week's: up or down by how much, or level. */
function Tile({ label, now, before, unit = "" }: { label: string; now: number | null; before: number | null; unit?: string }) {
  const diff = now !== null && before !== null ? now - before : null;
  return (
    <div className="cf-wk-tile">
      <span className="cf-wk-tile-n">
        {now === null ? "–" : fmt(now)}
        {now !== null && unit}
      </span>
      <span className="cf-wk-tile-l">{label}</span>
      {diff !== null && (
        <span className={`cf-wk-tile-d ${diff > 0 ? "is-up" : diff < 0 ? "is-down" : ""}`}>
          {diff > 0 ? "▲ " : diff < 0 ? "▼ " : ""}
          {diff === 0 ? "same as last week" : `${fmt(Math.abs(diff))}${unit === "%" ? " pts" : unit} on last week`}
        </span>
      )}
    </div>
  );
}

/** Muse's text with the section's words marked, each opening its page. */
function Marked({ text, words }: { text: string; words: string[] }) {
  const sorted = [...new Set(words)].sort((a, b) => b.length - a.length);
  if (!sorted.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${sorted.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`));
  return (
    <>
      {parts.map((p, i) =>
        sorted.includes(p) ? (
          <button key={i} className="cf-wk-w cf-zh" onClick={() => wordpage.openWordPage(p)}>
            {p}
          </button>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function Words({ words }: { words: string[] }) {
  if (!words.length) return null;
  return (
    <div className="cf-wk-words">
      {words.map((w) => (
        <button key={w} className="cf-wk-word cf-zh" onClick={() => wordpage.openWordPage(w)}>
          {w}
        </button>
      ))}
    </div>
  );
}

/** The debrief, full screen. */
export function WeekView({ onEnd }: { onEnd: () => void }) {
  const [week, setWeek] = useState<WeekReport | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    get<{ week: WeekReport | null }>("week")
      .then((r) => setWeek(r.week))
      .catch((e) => setError(message(e)));
  }, []);
  const f = week?.figures;
  const progressed = f?.episodes.filter((e) => e.from !== null && e.to !== null && e.to !== e.from) ?? [];
  return (
    <div className="cf-rescue">
      <div className="cf-fast-top">
        <button className="cf-close" onClick={onEnd} aria-label="Back to the list">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <p className="cf-rescue-top">Weekly debrief</p>
      </div>
      <div className="cf-rescue-in cf-wk">
        {error && <p className="cf-error">{error}</p>}
        {week === undefined && !error && <Loading label="Opening…" />}
        {week === null && <p className="cf-muted">No debrief yet. Muse writes one at the end of each week from what you did.</p>}
        {week && f && (
          <>
            <p className="cf-muted cf-story-by">
              {weekSpan(week)} · by {week.model}
            </p>
            <h1 className="cf-wk-title">{week.title}</h1>
            <div className="cf-wk-tiles">
              <Tile label="cards answered" now={f.answers.total} before={f.before.total} />
              <Tile label="got it" now={pct(f.answers.got, f.answers.total)} before={pct(f.before.got, f.before.total)} unit="%" />
              <Tile label="minutes" now={f.minutes} before={f.before.minutes} />
              <Tile label="days studied" now={f.days} before={f.before.days} />
            </div>
            <ul className="cf-wk-facts">
              <li>
                <b>{fmt(f.learnt.length)}</b> {f.learnt.length === 1 ? "word" : "words"} learnt
              </li>
              <li>
                <b>{fmt(f.matured.length)}</b> {f.matured.length === 1 ? "card" : "cards"} matured
              </li>
              {f.drills.answered > 0 && (
                <li>
                  <b>
                    {fmt(f.drills.got)}/{fmt(f.drills.answered)}
                  </b>{" "}
                  on Muse&apos;s reviews
                </li>
              )}
              <li>
                <b>{fmt(f.lookups.length)}</b> {f.lookups.length === 1 ? "lookup" : "lookups"}
              </li>
              <li>
                <b>{fmt(f.notes)}</b> {f.notes === 1 ? "note" : "notes"}
              </li>
            </ul>
            {week.sections.map((s, i) => (
              <section key={i} className={`cf-wk-sec is-${s.kind}`}>
                <h2>
                  <span className="cf-wk-kind">{KIND[s.kind]}</span>
                  {s.title && <span className="cf-wk-sec-title">{s.title}</span>}
                </h2>
                <p>
                  <Marked text={s.text} words={s.words} />
                </p>
                <Words words={s.words.filter((w) => !s.text.includes(w))} />
              </section>
            ))}
            {week.focus.length > 0 && (
              <section className="cf-wk-sec is-focus">
                <h2>
                  <span className="cf-wk-kind">Muse will aim at</span>
                </h2>
                <Words words={week.focus} />
              </section>
            )}
            {(f.forgotten.length > 0 || f.matured.length > 0 || progressed.length > 0) && (
              <details className="cf-wk-more">
                <summary>The week&apos;s words</summary>
                {f.forgotten.length > 0 && (
                  <>
                    <h3>Forgotten most</h3>
                    <div className="cf-wk-words">
                      {f.forgotten.map((w) => (
                        <button key={w.word} className="cf-wk-word" onClick={() => wordpage.openWordPage(w.word)}>
                          <span className="cf-zh">{w.word}</span> <small>×{w.times}</small>
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {f.matured.length > 0 && (
                  <>
                    <h3>Matured</h3>
                    <Words words={[...new Set(f.matured.map((m) => m.word))]} />
                  </>
                )}
                {f.learnt.length > 0 && (
                  <>
                    <h3>Learnt</h3>
                    <Words words={f.learnt} />
                  </>
                )}
                {progressed.length > 0 && (
                  <>
                    <h3>Episodes</h3>
                    <ul className="cf-wk-eps">
                      {progressed.map((e) => (
                        <li key={e.id}>
                          {e.show} · {e.episode}: {Math.round((e.from ?? 0) * 100)}% → {Math.round((e.to ?? 0) * 100)}% known
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}
