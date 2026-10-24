// Muse's review: the owner's agent reads their problem areas (agent/drill,
// GET), writes a deck of cards aimed at them, of whatever shapes it judges
// most useful (POST), once a day or whenever it likes; the owner works
// through it from the Memory kits screen (route drill). How each card went is
// kept and goes back to Muse with the next material, so it can follow up.
// Nothing here touches a schedule.

import type { Drill, DrillCard, DrillResult } from "@chongfuxi/lib/api";
import type { Sql } from "./db";
import { AgentError } from "./agent";
import { ownersDay } from "./daily";
import { ensureLookupTables } from "./lookup";
import { ACTIVE } from "./review";
import { ensureRescueTable, stuckWords } from "./rescue";

/** Cards a review may have; characters a text field may run to. */
export const DRILL_MAX = 40;
const TEXT_MAX = 400;
const SHORT_MAX = 60;
/** How far back the material looks, and how much of each kind it sends. */
const LOOKBACK_DAYS = 30;
const NOTES_MAX = 40;
const TRIPS_MAX = 25;
const LOOKUPS_MAX = 25;
const ATTEMPTS_MAX = 20;
const KNOWN_MAX = 200;
const HAN = /[㐀-鿿]/;

let ready = false;
async function ensureTables(sql: Sql) {
  if (ready) return;
  await sql`
    create table if not exists chongfuxi_drill (
      owner_email text not null,
      day date not null,
      at timestamptz not null default now(),
      model text not null,
      title text not null,
      note text not null,
      cards jsonb not null,
      primary key (owner_email, day)
    )
  `;
  await sql`
    create table if not exists chongfuxi_drill_answer (
      owner_email text not null,
      day date not null,
      idx int not null,
      at timestamptz not null default now(),
      grade text not null check (grade in ('got', 'missed')),
      given text,
      primary key (owner_email, day, idx)
    )
  `;
  ready = true;
}

const BRIEF = `Write today's review for a Chinese learner, aimed at their problem areas below. You have free rein over what to test and how: pick, for each problem, the card shape that will help most, and mix shapes. Between 10 and ${DRILL_MAX} cards, as many as the problems deserve. Card shapes (every card also has "focus": the Chinese words it is about, "why": the problem it targets in a few words, "explain": one or two sentences shown after answering, saying what to take from it):
- flip {front, back, hint}: anything at all, a question on the front, the answer on the back. The catch-all.
- cloze {zh, answer, en, options}: a Chinese sentence with ___ where the answer goes, its English, and optionally 2-5 options to choose from (the answer among them; [] to make them recall it).
- choice {prompt, options, answer}: a question with 2-6 options, answer the index of the right one. Good for telling near-synonyms apart.
- order {pieces, en}: a sentence cut into 3-10 pieces in the right order (the app shuffles them), with its English. Good for word order and grammar.
- produce {en, answer, accept, hint}: English to say in Chinese; answer is the best Chinese, accept other correct versions. They type it, or say it and check.
- listen {zh, en}: a sentence read aloud by the phone; they say what it means, then see it.
Use their own words and sentences where you can, keep everything else simple (the known words), and write natural, correct Mandarin in simplified characters. Follow up on how the last review went: bring back what was missed in a new form.`;

export interface DrillMaterial {
  day: string;
  brief: string;
  written: boolean;
  /** Words whose latest result was wrong, with the pattern that places them (mixed up, can't produce, breaks in context, slipping, won't stick, leech). */
  stuck: Array<{ word: string; pinyin: string | null; gloss: string | null; category: string; why: string; partner: string | null; missed: number }>;
  /** What they wrote after forgetting a card ("what tripped you up"). */
  notes: Array<{ word: string | null; kind: string; note: string; sentence: string | null; day: string }>;
  /** Sentences they couldn't read, with the words that tripped them. */
  trips: Array<{ zh: string; en: string | null; tapped: string[]; note: string | null; day: string }>;
  /** What they looked up, with their verdict on the answer. */
  lookups: Array<{ query: string; kind: string | null; verdict: string | null; note: string | null; day: string }>;
  /** Their own sentences graded almost or wrong in a memory kit. */
  attempts: Array<{ word: string; zh: string; grade: string; fixed: string; why: string }>;
  /** The last review, card by card, with how each went (null: not answered). */
  last: { day: string; cards: Array<{ type: string; focus: string[]; why: string; result: "got" | "missed" | null }> } | null;
  /** Words they know well, to write the rest with. */
  known: string[];
}

/** What today's review should be aimed at. Readable by the agent. */
export async function drillMaterial(sql: Sql, owner: string): Promise<DrillMaterial> {
  await Promise.all([ensureTables(sql), ensureRescueTable(sql), ensureLookupTables(sql)]);
  const day = await ownersDay(sql, owner);
  const since = `${LOOKBACK_DAYS} days`;
  const [stuck, notes, trips, lookups, kits, known, written, lastDrill] = await Promise.all([
    stuckWords(sql, owner),
    sql.query(
      `select r.word, r.kind, r.comment as note, s.zh as sentence, r.day::text as day
       from chongfuxi_review r left join chongfuxi_sentence s on s.owner_email = r.owner_email and s.id = r.sentence_id
       where r.owner_email = $1 and r.comment is not null and r.at > now() - $2::interval
       order by r.at desc limit $3`,
      [owner, since, NOTES_MAX],
    ),
    sql.query(
      `select s.zh, s.en, r.tapped, r.comment as note, r.day::text as day
       from chongfuxi_review r join chongfuxi_sentence s on s.owner_email = r.owner_email and s.id = r.sentence_id
       where r.owner_email = $1 and r.kind = 'sentence' and r.grade = 'forgot' and r.cause = 'answer' and r.at > now() - $2::interval
       order by r.at desc limit $3`,
      [owner, since, TRIPS_MAX],
    ),
    sql.query(
      `select query, kind, verdict, note, (at at time zone 'utc')::date::text as day
       from chongfuxi_lookup where owner_email = $1 and at > now() - $2::interval
       order by at desc limit $3`,
      [owner, since, LOOKUPS_MAX],
    ),
    sql.query(`select word, rescue->'attempts' as attempts from chongfuxi_rescue where owner_email = $1 and jsonb_typeof(rescue->'attempts') = 'array'`, [
      owner,
    ]),
    sql.query(
      `select c.word from chongfuxi_card c
       where c.owner_email = $1 and c.kind = 'read' and c.meaning_id is null and ${ACTIVE} and c.stability >= 30
       order by c.stability desc limit $2`,
      [owner, KNOWN_MAX],
    ),
    sql`select 1 as x from chongfuxi_drill where owner_email = ${owner} and day = ${day}::date`,
    sql`select day::text as day, cards from chongfuxi_drill where owner_email = ${owner} order by day desc limit 1`,
  ]);
  const attempts = (kits as unknown as Array<{ word: string; attempts: Array<Record<string, unknown>> }>)
    .flatMap((k) => k.attempts.map((a): Record<string, unknown> & { word: string } => ({ ...a, word: k.word })))
    .filter((a) => a.grade === "almost" || a.grade === "wrong")
    .sort((a, b) => Number(b.at ?? 0) - Number(a.at ?? 0))
    .slice(0, ATTEMPTS_MAX)
    .map((a) => ({ word: a.word, zh: String(a.zh ?? ""), grade: String(a.grade), fixed: String(a.fixed ?? ""), why: String(a.why ?? "") }));
  let last: DrillMaterial["last"] = null;
  const [prev] = lastDrill as unknown as Array<{ day: string; cards: DrillCard[] }>;
  if (prev) {
    const results = await resultsOf(sql, owner, prev.day);
    last = { day: prev.day, cards: prev.cards.map((c, i) => ({ type: c.type, focus: c.focus, why: c.why, result: results[i]?.grade ?? null })) };
  }
  return {
    day,
    brief: BRIEF,
    written: (written as unknown as unknown[]).length > 0,
    stuck: stuck.map((s) => ({ word: s.word, pinyin: s.pinyin, gloss: s.gloss, category: s.category, why: s.why, partner: s.partner, missed: s.missed })),
    notes: notes as unknown as DrillMaterial["notes"],
    trips: trips as unknown as DrillMaterial["trips"],
    lookups: lookups as unknown as DrillMaterial["lookups"],
    attempts,
    last,
    known: (known as unknown as Array<{ word: string }>).map((k) => k.word),
  };
}

const str = (v: unknown, n = TEXT_MAX) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const strs = (v: unknown, most: number, n = SHORT_MAX) =>
  (Array.isArray(v) ? v : []).map((x) => str(x, n)).filter(Boolean).slice(0, most);

/** A card as the agent gave it, if it is one: each shape's fields checked, anything else dropped. */
export function checkCard(raw: unknown): DrillCard | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const base = { focus: strs(r.focus, 6, 12).filter((w) => HAN.test(w)), why: str(r.why, 120), explain: str(r.explain) };
  switch (r.type) {
    case "flip": {
      const front = str(r.front);
      const back = str(r.back);
      return front && back ? { ...base, type: "flip", front, back, hint: str(r.hint, 120) } : null;
    }
    case "cloze": {
      const zh = str(r.zh).replace(/_{2,}|＿+/g, "___");
      const answer = str(r.answer, SHORT_MAX);
      if (!zh.includes("___") || !answer) return null;
      let options = strs(r.options, 6);
      if (options.length && !options.includes(answer)) options = [...options.slice(0, 5), answer];
      return { ...base, type: "cloze", zh, answer, en: str(r.en), options: options.length >= 2 ? options : [] };
    }
    case "choice": {
      const options = strs(r.options, 6, 120);
      const answer = typeof r.answer === "number" ? Math.trunc(r.answer) : Number.NaN;
      const prompt = str(r.prompt);
      return prompt && options.length >= 2 && answer >= 0 && answer < options.length ? { ...base, type: "choice", prompt, options, answer } : null;
    }
    case "order": {
      const pieces = strs(r.pieces, 10, 30);
      return pieces.length >= 3 && new Set(pieces).size > 1 ? { ...base, type: "order", pieces, en: str(r.en) } : null;
    }
    case "produce": {
      const answer = str(r.answer, 120);
      const en = str(r.en);
      return en && HAN.test(answer) ? { ...base, type: "produce", en, answer, accept: strs(r.accept, 6, 120).filter((a) => HAN.test(a)), hint: str(r.hint, 120) } : null;
    }
    case "listen": {
      const zh = str(r.zh);
      return HAN.test(zh) ? { ...base, type: "listen", zh, en: str(r.en) } : null;
    }
    default:
      return null;
  }
}

/**
 * Keep the agent's review for a day (today unless it says); one already
 * there is replaced, with its results. Cards that aren't one of the shapes
 * are dropped and counted back.
 */
export async function writeDrill(
  sql: Sql,
  owner: string,
  input: { day?: unknown; title?: unknown; note?: unknown; cards?: unknown; model?: unknown },
): Promise<{ drill: Drill; dropped: number }> {
  await ensureTables(sql);
  const given = Array.isArray(input.cards) ? input.cards.slice(0, DRILL_MAX) : [];
  const cards = given.map(checkCard).filter((c): c is DrillCard => c !== null);
  if (!cards.length) throw new AgentError("No usable cards: see the shapes in the material's brief.");
  const day = typeof input.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.day) ? input.day : await ownersDay(sql, owner);
  await sql.transaction([
    sql`delete from chongfuxi_drill_answer where owner_email = ${owner} and day = ${day}::date`,
    sql`
      insert into chongfuxi_drill (owner_email, day, model, title, note, cards)
      values (${owner}, ${day}::date, ${str(input.model, 60) || "Muse"}, ${str(input.title, 60)}, ${str(input.note)}, ${JSON.stringify(cards)}::jsonb)
      on conflict (owner_email, day) do update set
        at = now(), model = excluded.model, title = excluded.title, note = excluded.note, cards = excluded.cards
    `,
  ]);
  return { drill: (await latestDrill(sql, owner))!, dropped: (Array.isArray(input.cards) ? input.cards.length : 0) - cards.length };
}

async function resultsOf(sql: Sql, owner: string, day: string): Promise<Record<number, DrillResult>> {
  const rows = (await sql`
    select idx, grade, given, (extract(epoch from at) * 1000)::double precision as at
    from chongfuxi_drill_answer where owner_email = ${owner} and day = ${day}::date
  `) as unknown as Array<{ idx: number; grade: DrillResult["grade"]; given: string | null; at: number }>;
  return Object.fromEntries(rows.map((r) => [r.idx, { grade: r.grade, given: r.given, at: Math.round(r.at) }]));
}

/** The latest review, today's or the last one written, with how each card went. Readable by anyone. */
export async function latestDrill(sql: Sql, owner: string): Promise<Drill | null> {
  await ensureTables(sql);
  const [row] = (await sql`
    select day::text as day, (extract(epoch from at) * 1000)::double precision as at, model, title, note, cards
    from chongfuxi_drill where owner_email = ${owner} order by day desc limit 1
  `) as unknown as Array<{ day: string; at: number; model: string; title: string; note: string; cards: DrillCard[] }>;
  if (!row) return null;
  return {
    ...row,
    at: Math.round(row.at),
    results: await resultsOf(sql, owner, row.day),
    today: row.day === (await ownersDay(sql, owner)),
  };
}

/** How a card went (the latest answer for it is kept). Owner only. */
export async function answerDrill(sql: Sql, owner: string, input: { day?: unknown; idx?: unknown; grade?: unknown; given?: unknown }) {
  await ensureTables(sql);
  const day = typeof input.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.day) ? input.day : null;
  const idx = typeof input.idx === "number" && Number.isInteger(input.idx) && input.idx >= 0 && input.idx < DRILL_MAX ? input.idx : null;
  const grade = input.grade === "got" || input.grade === "missed" ? input.grade : null;
  if (!day || idx === null || !grade) throw new AgentError("which card, and how did it go?");
  const given = str(input.given, 200) || null;
  await sql`
    insert into chongfuxi_drill_answer (owner_email, day, idx, grade, given)
    values (${owner}, ${day}::date, ${idx}, ${grade}, ${given})
    on conflict (owner_email, day, idx) do update set at = now(), grade = excluded.grade, given = excluded.given
  `;
}
