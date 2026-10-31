// A habit of adding words (the owner: "a way to track and make sure I keep
// adding new words every day… I want the app to guide me through it"): a
// daily goal of words added to the deck, how many today and on the days
// before, the streak of days that met it, and words worth adding next. Words
// count however they came in (an Anki sync from Pleco, a list, a word's page,
// Look up, an episode): every addition (additions.ts), less those undone.

import type { HabitView } from "@chongfuxi/lib/api";
import type { StudyDay } from "@chongfuxi/lib/day";
import type { Sql } from "./db";
import { listBlockers } from "./review";

/** Words a day to start with, until the owner sets their own. */
export const ADD_GOAL_DEFAULT = 5;
/** The largest goal that can be set. */
export const ADD_GOAL_TOP = 100;
/** Days of history shown, and looked back over for the streak. */
const DAYS_SHOWN = 7;
const STREAK_DAYS = 365;
/** Words offered to add next. */
const SUGGESTED = 6;

const DAY_MS = 86_400_000;

let ready = false;
async function ensureTable(sql: Sql) {
  if (ready) return;
  await sql`
    create table if not exists chongfuxi_add_goal (
      owner_email text primary key,
      goal int not null,
      at timestamptz not null default now()
    )
  `;
  ready = true;
}

export async function addGoal(sql: Sql, owner: string): Promise<number> {
  await ensureTable(sql);
  const [r] = (await sql`select goal from chongfuxi_add_goal where owner_email = ${owner}`) as unknown as Array<{ goal: number }>;
  return r?.goal ?? ADD_GOAL_DEFAULT;
}

/** Set the goal (1 to ADD_GOAL_TOP). Owner only, through route `habit`. */
export async function setAddGoal(sql: Sql, owner: string, goal: number): Promise<number> {
  await ensureTable(sql);
  const g = Math.max(1, Math.min(ADD_GOAL_TOP, Math.round(goal)));
  await sql`
    insert into chongfuxi_add_goal (owner_email, goal) values (${owner}, ${g})
    on conflict (owner_email) do update set goal = excluded.goal, at = now()
  `;
  return g;
}

/**
 * Words added on each study day, counting back from today (0 today, 1
 * yesterday…): study days end at the day's cutoff, so the days follow the
 * owner's rollover wherever they are. A word from Pleco comes in when
 * AnkiDroid syncs, which can be the next day: it counts on the day its Anki
 * note was made (the note id is that moment, in ms), not the sync's (the
 * owner saw yesterday's words counted today). Others count when added.
 */
async function addedByDay(sql: Sql, owner: string, day: StudyDay, days: number): Promise<number[]> {
  const rows = (await sql`
    with added as (
      select coalesce(
               (select to_timestamp(min(n.note_id) / 1000.0) from chongfuxi_anki_note n
                where n.owner_email = a.owner_email and n.addition_id = a.id and n.word = e.value->>'word'),
               a.at
             ) as at
      from chongfuxi_addition a
      cross join jsonb_array_elements(a.words) e
      where a.owner_email = ${owner} and a.undone_at is null
        -- An addition never comes before its words were made, so older ones count for nothing here.
        and a.at > to_timestamp((${day.cutoff}::double precision - ${days * DAY_MS}) / 1000)
    )
    select floor((${day.cutoff}::double precision - extract(epoch from at) * 1000) / ${DAY_MS})::int as back,
           count(*)::int as n
    from added
    where at > to_timestamp((${day.cutoff}::double precision - ${days * DAY_MS}) / 1000)
      and at <= to_timestamp(${day.cutoff}::double precision / 1000)
    group by 1
  `) as unknown as Array<{ back: number; n: number }>;
  const out = Array.from({ length: days }, () => 0);
  for (const r of rows) if (r.back >= 0 && r.back < days) out[r.back] = r.n;
  return out;
}

/** The goal, today and the days before, the streak, and words worth adding next. Readable by anyone. */
export async function habitView(sql: Sql, owner: string, day: StudyDay): Promise<HabitView> {
  const [goal, byDay, blockers] = await Promise.all([addGoal(sql, owner), addedByDay(sql, owner, day, STREAK_DAYS), listBlockers(sql, owner, SUGGESTED)]);
  // The streak counts days that met the goal, back from yesterday; today joins it once met.
  let streak = 0;
  for (let back = byDay[0] >= goal ? 0 : 1; back < byDay.length && byDay[back] >= goal; back++) streak++;
  return {
    goal,
    today: byDay[0],
    streak,
    // Oldest first, today last.
    week: byDay.slice(0, DAYS_SHOWN).reverse(),
    suggest: blockers.learnNext,
  };
}
