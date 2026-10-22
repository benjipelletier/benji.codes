"use client";

// On leaving a review session, a quick look back (the owner asked): how many
// cards and how long, how many were got, by kind, the longest run, what was
// new and retired, the new words practised, and the words to look at again.
// Made on the device from the session's own answers; nothing is fetched.

import { useState } from "react";
import type { Answered } from "./Reviewed";
import * as wordpage from "@chongfuxi/lib/wordpage";
import { Sheet, fmt } from "./shared";

/** What a session hands back as it ends: its answers, the Learn steps taken, and when it began. */
export interface SessionReport {
  log: Answered[];
  /** The word of each Learn step taken, in order. */
  steps: string[];
  startedAt: number;
}

const KINDS = [
  { key: "read", label: "Read" },
  { key: "produce", label: "Recall" },
  { key: "sentence", label: "Sentences" },
] as const;

/** Whether a session did enough to look back on. */
export const worthRecap = (r: SessionReport | null): r is SessionReport => Boolean(r && (r.log.length || r.steps.length));

export function RecapSheet({ report, onClose }: { report: SessionReport; onClose: () => void }) {
  const { log, steps } = report;
  // When it was left: the sheet opens then.
  const [endedAt] = useState(() => Date.now());
  const took = endedAt - report.startedAt;
  const got = log.filter((a) => a.grade === "good").length;
  const minutes = Math.max(1, Math.round(took / 60000));
  const pace = log.length ? Math.round(took / 1000 / (log.length + steps.length)) : null;
  let run = 0;
  let best = 0;
  for (const a of log) {
    run = a.grade === "good" ? run + 1 : 0;
    best = Math.max(best, run);
  }
  const fresh = log.filter((a) => a.card.isNew).length;
  const retired = log.filter((a) => a.days === null).length;
  // To look at again: word cards forgotten, then words lapsed by being tapped in a forgotten sentence.
  const again = [
    ...new Set([
      ...log.filter((a) => a.grade === "forgot" && a.card.word).map((a) => a.card.word!.word),
      ...log.flatMap((a) => (a.grade === "forgot" ? (a.lapsed ?? []) : [])),
    ]),
  ];
  const practised = [...new Set(steps)];

  return (
    <Sheet label="Session recap" onClose={onClose}>
      <header className="cf-sheet-head">
        <h2 className="cf-answered-h">Session done</h2>
        <p className="cf-muted">
          {fmt(log.length)} {log.length === 1 ? "card" : "cards"}
          {steps.length > 0 && ` + ${fmt(steps.length)} new-word ${steps.length === 1 ? "step" : "steps"}`} in {fmt(minutes)} min
        </p>
      </header>

      {log.length > 0 && (
        <div className="cf-recap-tiles">
          <div>
            <b>{Math.round((got / log.length) * 100)}%</b>
            <small>got it</small>
          </div>
          <div>
            <b>{fmt(best)}</b>
            <small>best run</small>
          </div>
          {pace !== null && (
            <div>
              <b>{fmt(pace)}s</b>
              <small>a card</small>
            </div>
          )}
        </div>
      )}

      {log.length > 0 && (
        <ul className="cf-recap-kinds">
          {KINDS.map(({ key, label }) => {
            const of = log.filter((a) => a.card.kind === key);
            if (!of.length) return null;
            const ok = of.filter((a) => a.grade === "good").length;
            return (
              <li key={key} className={`is-${key}`}>
                <span>{label}</span>
                <i aria-hidden="true">
                  <i style={{ width: `${(ok / of.length) * 100}%` }} />
                </i>
                <span className="cf-recap-n">
                  {fmt(ok)}/{fmt(of.length)}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {(fresh > 0 || retired > 0) && (
        <p className="cf-recap-line">
          {fresh > 0 && `${fmt(fresh)} seen for the first time`}
          {fresh > 0 && retired > 0 && " · "}
          {retired > 0 && `${fmt(retired)} ${retired === 1 ? "sentence" : "sentences"} retired`}
        </p>
      )}

      {practised.length > 0 && (
        <section className="cf-recap-words">
          <h3 className="cf-rescue-h">New words practised</h3>
          <Chips words={practised} />
        </section>
      )}

      {again.length > 0 && (
        <section className="cf-recap-words">
          <h3 className="cf-rescue-h">To look at again</h3>
          <Chips words={again} />
        </section>
      )}

      <button className="cf-btn cf-recap-done" onClick={onClose}>
        Done
      </button>
    </Sheet>
  );
}

function Chips({ words }: { words: string[] }) {
  return (
    <div className="cf-recap-chips">
      {words.map((w) => (
        <button key={w} className="cf-lk-wchip" onClick={() => wordpage.openWordPage(w)}>
          <span className="cf-zh">{w}</span> ›
        </button>
      ))}
    </div>
  );
}
