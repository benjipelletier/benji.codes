"use client";

// The days either side of today, on Today: a bar a day, sliding sideways,
// today in the middle. Days before show what was reviewed (grey), days after
// what falls due (blue); today's shows what is done and, paler, what is left.
// Kept quiet at the owner's request: one colour, the date alone, one line
// beneath (the streak and pace, or the day tapped). Data from
// app/api/chongfuxi/days.ts.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DayBar, Days, SessionKinds, Summary } from "@chongfuxi/lib/api";
import { get, today as studyToday } from "@chongfuxi/lib/client";
import { fmt } from "./shared";


const total = (b: Omit<DayBar, "day">) => b.read + b.recall + b.sentence + b.learn;

function dateOf(day: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { ...opts, timeZone: "UTC" });
}

/**
 * What is left today, by kind, counted as Today's headline counts it: under
 * the kinds chosen, a word with both cards due once (`dueWords`), and the
 * words waiting for Learn.
 */
function leftToday(s: Summary, kinds: SessionKinds): Omit<DayBar, "day"> {
  const words = kinds.read && kinds.recall ? s.dueWords : kinds.read ? s.dueRead : kinds.recall ? s.dueRecall : 0;
  const read = kinds.read ? Math.min(s.dueRead, words) : 0;
  return {
    read,
    recall: words - read,
    sentence: kinds.sentences ? s.dueSentences : 0,
    learn: kinds.learn ? s.toLearn : 0,
  };
}

export function DayStrip({ summary, kinds }: { summary: Summary; kinds: SessionKinds }) {
  const [days, setDays] = useState<Days | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  // The month of the leftmost day in view, at the chart's top left; it changes as the strip slides.
  const [month, setMonth] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const todayCol = useRef<HTMLButtonElement>(null);
  const centred = useRef(false);

  // Again whenever an answer moves the counts.
  useEffect(() => {
    get<Days>("days", studyToday())
      .then(setDays)
      .catch(() => {
        // The strip is a nicety: without it, Today still works.
      });
  }, [summary.answeredToday]);

  // Today in the middle, once.
  useLayoutEffect(() => {
    const box = scroller.current;
    const col = todayCol.current;
    if (!days || !box || !col || centred.current) return;
    box.scrollLeft = col.offsetLeft - box.clientWidth / 2 + col.clientWidth / 2;
    centred.current = true;
    showMonth();
  }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The month of the first day whose bar is in view. */
  const showMonth = () => {
    const box = scroller.current;
    if (!box) return;
    const first = [...box.querySelectorAll<HTMLElement>("[data-day]")].find((el) => el.offsetLeft + el.clientWidth / 2 >= box.scrollLeft);
    if (first) setMonth(dateOf(first.dataset.day!, { month: "long" }));
  };

  const left = leftToday(summary, kinds);
  const max = useMemo(() => {
    if (!days) return 1;
    return Math.max(1, ...days.past.map(total), ...days.ahead.map(total), total(days.today) + total(left));
  }, [days, left]);

  if (!days) return <div className="cf-strip is-loading" aria-hidden="true" />;

  // A share of the bar's height (set in CSS), by the square root, so today's pile doesn't flatten the rest.
  const height = (n: number) => (n > 0 ? Math.max(3, 100 * Math.sqrt(n / max)) : 0);
  /** One bar: done (or due) solid, today's still to go paler above it; as tall as the sum. */
  const bar = (solid: number, pale = 0) => {
    const h = height(solid + pale);
    const sum = solid + pale || 1;
    return (
      <>
        {solid > 0 && <i className="is-solid" style={{ height: `${(h * solid) / sum}%` }} />}
        {pale > 0 && <i className="is-pale" style={{ height: `${(h * pale) / sum}%` }} />}
      </>
    );
  };

  const shown = picked;
  // One line: the pace, or the day tapped.
  const line = (() => {
    if (shown === null) return null;
    if (shown === days.today.day) {
      return `Today · ${fmt(total(days.today) - days.today.learn)} reviewed · ${fmt(total(left))} to go`;
    }
    const b = [...days.past, ...days.ahead].find((x) => x.day === shown)!;
    const when = dateOf(shown, { weekday: "short", day: "numeric", month: "short" });
    return shown > days.today.day ? `${when} · ${fmt(total(b))} due` : `${when} · ${fmt(total(b) - b.learn)} reviewed`;
  })();

  const nextWeek = days.ahead.slice(0, 7).reduce((n, b) => n + total(b), 0);
  const column = (b: DayBar, kind: "past" | "today" | "ahead") => {
    const isToday = kind === "today";
    const n = isToday ? total(b) + total(left) : total(b);
    return (
      <button
        key={b.day}
        data-day={b.day}
        ref={isToday ? todayCol : undefined}
        type="button"
        className={`cf-strip-day is-${kind}${shown === b.day ? " is-picked" : ""}`}
        onClick={() => setPicked(b.day === picked ? null : b.day)}
        aria-label={`${isToday ? "Today" : dateOf(b.day, { weekday: "long", day: "numeric", month: "long" })}, ${fmt(n)} ${
          kind === "ahead" ? "due" : isToday ? "today" : "reviewed"
        }`}
        aria-pressed={shown === b.day}
      >
        <span className="cf-strip-bar" aria-hidden="true">
          {isToday ? bar(total(b), total(left)) : bar(total(b))}
        </span>
        <span className="cf-strip-label" aria-hidden="true">
          {isToday ? "Today" : dateOf(b.day, { day: "numeric" })}
        </span>
      </button>
    );
  };

  return (
    <section className="cf-strip" aria-label="Reviews by day">
      {month && <span className="cf-strip-month">{month}</span>}
      <div className="cf-strip-days" ref={scroller} onScroll={showMonth}>
        {days.past.map((b) => column(b, "past"))}
        {column(days.today, "today")}
        {days.ahead.map((b) => column(b, "ahead"))}
      </div>
      <p className="cf-strip-pace">
        {line ?? (
          <>
            {days.streak > 0 && (
              <>
                <b>{fmt(days.streak)}</b>-day streak ·{" "}
              </>
            )}
            <b>{fmt(days.weekAverage)}</b> a day this week · <b>{fmt(nextWeek)}</b> due next week
          </>
        )}
      </p>
    </section>
  );
}
