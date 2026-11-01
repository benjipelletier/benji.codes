// A habit of adding words (the owner: "a way to track and make sure I keep
// adding new words every day… I want the app to guide me through it"): a
// daily goal of words added to the deck, how many today and on the days
// before, the streak of days that met it, and the words themselves, day by
// day (the owner: "let me see all the words that I've added… scroll through
// previous days"; words worth adding next were offered here until they
// said they didn't care for them). Words count however they came in (an
// Anki sync from Pleco, a list, a word's page, Look up, an episode): every
// addition (additions.ts), less those undone and those no longer in the deck.

import type { HabitView } from "@chongfuxi/lib/api";
import type { StudyDay } from "@chongfuxi/lib/day";
import type { Definition } from "@chongfuxi/lib/dict";
import type { Sql } from "./db";
import { shownPinyin } from "./review";

/** Words a day to start with, until the owner sets their own. */
export const ADD_GOAL_DEFAULT = 5;
/** The largest goal that can be set. */
export const ADD_GOAL_TOP = 100;
/** Days of history sent, a week at a time on screen, with their words; and looked back over for the streak. */
const DAYS_SHOWN = 84;
const STREAK_DAYS = 365;

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
 * Each word added within `days` study days, still in the deck, with how many
 * days back from today it counts on (0 today, 1 yesterday…): study days end
 * at the day's cutoff, so the days follow the owner's rollover wherever they
 * are. A word from Pleco comes in when AnkiDroid syncs, which can be the next
 * day: it counts on the day its Anki note was made (the note id is that
 * moment, in ms), not the sync's (the owner saw yesterday's words counted
 * today). Others count when added. A word taken out of the deck again (from
 * here, its page or anywhere) no longer counts.
 */
async function addedWords(sql: Sql, owner: string, day: StudyDay, days: number) {
  return (await sql`
    with added as (
      select e.value->>'word' as word, a.source,
             coalesce(
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
    select distinct on (d.word) d.word, d.source, w.pinyin, w.defs, w.glosses,
           floor((${day.cutoff}::double precision - extract(epoch from d.at) * 1000) / ${DAY_MS})::int as back,
           (extract(epoch from d.at) * 1000)::double precision as at
    from added d
    join chongfuxi_word w on w.owner_email = ${owner} and w.word = d.word and w.status = 'deck'
    where d.at > to_timestamp((${day.cutoff}::double precision - ${days * DAY_MS}) / 1000)
      and d.at <= to_timestamp(${day.cutoff}::double precision / 1000)
    order by d.word, d.at desc
  `) as unknown as Array<{ word: string; source: string; pinyin: string | null; defs: Definition[] | null; glosses: string[] | null; back: number; at: number }>;
}

/** The goal, today and the days before, the streak, and the words added each day. Readable by anyone. */
export async function habitView(sql: Sql, owner: string, day: StudyDay): Promise<HabitView> {
  const [goal, rows] = await Promise.all([addGoal(sql, owner), addedWords(sql, owner, day, STREAK_DAYS)]);
  const byDay = Array.from({ length: STREAK_DAYS }, () => 0);
  for (const r of rows) if (r.back >= 0 && r.back < STREAK_DAYS) byDay[r.back]++;
  // The streak counts days that met the goal, back from yesterday; today joins it once met.
  let streak = 0;
  for (let back = byDay[0] >= goal ? 0 : 1; back < byDay.length && byDay[back] >= goal; back++) streak++;
  return {
    goal,
    today: byDay[0],
    streak,
    // Oldest first, today last.
    days: byDay.slice(0, DAYS_SHOWN).reverse(),
    added: rows
      .filter((r) => r.back < DAYS_SHOWN)
      .sort((x, y) => y.at - x.at)
      .map((r) => ({ word: r.word, back: r.back, source: r.source, pinyin: shownPinyin(r.pinyin, r.defs), gloss: r.glosses?.[0] ?? null })),
  };
}
