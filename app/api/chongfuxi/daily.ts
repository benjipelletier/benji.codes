// The daily story: each morning the owner's agent (Muse) asks for the day's
// words (route agent/story, GET), writes two short paragraphs with them, and
// hands them in (POST). It replaced the story the app wrote with its own
// model call on the Memory kits screen (the owner's choice): the agent works
// on a schedule, so the story is waiting, and costs the app nothing.

import type { StuckStory } from "@chongfuxi/lib/api";
import { ROLLOVER_HOUR } from "@chongfuxi/lib/day";
import type { Sql } from "./db";
import { newWords, stuckWords } from "./rescue";
import { ACTIVE, WAITING_TO_LEARN, promptSenses, shownPinyin } from "./review";
import { AgentError } from "./agent";
import type { Definition } from "@chongfuxi/lib/dict";

/** Words of each kind the story is asked to use. */
const STUCK_MAX = 8;
const DUE_MAX = 6;
/** Well-known words offered to build the rest of the story from. */
const KNOWN_MAX = 200;
/** Paragraphs, and characters, a story may have. */
const PARAGRAPHS_MAX = 3;
const ZH_MAX = 600;
const EN_MAX = 1500;

let ready = false;
async function ensureTable(sql: Sql) {
  if (ready) return;
  await sql`
    create table if not exists chongfuxi_daily_story (
      owner_email text not null,
      day date not null,
      at timestamptz not null default now(),
      model text not null,
      title text not null,
      paragraphs jsonb not null,
      targets text[] not null,
      primary key (owner_email, day)
    )
  `;
  ready = true;
}

/** The owner's study day now, by the clock their last answer was given on (day.ts: it turns over at ROLLOVER_HOUR). */
export async function ownersDay(sql: Sql, owner: string, at = Date.now()): Promise<string> {
  const [last] = (await sql`
    select utc_offset from chongfuxi_review where owner_email = ${owner} and utc_offset is not null order by at desc limit 1
  `) as unknown as Array<{ utc_offset: number }>;
  const local = at + (last?.utc_offset ?? 0) * 60_000 - ROLLOVER_HOUR * 3_600_000;
  return new Date(local).toISOString().slice(0, 10);
}

export interface StoryWord {
  word: string;
  pinyin: string | null;
  gloss: string | null;
}

export interface StoryMaterial {
  day: string;
  /** Words the story should use, each in a sentence that shows its meaning: stuck, then new, then due. */
  targets: Array<StoryWord & { why: "stuck" | "new" | "due" }>;
  /** Words the owner knows well, to write the rest of the story with. */
  known: string[];
  /** How to write it. */
  brief: string;
  /** Whether today's story is already written. */
  written: boolean;
}

const BRIEF = `Write a short story in simplified Chinese for a learner, to help them remember the target words. Use every target word, each in a sentence where its meaning is clear from what happens (not just mentioned), in the sense given. Write everything else with the known words or simple, common vocabulary (HSK 1–4), so the targets stand out. Two paragraphs (three at most), each four to seven sentences, telling one connected story with a little humour or tension. Give a short Chinese title and, for each paragraph, a natural English translation. Write the words exactly as given, with no spaces or pinyin in the Chinese.`;

/** What today's story should be written with. Readable by the agent. */
export async function storyMaterial(sql: Sql, owner: string): Promise<StoryMaterial> {
  await ensureTable(sql);
  const day = await ownersDay(sql, owner);
  const [stuck, fresh] = await Promise.all([stuckWords(sql, owner), newWords(sql, owner)]);
  const targets: StoryMaterial["targets"] = [];
  const add = (w: StoryWord, why: "stuck" | "new" | "due") => {
    if (!targets.some((t) => t.word === w.word)) targets.push({ word: w.word, pinyin: w.pinyin, gloss: w.gloss, why });
  };
  for (const w of stuck.slice(0, STUCK_MAX)) add(w, "stuck");
  for (const w of fresh) add(w, "new");
  // A few of the weakest due today, the review's own order (least likely to be remembered first).
  const due = (await sql.query(
    `select distinct on (c.word) c.word, w.pinyin, w.defs,
            extract(epoch from (now() - c.last_review)) / 86400.0 / nullif(c.stability, 0) as lapse
     from chongfuxi_card c join chongfuxi_word w on w.owner_email = c.owner_email and w.word = c.word
     where c.owner_email = $1 and c.kind in ('read', 'produce') and c.meaning_id is null and ${ACTIVE} and not ${WAITING_TO_LEARN}
       and c.due <= now() + interval '1 day' and c.last_review is not null
     order by c.word, lapse desc nulls first`,
    [owner],
  )) as unknown as Array<{ word: string; pinyin: string | null; defs: Definition[]; lapse: number | null }>;
  for (const d of due.sort((a, b) => (b.lapse ?? 0) - (a.lapse ?? 0)).slice(0, DUE_MAX * 3)) {
    if (targets.filter((t) => t.why === "due").length >= DUE_MAX) break;
    const pinyin = shownPinyin(d.pinyin, d.defs);
    add({ word: d.word, pinyin, gloss: promptSenses(d.defs, pinyin).slice(0, 2).join("; ") || null }, "due");
  }
  const known = (await sql.query(
    `select c.word from chongfuxi_card c
     where c.owner_email = $1 and c.kind = 'read' and c.meaning_id is null and ${ACTIVE} and c.stability >= 30
     order by c.stability desc limit $2`,
    [owner, KNOWN_MAX],
  )) as unknown as Array<{ word: string }>;
  const [written] = (await sql`select 1 as x from chongfuxi_daily_story where owner_email = ${owner} and day = ${day}::date`) as unknown as unknown[];
  return { day, targets, known: known.map((k) => k.word), brief: BRIEF, written: Boolean(written) };
}

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/**
 * Keep the agent's story for a day (today unless it says): one or more
 * paragraphs of Chinese, each with English; a story already there for the
 * day is replaced. Its targets are the day's material as it stands now.
 */
export async function writeDailyStory(
  sql: Sql,
  owner: string,
  input: { day?: unknown; title?: unknown; paragraphs?: unknown; model?: unknown },
): Promise<StuckStory> {
  await ensureTable(sql);
  const material = await storyMaterial(sql, owner);
  const day = typeof input.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.day) ? input.day : material.day;
  const paragraphs = (Array.isArray(input.paragraphs) ? input.paragraphs : [])
    .map((p) => (p ?? {}) as Record<string, unknown>)
    .map((p) => ({ zh: clip(p.zh, ZH_MAX), en: clip(p.en, EN_MAX) }))
    .filter((p) => /[㐀-鿿]/.test(p.zh))
    .slice(0, PARAGRAPHS_MAX);
  if (!paragraphs.length) throw new AgentError("A story needs at least one paragraph of Chinese ({ zh, en }).");
  const title = clip(input.title, 40);
  const model = clip(input.model, 60) || "Muse";
  const targets = material.targets.map((t) => t.word);
  await sql`
    insert into chongfuxi_daily_story (owner_email, day, model, title, paragraphs, targets)
    values (${owner}, ${day}::date, ${model}, ${title}, ${JSON.stringify(paragraphs)}::jsonb, ${targets}::text[])
    on conflict (owner_email, day) do update set
      at = now(), model = excluded.model, title = excluded.title, paragraphs = excluded.paragraphs, targets = excluded.targets
  `;
  return (await dailyStory(sql, owner))!;
}

/** The latest story, today's or the last one written, with the targets it leaves out. Readable by anyone. */
export async function dailyStory(sql: Sql, owner: string): Promise<StuckStory | null> {
  await ensureTable(sql);
  const [row] = (await sql`
    select day::text as day, (extract(epoch from at) * 1000)::double precision as at, model, title, paragraphs, targets
    from chongfuxi_daily_story where owner_email = ${owner}
    order by day desc limit 1
  `) as unknown as Array<{ day: string; at: number; model: string; title: string; paragraphs: Array<{ zh: string; en: string }>; targets: string[] }>;
  if (!row) return null;
  const text = row.paragraphs.map((p) => p.zh).join("");
  return {
    day: row.day,
    at: Math.round(row.at),
    model: row.model,
    title: row.title,
    paragraphs: row.paragraphs,
    words: row.targets,
    missing: row.targets.filter((w) => !text.includes(w)),
    today: row.day === (await ownersDay(sql, owner)),
  };
}
