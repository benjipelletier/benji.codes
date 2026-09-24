"use client";

import { useMemo } from "react";
import type { State } from "@longku/lib/store";
import { dayStart, daysAfter, dueAt } from "@longku/lib/srs";

/** Days shown either side of today. */
const BACK = 6;
const AHEAD = 7;

type Metric = "due" | "added" | "recalled";

const ROWS: Array<{ key: Metric; label: string; hint: string }> = [
  { key: "due", label: "due", hint: "words due that day — today counts everything overdue" },
  { key: "added", label: "added", hint: "words banked that day" },
  { key: "recalled", label: "recalled", hint: "words produced in play, with or without a hint" },
];

/**
 * Two weeks around today: what was added and recalled over the last week, and
 * what falls due over the next.
 *
 * Due is only meaningful forward — a past day's due words have since been
 * played and rescheduled — and added and recalled only backward, so the grid
 * reads left of today as history and right of it as forecast.
 */
export function DueHeatmap({ state }: { state: State }) {
  const { days, counts, max } = useMemo(() => {
    const now = Date.now();
    const today = dayStart(now);
    const days: number[] = [];
    for (let i = -BACK; i <= AHEAD; i++) days.push(daysAfter(today, i));
    const index = new Map(days.map((d, i) => [d, i]));

    const counts: Record<Metric, Array<number | null>> = {
      due: days.map((d) => (d < today ? null : 0)),
      added: days.map((d) => (d > today ? null : 0)),
      recalled: days.map((d) => (d > today ? null : 0)),
    };
    const bump = (m: Metric, day: number) => {
      const i = index.get(day);
      if (i !== undefined && counts[m][i] !== null) counts[m][i]! += 1;
    };

    for (const e of Object.values(state.bank)) {
      bump("added", dayStart(e.added));
      const due = dueAt(e);
      // Anything overdue lands on today: that's when it's asked for.
      bump("due", due <= now ? today : dayStart(due));
    }
    for (const r of state.reviews) {
      if (r.o === "recall" || r.o === "hint") bump("recalled", dayStart(r.at));
    }

    const max = {} as Record<Metric, number>;
    for (const m of Object.keys(counts) as Metric[]) {
      max[m] = Math.max(1, ...counts[m].map((c) => c ?? 0));
    }
    return { days, counts, max };
  }, [state]);

  const todayIdx = BACK;

  return (
    <div className="longku-heat" role="table" aria-label="Due, added and recalled by day">
      <div className="longku-heat-row is-head" role="row">
        <span className="longku-heat-label" />
        {days.map((d, i) => {
          const date = new Date(d);
          return (
            <span
              key={d}
              role="columnheader"
              className={`longku-heat-day ${i === todayIdx ? "is-today" : ""}`}
              title={date.toLocaleDateString(undefined, {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            >
              <span className="longku-heat-wd">
                {date.toLocaleDateString(undefined, { weekday: "narrow" })}
              </span>
              <span className="longku-heat-dn">{date.getDate()}</span>
            </span>
          );
        })}
      </div>

      {ROWS.map((row) => (
        <div key={row.key} className={`longku-heat-row is-${row.key}`} role="row">
          <span className="longku-heat-label" title={row.hint}>
            {row.label}
          </span>
          {counts[row.key].map((c, i) => (
            <span
              key={days[i]}
              role="cell"
              className={`longku-heat-cell ${c === null ? "is-na" : ""} ${i === todayIdx ? "is-today" : ""} ${c && c / max[row.key] > 0.45 ? "is-hot" : ""}`}
              style={
                c
                  ? ({ "--heat": 0.18 + 0.82 * (c / max[row.key]) } as React.CSSProperties)
                  : undefined
              }
              title={
                c === null
                  ? undefined
                  : `${c} ${row.label} · ${new Date(days[i]).toLocaleDateString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}`
              }
            >
              {c ? c : ""}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
