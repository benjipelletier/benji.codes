// The weekly debrief (the owner chose it from Muse's next steps): the app
// counts the week (answers, minutes, words learnt and matured, the words
// forgotten most, lookups, notes, Muse's reviews, episodes), so the figures
// are true, and the owner's agent (Muse) writes what they mean: what got
// better, what is still stuck and why, what was looked up, what it will aim
// at next week. One report per week, keyed by its last study day.

import type { Sql } from "./db";
import type { WeekFigures, WeekReport, WeekSection } from "@chongfuxi/lib/api";
import { AgentError } from "./agent";
import { ownersDay } from "./daily";
import { stuckWords } from "./rescue";

/** Strong enough to call a card mature: three weeks, as on the Words wall. */
const MATURE_DAYS = 21;
/** A gap between answers longer than this was a break (seconds), as for the pace. */
const GAP_MAX = 180;
const SECTIONS_MAX = 8;
const TEXT_MAX = 900;
const KINDS: WeekSection["kind"][] = ["better", "stuck", "looked", "focus", "note"];

let ready = false;
async function ensureTable(sql: Sql) {
  if (ready) return;
  await sql`
    create table if not exists chongfuxi_week (
      owner_email text not null,
      week_to date not null,
      at timestamptz not null default now(),
      model text not null,
      report jsonb not null,
      primary key (owner_email, week_to)
    )
  `;
  ready = true;
}

/** A query on a table that may not be made yet (its feature never used): empty then. */
const orNone = <T,>(q: PromiseLike<unknown>, none: T): Promise<T> => Promise.resolve(q as PromiseLike<T>).catch(() => none);

const shift = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The week of seven study days ending `to`, in figures. */
export async function weekFigures(sql: Sql, owner: string, to: string): Promise<WeekFigures> {
  const from = shift(to, -6);
  const prevFrom = shift(to, -13);
  const prevTo = shift(to, -7);
  const span = async (a: string, b: string) =>
    ((await sql`
      with r as (
        select kind, grade, session, at, seq, day from chongfuxi_review
        where owner_email = ${owner} and cause = 'answer' and day between ${a}::date and ${b}::date
      ), g as (
        select extract(epoch from at - lag(at) over (partition by session order by at, seq)) as gap
        from r where session is not null
      )
      select
        (select count(distinct day) from r)::int as days,
        coalesce((select sum(gap) from g where gap > 0 and gap <= ${GAP_MAX}), 0)::float8 / 60 as minutes,
        (select count(*) from r where kind = 'read')::int as read,
        (select count(*) from r where kind = 'produce')::int as recall,
        (select count(*) from r where kind = 'sentence')::int as sentence,
        (select count(*) from r)::int as total,
        (select count(*) from r where grade = 'good')::int as got
    `) as unknown as Array<{ days: number; minutes: number; read: number; recall: number; sentence: number; total: number; got: number }>)[0];
  const [now, prev] = await Promise.all([span(from, to), span(prevFrom, prevTo)]);
  const [learnt, matured, forgotten, lookups, notes, drills, episodes, stuck] = await Promise.all([
    sql`
      select distinct word from chongfuxi_card
      where owner_email = ${owner} and kind = 'read' and learned_at is not null
        and learned_at >= ${from}::date and learned_at < ${to}::date + 1
      order by word
    ` as unknown as Promise<Array<{ word: string }>>,
    sql`
      select distinct on (word, kind) word, kind from chongfuxi_review
      where owner_email = ${owner} and cause = 'answer' and kind in ('read', 'produce') and grade = 'good'
        and day between ${from}::date and ${to}::date
        and coalesce((before->>'stability')::float8, 0) < ${MATURE_DAYS} and (after->>'stability')::float8 >= ${MATURE_DAYS}
      order by word, kind
    ` as unknown as Promise<Array<{ word: string; kind: "read" | "produce" }>>,
    sql`
      select word, count(*)::int as times from chongfuxi_review
      where owner_email = ${owner} and kind in ('read', 'produce') and grade = 'forgot' and word is not null
        and day between ${from}::date and ${to}::date
      group by word having count(*) >= 2 order by count(*) desc, word limit 15
    ` as unknown as Promise<Array<{ word: string; times: number }>>,
    orNone<Array<{ query: string; verdict: string | null }>>(sql`
      select query, verdict from chongfuxi_lookup
      where owner_email = ${owner} and at >= ${from}::date and at < ${to}::date + 1
      order by at
    `, []),
    sql`
      select count(*)::int as n from chongfuxi_review
      where owner_email = ${owner} and comment is not null and day between ${from}::date and ${to}::date
    ` as unknown as Promise<Array<{ n: number }>>,
    orNone<Array<{ answered: number; got: number }>>(sql`
      select count(*)::int as answered, count(*) filter (where grade = 'got')::int as got from chongfuxi_drill_answer
      where owner_email = ${owner} and at >= ${from}::date and at < ${to}::date + 1
    `, [{ answered: 0, got: 0 }]),
    orNone<Array<{ id: number; show: string; episode: string; from: number | null; to: number | null }>>(sql`
      select e.id::int as id, e.show, e.episode,
             coalesce(
               (select p.known from chongfuxi_episode_progress p where p.owner_email = e.owner_email and p.episode_id = e.id and p.day < ${from}::date order by p.day desc limit 1),
               (select p.known from chongfuxi_episode_progress p where p.owner_email = e.owner_email and p.episode_id = e.id and p.day between ${from}::date and ${to}::date order by p.day asc limit 1)
             ) as "from",
             (select p.known from chongfuxi_episode_progress p where p.owner_email = e.owner_email and p.episode_id = e.id and p.day <= ${to}::date order by p.day desc limit 1) as "to"
      from chongfuxi_episode e where e.owner_email = ${owner}
    `, []),
    stuckWords(sql, owner),
  ]);
  return {
    from,
    to,
    days: now.days,
    minutes: Math.round(now.minutes),
    answers: { read: now.read, recall: now.recall, sentence: now.sentence, total: now.total, got: now.got },
    before: { days: prev.days, minutes: Math.round(prev.minutes), total: prev.total, got: prev.got },
    learnt: learnt.map((x) => x.word),
    matured,
    forgotten,
    stuck: stuck.map((s) => ({ word: s.word, category: s.category, why: s.why })),
    lookups,
    notes: notes[0]?.n ?? 0,
    drills: drills[0] ?? { answered: 0, got: 0 },
    episodes,
  };
}

const BRIEF = `Write the learner's weekly debrief from these figures (counted by the app, so they are true: don't restate them as numbers, the app shows them). POST to /api/chongfuxi/agent/week:
{ "to": "<the week's last day, as given>", "title": "<one line, the week in a phrase>", "sections": [{ "kind": "better" | "stuck" | "looked" | "focus" | "note", "title", "text", "words": [...] }], "focus": ["words to aim at next week"] }
- better: what got stronger and why it matters (matured words, a category emptied, more Recall got, an episode now readable). Name the words.
- stuck: what is still stuck and the likely reason, from the pattern (mixed up with which word, can't produce, breaks in context), and one concrete thing to do about it.
- looked: what their lookups say about where they are (a recurring confusion, a kind of question), if there is something to say.
- focus: what you will aim at next week in their reviews, stories and readings, and why. Put those words in "focus" too.
- note: anything else worth one line (pace, a day missed, the backlog). Optional.
Two to five sections, a sentence or three each, plain and specific, in English with the Chinese words in Chinese. No praise for its own sake.`;

/** What Muse needs for the debrief of the week ending `to` (yesterday's week by default, else today's). Readable by the agent. */
export async function weekMaterial(sql: Sql, owner: string, to?: string) {
  await ensureTable(sql);
  const day = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : await ownersDay(sql, owner);
  const [written] = (await sql`select 1 as x from chongfuxi_week where owner_email = ${owner} and week_to = ${day}::date`) as unknown as unknown[];
  return { to: day, brief: BRIEF, written: !!written, figures: await weekFigures(sql, owner, day) };
}

const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const HAN = /\p{Script=Han}/u;
const words = (v: unknown) =>
  (Array.isArray(v) ? v : [])
    .map((w) => str(w, 12))
    .filter((w) => HAN.test(w))
    .slice(0, 20);

/** Keep Muse's debrief for the week ending `to` (one already there replaced), with the figures as they stand now. */
export async function writeWeek(sql: Sql, owner: string, input: Record<string, unknown>): Promise<WeekReport> {
  await ensureTable(sql);
  const to = typeof input.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.to) ? input.to : await ownersDay(sql, owner);
  const sections: WeekSection[] = (Array.isArray(input.sections) ? input.sections : [])
    .map((x) => (x ?? {}) as Record<string, unknown>)
    .map((x) => ({
      kind: KINDS.includes(x.kind as WeekSection["kind"]) ? (x.kind as WeekSection["kind"]) : "note",
      title: str(x.title, 80),
      text: str(x.text, TEXT_MAX),
      words: words(x.words),
    }))
    .filter((x) => x.text)
    .slice(0, SECTIONS_MAX);
  if (!sections.length) throw new AgentError("Give at least one section with text.");
  const report = {
    title: str(input.title, 120) || "Your week",
    sections,
    focus: words(input.focus),
    figures: await weekFigures(sql, owner, to),
  };
  const model = str(input.model, 60) || "Muse";
  await sql`
    insert into chongfuxi_week (owner_email, week_to, model, report)
    values (${owner}, ${to}::date, ${model}, ${JSON.stringify(report)}::jsonb)
    on conflict (owner_email, week_to) do update set at = now(), model = excluded.model, report = excluded.report
  `;
  return { to, at: Date.now(), model, ...report };
}

/** The latest debrief, its figures as they were when written. Readable by anyone, like the rest of the log. */
export async function latestWeek(sql: Sql, owner: string): Promise<WeekReport | null> {
  await ensureTable(sql);
  const [r] = (await sql`
    select to_char(week_to, 'YYYY-MM-DD') as "to", (extract(epoch from at) * 1000)::double precision as at, model, report
    from chongfuxi_week where owner_email = ${owner} order by week_to desc limit 1
  `) as unknown as Array<{ to: string; at: number; model: string; report: Omit<WeekReport, "to" | "at" | "model"> }>;
  return r ? { to: r.to, at: Math.round(r.at), model: r.model, ...r.report } : null;
}
