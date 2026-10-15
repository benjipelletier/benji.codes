// The days either side of today, for the strip on Today: what was reviewed
// each day before, and what falls due each day after, by kind of card; with
// the streak and this week's pace. Read straight from the review log, the
// Learn log and the cards.

import type { Sql } from "./db";
import { ACTIVE, WAITING_TO_LEARN } from "./review";
import type { DayBar, Days } from "@chongfuxi/lib/api";
import type { StudyDay } from "@chongfuxi/lib/day";

/** Days shown before today. */
const PAST_DAYS = 28;
/** Days shown after today. */
const AHEAD_DAYS = 30;

const DAY_MS = 86_400_000;

/** The date `n` days from `day` (YYYY-MM-DD), as a study day is named. */
function shift(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

const emptyBar = (day: string): DayBar => ({ day, read: 0, recall: 0, sentence: 0, learn: 0 });

export async function getDays(sql: Sql, owner: string, day: StudyDay): Promise<Days> {
  const [answers, steps, due, streakRows] = await Promise.all([
    sql.query(
      `select to_char(day, 'YYYY-MM-DD') as day,
              count(*) filter (where kind = 'read')::int as read,
              count(*) filter (where kind = 'produce')::int as recall,
              count(*) filter (where kind = 'sentence')::int as sentence
       from chongfuxi_review
       where owner_email = $1 and cause = 'answer' and day > $2::date - $3::int
       group by day`,
      [owner, day.day, PAST_DAYS + 1],
    ) as unknown as Promise<Array<{ day: string; read: number; recall: number; sentence: number }>>,
    // Learn steps taken, from its own log: they are not answers.
    sql.query(
      `select to_char(day, 'YYYY-MM-DD') as day, sum(jsonb_array_length(steps))::int as n
       from chongfuxi_learn
       where owner_email = $1 and day > $2::date - $3::int
       group by day`,
      [owner, day.day, PAST_DAYS + 1],
    ) as unknown as Promise<Array<{ day: string; n: number }>>,
    // Day d (1 = tomorrow) is what falls due in that study day; a new
    // sentence and a word waiting for Learn aren't due.
    sql.query(
      `select ceil(extract(epoch from (c.due - to_timestamp($2::double precision / 1000))) / 86400)::int as d,
              count(*) filter (where c.kind = 'read')::int as read,
              count(*) filter (where c.kind = 'produce')::int as recall,
              count(*) filter (where c.kind = 'sentence')::int as sentence
       from chongfuxi_card c
       where c.owner_email = $1 and ${ACTIVE} and not ${WAITING_TO_LEARN}
         and not (c.kind = 'sentence' and c.state = 0)
         and c.due > to_timestamp($2::double precision / 1000)
         and c.due <= to_timestamp($2::double precision / 1000) + make_interval(days => $3::int)
       group by 1`,
      [owner, day.cutoff, AHEAD_DAYS],
    ) as unknown as Promise<Array<{ d: number; read: number; recall: number; sentence: number }>>,
    // Every day anything was answered, newest first, for the streak.
    sql.query(
      `select to_char(day, 'YYYY-MM-DD') as day from chongfuxi_review
       where owner_email = $1 and cause = 'answer' and day <= $2::date
       group by day order by day desc limit 400`,
      [owner, day.day],
    ) as unknown as Promise<Array<{ day: string }>>,
  ]);

  const byDay = new Map<string, DayBar>();
  for (let n = -PAST_DAYS; n <= 0; n++) {
    const d = shift(day.day, n);
    byDay.set(d, emptyBar(d));
  }
  for (const a of answers) {
    const bar = byDay.get(a.day);
    if (bar) Object.assign(bar, { read: a.read, recall: a.recall, sentence: a.sentence });
  }
  for (const s of steps) {
    const bar = byDay.get(s.day);
    if (bar) bar.learn = s.n;
  }
  const past = [...byDay.values()];
  const today = past.pop()!;

  const ahead = Array.from({ length: AHEAD_DAYS }, (_, i) => emptyBar(shift(day.day, i + 1)));
  for (const r of due) {
    const bar = ahead[r.d - 1];
    if (bar) Object.assign(bar, { read: r.read, recall: r.recall, sentence: r.sentence });
  }

  // Days in a row with an answer, counting today only once there is one.
  const answered = new Set(streakRows.map((r) => r.day));
  let streak = 0;
  for (let n = answered.has(day.day) ? 0 : -1; answered.has(shift(day.day, n)); n--) streak++;

  const total = (b: DayBar) => b.read + b.recall + b.sentence;
  const week = [...past.slice(-6), today];
  return {
    past,
    today,
    ahead,
    streak,
    weekAverage: Math.round(week.reduce((n, b) => n + total(b), 0) / week.length),
  };
}
