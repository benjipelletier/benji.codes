// Reading with retelling: Muse finds native pieces on the web (articles,
// posts, videos with captions) the owner can mostly read, checks each against
// the deck before picking (agent/reading/check), and hands in the links with
// questions to retell them by (agent/reading). The owner reads one with every
// word marked as the text analyser marks it, then answers the questions in
// Chinese, by voice or keyboard, and the app's model grades each answer.
// What was tapped and how the retelling went go back to Muse.
//
// Only the link, why it was picked and how it measured are kept: the text is
// fetched again each time it is opened, and only for the owner, since the
// app is readable by anyone and the articles aren't ours to republish.

import Anthropic from "@anthropic-ai/sdk";
import type { Reading, Retell, TextAnalysis } from "@chongfuxi/lib/api";
import type { Dict } from "@chongfuxi/lib/dict";
import type { Sql } from "./db";
import { AgentError } from "./agent";
import { TEXT_MAX, analyse } from "./analyse";
import { ownersDay } from "./daily";
import { FetchError, fetchPage } from "./fetchtext";
import { EFFORT, MODEL } from "./lookup";
import { newWords, stuckWords } from "./rescue";
import { fetchCaptions, videoId } from "./youtube";

/** Pieces a day, questions a piece. */
export const READINGS_MAX = 5;
const QUESTIONS_MAX = 4;
/** The share of words known Muse aims for: enough to read, a few new. */
export const READING_TARGET = { min: 0.9, max: 0.98 };
/** New words named with a piece. */
const NEW_WORDS = 12;
/** Text sent to the model with a retelling, in characters. */
const CONTEXT_MAX = 6000;
const HAN = /[㐀-鿿]/;

export class ReadingError extends Error {}

let ready = false;
async function ensureTables(sql: Sql) {
  if (ready) return;
  await sql`
    create table if not exists chongfuxi_reading (
      owner_email text not null,
      id bigint generated always as identity,
      day date not null,
      at timestamptz not null default now(),
      url text not null,
      kind text not null,
      title text,
      why text not null,
      questions jsonb not null,
      known_pct real not null,
      chars int not null,
      new_words text[] not null,
      model text not null,
      opened_at timestamptz,
      done_at timestamptz,
      tapped text[] not null default '{}',
      primary key (owner_email, id),
      unique (owner_email, day, url)
    )
  `;
  await sql`
    create table if not exists chongfuxi_retell (
      owner_email text not null,
      reading_id bigint not null,
      q int not null,
      at timestamptz not null default now(),
      answer text not null,
      result jsonb not null
    )
  `;
  ready = true;
}

type Source = { title: string | null; text: string; url: string; kind: Reading["kind"] };
/** Texts fetched lately, kept a while in this server's memory so reading and then retelling fetch once. */
const fetched = new Map<string, { at: number; src: Source }>();
const FETCH_KEEP_MS = 30 * 60_000;

/** A link's text: a YouTube video's Chinese captions, any other page's text. */
export async function fetchSource(url: string): Promise<Source> {
  const kept = fetched.get(url);
  if (kept && Date.now() - kept.at < FETCH_KEEP_MS) return kept.src;
  const video = videoId(url);
  const got = video ? await fetchCaptions(video) : await fetchPage(url);
  const src: Source = { title: got.title, text: got.text.slice(0, TEXT_MAX), url: got.url, kind: video ? "youtube" : "web" };
  for (const [k, v] of fetched) if (Date.now() - v.at >= FETCH_KEEP_MS) fetched.delete(k);
  fetched.set(url, { at: Date.now(), src });
  return src;
}

export interface Coverage {
  url: string;
  kind: Reading["kind"];
  title: string | null;
  /** Han characters in it. */
  chars: number;
  /** Share of its word occurrences known (0–1), and of its sentences readable. */
  known: number;
  readable: number;
  /** Whether it is in READING_TARGET. */
  fits: boolean;
  /** Its words not known, most useful first, with reading and meaning. */
  newWords: Array<{ word: string; pinyin: string | null; gloss: string | null; count: number }>;
}

function coverageOf(a: TextAnalysis, kind: Reading["kind"], url: string): Coverage {
  const known = a.words.total ? a.words.known / a.words.total : 0;
  const chars = a.paragraphs.flat(2).reduce((n, t) => n + [...t.t].filter((c) => HAN.test(c)).length, 0);
  return {
    url,
    kind,
    title: a.title,
    chars,
    known: Math.round(known * 1000) / 1000,
    readable: a.sentences.total ? Math.round((a.sentences.readable / a.sentences.total) * 1000) / 1000 : 0,
    fits: known >= READING_TARGET.min && known <= READING_TARGET.max,
    newWords: a.unknown.slice(0, NEW_WORDS).map((u) => ({ word: u.word, pinyin: u.pinyin, gloss: u.gloss, count: u.count })),
  };
}

/** How readable a link is for the owner now: for the agent to pick by before handing it in. */
export async function checkLink(sql: Sql, owner: string, dict: Dict, url: string): Promise<Coverage> {
  let src;
  try {
    src = await fetchSource(url);
  } catch (e) {
    if (e instanceof FetchError) throw new AgentError(e.message);
    throw e;
  }
  const a = await analyse(sql, owner, dict, { text: src.text, kind: src.kind, title: src.title, url: src.url });
  return coverageOf(a, src.kind, src.url);
}

const BRIEF = `Find ${READINGS_MAX > 3 ? "two or three" : "one or two"} pieces of real Chinese written for native speakers for the learner to read today: news or feature articles, blog or social posts (Weibo, 小红书, 知乎 answers), or YouTube videos with Chinese captions. Not textbook or learner material. Pick what they would enjoy and what uses their words: the focus words below, and topics from their stuck and new words, and vary the kind from day to day.

Before handing one in, check it: POST { url } to /api/chongfuxi/agent/reading/check. Keep only pieces whose "known" share is between ${READING_TARGET.min} and ${READING_TARGET.max} ("fits": true), roughly 300 to 2,000 characters (one screen to a few), and reachable (the check fetches it as the app will). Too hard or too easy, find another.

For each piece write 1 to ${QUESTIONS_MAX} questions in simple Chinese (with English) that make them retell or react to it in their own words: what happened, why, what they think. The best questions need the piece's key words to answer. Then POST { items: [{ url, why, questions: [{ zh, en }] }] } to /api/chongfuxi/agent/reading. "why" is one line on why you picked it for them.

Look at "recent": what they opened, finished, tapped (words they had to look up) and how their retellings were graded. Follow up: bring tapped words back in later pieces, and pitch harder or easier by how the retellings went.`;

/** What Muse needs to pick today's reading. Readable by the agent. */
export async function readingMaterial(sql: Sql, owner: string) {
  await ensureTables(sql);
  const [day, stuck, fresh, recent] = await Promise.all([ownersDay(sql, owner), stuckWords(sql, owner), newWords(sql, owner), listReadings(sql, owner, 14)]);
  return {
    day,
    brief: BRIEF,
    target: READING_TARGET,
    focus: [...stuck.map((s) => ({ word: s.word, gloss: s.gloss, why: s.why })), ...fresh.map((f) => ({ word: f.word, gloss: f.gloss, why: "new, on the Learn ladder" }))],
    today: recent.filter((r) => r.day === day).map((r) => ({ url: r.url, title: r.title })),
    recent: recent.map((r) => ({
      day: r.day,
      url: r.url,
      title: r.title,
      knownPct: r.knownPct,
      opened: r.openedAt !== null,
      finished: r.doneAt !== null,
      tapped: r.tapped,
      retells: r.retells.map((t) => ({ question: r.questions[t.q]?.zh ?? "", answer: t.answer, grade: t.grade, understood: t.understood, why: t.why })),
    })),
  };
}

const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/**
 * Keep the pieces Muse picked for a day (today unless it says): each fetched
 * and measured now, its questions checked. A piece that can't be fetched is
 * named back with why; one already handed in that day is replaced.
 */
export async function writeReadings(
  sql: Sql,
  owner: string,
  dict: Dict,
  input: { items?: unknown; day?: unknown; model?: unknown },
): Promise<{ written: Reading[]; failed: Array<{ url: string; error: string }> }> {
  await ensureTables(sql);
  const items = (Array.isArray(input.items) ? input.items : []).slice(0, READINGS_MAX).map((i) => (i ?? {}) as Record<string, unknown>);
  if (!items.length) throw new AgentError("Give { items: [{ url, why, questions: [{ zh, en }] }] }.");
  const day = typeof input.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.day) ? input.day : await ownersDay(sql, owner);
  const model = str(input.model, 60) || "Muse";
  const failed: Array<{ url: string; error: string }> = [];
  const ids: number[] = [];
  for (const item of items) {
    const url = str(item.url, 2000);
    const questions = (Array.isArray(item.questions) ? item.questions : [])
      .map((q) => (q ?? {}) as Record<string, unknown>)
      .map((q) => ({ zh: str(q.zh, 200), en: str(q.en, 300) }))
      .filter((q) => HAN.test(q.zh))
      .slice(0, QUESTIONS_MAX);
    if (!url) continue;
    if (!questions.length) {
      failed.push({ url, error: "needs at least one question in Chinese ({ zh, en })" });
      continue;
    }
    try {
      const c = await checkLink(sql, owner, dict, url);
      const [row] = (await sql`
        insert into chongfuxi_reading (owner_email, day, url, kind, title, why, questions, known_pct, chars, new_words, model)
        values (${owner}, ${day}::date, ${c.url}, ${c.kind}, ${str(item.title, 200) || c.title}, ${str(item.why, 300)},
                ${JSON.stringify(questions)}::jsonb, ${c.known}, ${c.chars}, ${c.newWords.map((w) => w.word)}::text[], ${model})
        on conflict (owner_email, day, url) do update set
          at = now(), kind = excluded.kind, title = excluded.title, why = excluded.why, questions = excluded.questions,
          known_pct = excluded.known_pct, chars = excluded.chars, new_words = excluded.new_words, model = excluded.model
        returning id::int as id
      `) as unknown as Array<{ id: number }>;
      ids.push(row.id);
    } catch (e) {
      if (e instanceof AgentError) failed.push({ url, error: e.message });
      else throw e;
    }
  }
  const all = await listReadings(sql, owner, 30);
  return { written: all.filter((r) => ids.includes(r.id)), failed };
}

/** The readings of the last `days` days, newest first, with their retellings. Readable by anyone (links only). */
export async function listReadings(sql: Sql, owner: string, days = 7): Promise<Reading[]> {
  await ensureTables(sql);
  const rows = (await sql`
    select id::int as id, day::text as day, url, kind, title, why, questions, known_pct, chars, new_words, model,
           tapped, (extract(epoch from opened_at) * 1000)::double precision as opened, (extract(epoch from done_at) * 1000)::double precision as done
    from chongfuxi_reading
    where owner_email = ${owner} and day > (now() - make_interval(days => ${days}))::date
    order by day desc, id
  `) as unknown as Array<{
    id: number; day: string; url: string; kind: Reading["kind"]; title: string | null; why: string; questions: Reading["questions"];
    known_pct: number; chars: number; new_words: string[]; tapped: string[]; model: string; opened: number | null; done: number | null;
  }>;
  const retells = rows.length
    ? ((await sql`
        select reading_id::int as id, q, answer, result, (extract(epoch from at) * 1000)::double precision as at
        from chongfuxi_retell where owner_email = ${owner} and reading_id = any(${rows.map((r) => r.id)}::bigint[])
        order by at
      `) as unknown as Array<{ id: number; q: number; answer: string; result: Omit<Retell, "q" | "answer" | "at">; at: number }>)
    : [];
  return rows.map((r) => ({
    id: r.id,
    day: r.day,
    url: r.url,
    kind: r.kind,
    title: r.title,
    why: r.why,
    questions: r.questions,
    knownPct: r.known_pct,
    chars: r.chars,
    newWords: r.new_words,
    tapped: r.tapped,
    model: r.model,
    openedAt: r.opened === null ? null : Math.round(r.opened),
    doneAt: r.done === null ? null : Math.round(r.done),
    retells: retells.filter((t) => t.id === r.id).map((t) => ({ ...t.result, q: t.q, answer: t.answer, at: Math.round(t.at) })),
  }));
}

async function readingOf(sql: Sql, owner: string, id: number): Promise<Reading> {
  const [r] = (await listReadings(sql, owner, 3650)).filter((x) => x.id === id);
  if (!r) throw new ReadingError("No such reading.");
  return r;
}

/** A reading opened: its text fetched now and marked against the deck. Owner only (the text isn't ours to serve). */
export async function openReading(sql: Sql, owner: string, dict: Dict, id: number): Promise<{ reading: Reading; text: TextAnalysis }> {
  await ensureTables(sql);
  const reading = await readingOf(sql, owner, id);
  let src;
  try {
    src = await fetchSource(reading.url);
  } catch (e) {
    if (e instanceof FetchError) throw new ReadingError(`Couldn't fetch it now: ${e.message}`);
    throw e;
  }
  const text = await analyse(sql, owner, dict, { text: src.text, kind: src.kind, title: reading.title ?? src.title, url: reading.url });
  await sql`update chongfuxi_reading set opened_at = coalesce(opened_at, now()) where owner_email = ${owner} and id = ${id}`;
  return { reading: { ...reading, openedAt: reading.openedAt ?? Date.now() }, text };
}

/** Words tapped while reading, and that it was read to the end. Owner only. */
export async function markReading(sql: Sql, owner: string, id: number, input: { tapped?: unknown; done?: unknown }) {
  await ensureTables(sql);
  const tapped = (Array.isArray(input.tapped) ? input.tapped : []).filter((w): w is string => typeof w === "string" && HAN.test(w) && w.length <= 12).slice(0, 200);
  await sql`
    update chongfuxi_reading set
      tapped = array(select distinct unnest(tapped || ${tapped}::text[])),
      done_at = case when ${input.done === true} then coalesce(done_at, now()) else done_at end
    where owner_email = ${owner} and id = ${id}
  `;
}

const RETELL_SCHEMA = {
  type: "object",
  properties: {
    grade: { type: "string", enum: ["correct", "almost", "wrong"] },
    understood: { type: "boolean" },
    fixed: { type: "string" },
    why: { type: "string" },
  },
  required: ["grade", "understood", "fixed", "why"],
  additionalProperties: false,
} as const;

const RETELL_SYSTEM = `You check a Chinese learner's spoken or typed answer to a question about a text they just read. Judge two things: the Chinese, and whether they understood the text.
- grade: "correct" (natural, grammatical Mandarin; small stylistic choices are fine), "almost" (understandable, but a word choice, collocation, measure word, word order or grammar point is off, or it sounds unnatural), "wrong" (ungrammatical or would be misunderstood). Spoken answers come through speech recognition: ignore missing punctuation and obvious homophone slips from the recogniser, but not real word mistakes.
- understood: whether their answer fits what the text says (false if it gets the text wrong).
- fixed: how a native speaker would say what they meant, keeping their ideas and as many of their words as possible; the same as theirs when it is correct.
- why: in English, one to three short sentences: what exactly is wrong and why (name the word or pattern), and if they misread the text, what it actually says. When it is correct, what was good about it.`;

/**
 * An answer in Chinese to a question about a text, graded by the app's model
 * at Look up's model and effort (never lower): its Chinese, and whether it
 * fits what the text says. Shared by readings and episodes (episodes.ts).
 */
export async function gradeAnswer(
  body: string,
  title: string,
  question: { zh: string; en: string },
  said: string,
): Promise<Omit<Retell, "q" | "answer" | "at">> {
  const apiKey = process.env.CHONGFUXI_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ReadingError("No Anthropic API key is set (CHONGFUXI_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY).");
  const message = await new Anthropic({ apiKey }).messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: RETELL_SYSTEM,
    output_config: { effort: EFFORT, format: { type: "json_schema", schema: RETELL_SCHEMA as unknown as Record<string, unknown> } },
    messages: [{ role: "user", content: `<text title="${title}">\n${body.slice(0, CONTEXT_MAX)}\n</text>\n\nQuestion: ${question.zh} (${question.en})\nTheir answer: ${said}` }],
  });
  const raw = message.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("");
  let given: Record<string, unknown>;
  try {
    given = JSON.parse(raw);
  } catch {
    throw new ReadingError(message.stop_reason === "refusal" ? "The model declined." : "The check came back malformed.");
  }
  console.log("retell graded", JSON.stringify({ title, usage: message.usage }));
  return {
    grade: given.grade === "correct" || given.grade === "almost" || given.grade === "wrong" ? given.grade : "almost",
    understood: given.understood !== false,
    fixed: str(given.fixed, 600) || said,
    why: str(given.why, 800),
  };
}

/** A retelling graded by the app's model, at Look up's model and effort (never lower). Owner only. */
export async function gradeRetell(sql: Sql, owner: string, dict: Dict, id: number, q: number, answer: string): Promise<Retell> {
  await ensureTables(sql);
  const said = answer.trim().slice(0, 600);
  if (!HAN.test(said)) throw new ReadingError("Answer in Chinese.");
  const { reading, text } = await openReading(sql, owner, dict, id);
  const question = reading.questions[q];
  if (!question) throw new ReadingError("No such question.");
  const body = text.paragraphs.map((p) => p.flat().map((t) => t.t).join("")).join("\n");
  const result = await gradeAnswer(body, reading.title ?? "", question, said);
  await sql`insert into chongfuxi_retell (owner_email, reading_id, q, answer, result) values (${owner}, ${id}, ${q}, ${said}, ${JSON.stringify(result)}::jsonb)`;
  console.log("retell", JSON.stringify({ id, q, grade: result.grade }));
  return { ...result, q, answer: said, at: Date.now() };
}
