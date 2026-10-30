"use client";

// Adding words as a habit, on Today (the owner: "make sure I keep adding new
// words every day… I want the app to guide me through it"): a ring of today's
// words against the daily goal, the streak, and a sheet with the week, the
// goal, and words worth adding a tap away (app/api/chongfuxi/habit.ts). Also
// `Stepper`, how the goal and Today's daily max are changed.

import { useCallback, useEffect, useRef, useState } from "react";
import type { HabitView } from "@chongfuxi/lib/api";
import { get, send, today } from "@chongfuxi/lib/client";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import * as wordpage from "@chongfuxi/lib/wordpage";
import { Sheet, fmt, message, type Shell } from "./shared";

/**
 * A number changed a step at a time, − and + either side of it, in place of
 * a drop-down (the owner disliked those). Taps change it at once on screen
 * and are sent half a second after the last, or on leaving.
 */
export function Stepper<T extends number | null>({
  name,
  steps,
  value,
  label,
  onChange,
}: {
  name: string;
  /** In order, smallest first. */
  steps: T[];
  value: T;
  label: (v: T) => string;
  onChange: (v: T) => void;
}) {
  const [shown, setShown] = useState<T>(value);
  const pending = useRef<{ timer: number; v: T } | null>(null);
  const send = useRef(onChange);
  send.current = onChange;
  useEffect(() => {
    if (!pending.current) setShown(value);
  }, [value]);
  // Leaving with a change not yet sent sends it.
  useEffect(
    () => () => {
      const p = pending.current;
      if (!p) return;
      window.clearTimeout(p.timer);
      send.current(p.v);
    },
    [],
  );
  // A value between the steps sits at the nearest one; none (null) is past the last.
  let at = steps.indexOf(shown);
  if (at < 0)
    at =
      shown === null
        ? steps.length - 1
        : steps.reduce((best, s, k) => (s !== null && Math.abs(s - shown) < Math.abs((steps[best] ?? Infinity) - shown) ? k : best), 0);
  const go = (d: number) => {
    const next = steps[Math.max(0, Math.min(steps.length - 1, at + d))];
    setShown(next);
    if (pending.current) window.clearTimeout(pending.current.timer);
    pending.current = {
      v: next,
      timer: window.setTimeout(() => {
        pending.current = null;
        send.current(next);
      }, 500),
    };
  };
  return (
    <span className="cf-stepper" role="group" aria-label={name}>
      <button type="button" aria-label="Fewer" disabled={at <= 0} onClick={() => go(-1)}>
        −
      </button>
      <output aria-live="polite">{label(shown)}</output>
      <button type="button" aria-label="More" disabled={at >= steps.length - 1} onClick={() => go(1)}>
        +
      </button>
    </span>
  );
}

const GOALS = [1, 3, 5, 10, 15, 20, 30, 50];

/** Today's words added, as a ring: full, with a tick, once the goal is met. */
function Ring({ n, goal }: { n: number; goal: number }) {
  const r = 8;
  const c = 2 * Math.PI * r;
  const share = Math.min(1, goal ? n / goal : 1);
  return (
    <svg className={`cf-habit-ring${share >= 1 ? " is-met" : ""}`} viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <circle cx="10" cy="10" r={r} className="cf-habit-ring-bg" />
      <circle cx="10" cy="10" r={r} className="cf-habit-ring-fg" strokeDasharray={`${share * c} ${c}`} transform="rotate(-90 10 10)" />
      {share >= 1 && <path d="M6.5 10.3l2.3 2.3 4.7-5" className="cf-habit-tick" />}
    </svg>
  );
}

/**
 * On Today, beside the date so it costs the screen no height: a small ring
 * of today's words against the goal and "2 / 5 words", opening the sheet.
 * Only the owner adds words, so only the owner sees it.
 */
export function HabitPill({ shell }: { shell: Shell }) {
  const [habit, setHabit] = useState<HabitView | null>(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => {
    get<HabitView>("habit", today())
      .then(setHabit)
      .catch(() => setHabit(null));
  }, []);
  // Again whenever the counts move (an addition anywhere refreshes the summary).
  useEffect(load, [load, shell.summary]);
  if (!shell.canWrite || !habit) return null;
  const met = habit.today >= habit.goal;
  return (
    <>
      <button
        className={`cf-habit${met ? " is-met" : ""}`}
        onClick={() => setOpen(true)}
        aria-label={`${habit.today} of ${habit.goal} new words today${habit.streak ? `, ${habit.streak}-day streak` : ""}`}
      >
        <Ring n={habit.today} goal={habit.goal} />
        <span className="cf-habit-text">
          Added <b>{fmt(habit.today)}</b> / {fmt(habit.goal)}
        </span>
        <svg viewBox="0 0 6 10" width="6" height="10" aria-hidden="true">
          <path d="M1 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && <HabitSheet habit={habit} onChanged={() => (load(), shell.refresh())} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The week as bars against the goal, the goal to change, and words worth adding, each a tap. */
function HabitSheet({ habit, onChanged, onClose }: { habit: HabitView; onChanged: () => void; onClose: () => void }) {
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const top = Math.max(habit.goal, ...habit.week, 1);
  const days = habit.week.map((n, k) => {
    const d = new Date(Date.now() - (habit.week.length - 1 - k) * 86_400_000);
    return {
      n,
      label: k === habit.week.length - 1 ? "Today" : d.toLocaleDateString(undefined, { weekday: "short" }),
    };
  });
  const add = async (word: string) => {
    setBusy(word);
    setError(null);
    try {
      await send("word", { word, action: "add" });
      setAdded((s) => new Set(s).add(word));
      wordpage.changed({ word, change: "added" });
      onChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <Sheet label="New words" onClose={onClose}>
        <h2 className="cf-choice-h">New words</h2>
        <p className="cf-habit-big">
          <b>{fmt(habit.today)}</b> / {fmt(habit.goal)} today
          {habit.streak > 0 && <span className="cf-habit-streak">{fmt(habit.streak)}-day streak</span>}
        </p>
        {/* The week: a bar a day, the goal as a line across. */}
        <div className="cf-habit-week" role="img" aria-label={days.map((d) => `${d.label} ${d.n}`).join(", ")}>
          <i className="cf-habit-goal" style={{ bottom: `calc(18px + ${habit.goal / top} * (100% - 18px))` }} />
          {days.map((d, k) => (
            <span key={k} className={`cf-habit-day${d.n >= habit.goal ? " is-met" : ""}${k === days.length - 1 ? " is-today" : ""}`}>
              <i
                style={{
                  height: `${Math.max(d.n ? 6 : 2, (100 * d.n) / top)}%`,
                }}
              />
              <small>{d.label}</small>
            </span>
          ))}
        </div>
        <p className="cf-habit-goalline">
          <span>Goal, words a day</span>
          <Stepper name="Goal, words a day" steps={GOALS} value={habit.goal} label={(n) => fmt(n)} onChange={(goal) => void send("habit", { goal }).then(onChanged)} />
        </p>

        <h3 className="cf-h3">Worth adding next</h3>
        <p className="cf-muted cf-choice-note">On your lists, and each the one word keeping some of your sentences locked.</p>
        {error && <p className="cf-error">{error}</p>}
        <ul className="cf-habit-suggest">
          {habit.suggest.map((b) => (
            <li key={b.word}>
              <button className="cf-habit-word" onClick={() => wordpage.openWordPage(b.word)}>
                <span className="cf-zh">{b.word}</span>
                <span className="cf-habit-word-body">
                  {b.pinyin && <span>{displayPinyin(b.pinyin)}</span>}
                  {b.gloss && <small>{b.gloss}</small>}
                </span>
                <small className="cf-habit-unlocks">+{fmt(b.unlocks)}</small>
              </button>
              {added.has(b.word) ? (
                <span className="cf-habit-added">✓ Added</span>
              ) : (
                <button className="cf-link" disabled={busy !== null} onClick={() => void add(b.word)}>
                  {busy === b.word ? "Adding…" : "+ Add"}
                </button>
              )}
            </li>
          ))}
        </ul>
        {!habit.suggest.length && <p className="cf-muted">Nothing on your lists holds sentences back: add from Pleco, or Cards › Lists.</p>}
        <p className="cf-muted cf-choice-note">More from Cards › Lists (a lesson at a time), or from Pleco, which syncs in.</p>
      </Sheet>
    </>
  );
}
