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
import { MilestoneList } from "./Milestones";
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

/** Where an addition came from, in a word or two. */
function sourceLabel(source: string): string {
  if (source === "anki") return "from Pleco";
  if (source === "page") return "from its page";
  if (source === "longku") return "from 龙库";
  if (source.startsWith("list:")) return `from ${source.slice(5).split("/").pop()}`;
  if (source.startsWith("lookup:")) return "from Look up";
  if (source.startsWith("episode:")) return `from ${source.slice(8)}`;
  if (source.startsWith("text:")) return `from ${source.slice(5)}`;
  return source;
}

const DAY_MS = 86_400_000;
/** A study day's date, `back` days before today's (it turns over at 04:00). */
const dayDate = (back: number) => new Date(Date.now() - 4 * 3_600_000 - back * DAY_MS);
const dayName = (back: number) =>
  back === 0 ? "Today" : back === 1 ? "Yesterday" : dayDate(back).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

/**
 * The habit laid out: today against the goal and the streak, a week of bars
 * against the goal (‹ › to earlier weeks, a tap on a bar picks its day), the
 * goal to change, and the words added on the day picked, each opening its
 * page, with Remove (a second tap to be sure) taking it out of the deck
 * again (the owner: "let me see all the words that I've added… scroll
 * through previous days… an easy way to unadd words"). Words worth adding
 * were offered here until the owner said they didn't care for them.
 */
function HabitSheet({ habit, onChanged, onClose }: { habit: HabitView; onChanged: () => void; onClose: () => void }) {
  const [back, setBack] = useState(0);
  const [page, setPage] = useState(0);
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const total = habit.days.length;
  const pages = Math.ceil(total / 7);
  // The week shown: seven days ending `page` weeks before today, oldest first.
  const week = Array.from({ length: 7 }, (_, k) => 7 * page + 6 - k).filter((b) => b < total);
  const countOf = (b: number) => habit.days[total - 1 - b] ?? 0;
  const top = Math.max(habit.goal, ...week.map(countOf), 1);
  const words = habit.added.filter((a) => a.back === back && !removed.has(a.word));
  const remove = async (word: string) => {
    setBusy(word);
    setError(null);
    try {
      await send("word", { word, action: "remove" });
      setRemoved((s) => new Set(s).add(word));
      setAsking(null);
      wordpage.changed({ word, change: "removed" });
      onChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };
  const turn = (to: number) => {
    setPage(to);
    setBack(7 * to);
    setAsking(null);
  };
  return (
    <Sheet label="New words" onClose={onClose}>
      <h2 className="cf-choice-h">New words</h2>
      <p className="cf-habit-big">
        <b>{fmt(habit.today)}</b> / {fmt(habit.goal)} today
        {habit.streak > 0 && <span className="cf-habit-streak">{fmt(habit.streak)}-day streak</span>}
      </p>
      {/* A week: a bar a day, the goal as a line across; a tap picks the day. */}
      <div className="cf-habit-weeknav">
        <button className="cf-lp-step" onClick={() => turn(page + 1)} disabled={page >= pages - 1} aria-label="Week before">
          ‹
        </button>
        <span>{page === 0 ? "This week" : `${dayDate(week[0]).toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${dayDate(week[week.length - 1]).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`}</span>
        <button className="cf-lp-step" onClick={() => turn(page - 1)} disabled={page === 0} aria-label="Week after">
          ›
        </button>
      </div>
      <div className="cf-habit-week">
        <i className="cf-habit-goal" style={{ bottom: `calc(18px + ${habit.goal / top} * (100% - 18px))` }} />
        {week.map((b) => {
          const n = countOf(b);
          return (
            <button
              key={b}
              className={`cf-habit-day${n >= habit.goal ? " is-met" : ""}${b === back ? " is-today" : ""}`}
              onClick={() => {
                setBack(b);
                setAsking(null);
              }}
              aria-pressed={b === back}
              aria-label={`${dayName(b)}: ${n} added`}
            >
              <i style={{ height: `${Math.max(n ? 6 : 2, (100 * n) / top)}%` }} />
              <small>{b === 0 ? "Today" : dayDate(b).toLocaleDateString(undefined, { weekday: "short" })}</small>
            </button>
          );
        })}
      </div>
      <p className="cf-habit-goalline">
        <span>Goal, words a day</span>
        <Stepper name="Goal, words a day" steps={GOALS} value={habit.goal} label={(n) => fmt(n)} onChange={(goal) => void send("habit", { goal }).then(onChanged)} />
      </p>

      <h3 className="cf-h3">
        {dayName(back)} · {fmt(words.length)} {words.length === 1 ? "word" : "words"}
      </h3>
      {error && <p className="cf-error">{error}</p>}
      {words.length ? (
        <ul className="cf-habit-suggest">
          {words.map((a) => (
            <li key={a.word}>
              <button className="cf-habit-word" onClick={() => wordpage.openWordPage(a.word)}>
                <span className="cf-zh">{a.word}</span>
                <span className="cf-habit-word-body">
                  {a.pinyin && <span>{displayPinyin(a.pinyin)}</span>}
                  {a.gloss && <small>{a.gloss}</small>}
                  <small className="cf-habit-from">{sourceLabel(a.source)}</small>
                </span>
              </button>
              {asking === a.word ? (
                <button className="cf-link cf-habit-remove is-sure" disabled={busy !== null} onClick={() => void remove(a.word)}>
                  {busy === a.word ? "Removing…" : "Remove it"}
                </button>
              ) : (
                <button className="cf-link cf-habit-remove" disabled={busy !== null} onClick={() => setAsking(a.word)} aria-label={`Remove ${a.word} from the deck`}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="cf-muted">No words added {back === 0 ? "yet today" : "that day"}.</p>
      )}
      {asking && <p className="cf-muted cf-choice-note">Removing takes its cards and answers with it; it goes back on its list if it was on one.</p>}
      <MilestoneList />
    </Sheet>
  );
}
