// Write it in Chinese (the owner: "a cool recall activity would be if muse
// gave me an English paragraph using things I'm having trouble with and made
// me write the Chinese for it. It should make sense of course"). The model
// writes a short English paragraph that hangs together, a situation or a
// little story, in which each of a handful of the owner's trouble words is
// the natural thing to say in Chinese, the rest within words they know. The
// owner writes it in Chinese; the model grades each try against the English,
// says what to fix, and whether each trouble word was used. Nothing touches a
// schedule. Owner only (it costs money), at Look up's model and effort
// (never lower).

import Anthropic from "@anthropic-ai/sdk";
import type { Paragraph, ParagraphTarget, ParagraphTry } from "@chongfuxi/lib/api";
import type { Definition } from "@chongfuxi/lib/dict";
import { CATEGORIES } from "@chongfuxi/lib/revive";
import type { Sql } from "./db";
import { EFFORT, MODEL } from "./lookup";
import { stuckWords } from "./rescue";
import { shownPinyin } from "./review";
import { SUSPENDED_WORD } from "./suspended";

export class ParagraphError extends Error {}

/** Trouble words a paragraph is built around. */
export const TARGETS = 5;
/** Forgotten in this many days counts as trouble (after the words to revive). */
const FORGOT_DAYS = 30;
/** Words that were targets of this many latest paragraphs wait, while there are enough others. */
const REST_AFTER = 2;
/** Known deck words given to build the rest with, strongest first. */
const KNOWN_SHOWN = 800;
/** Paragraphs listed, newest first; tries kept on each. */
export const PARAGRAPHS_SHOWN = 20;
const TRIES_KEPT = 10;
/** The longest answer taken (characters). */
const ANSWER_MAX = 1200;
const TEXT_MAX = 1500;

let ready = false;
async function ensureTable(sql: Sql) {
  if (ready) return;
  await sql`
    create table if not exists chongfuxi_paragraph (
      id bigserial primary key,
      owner_email text not null,
      at timestamptz not null default now(),
      model text not null,
      title text not null,
      en text not null,
      zh text not null,
      targets jsonb not null,
      tries jsonb not null default '[]'::jsonb
    )
  `;
  await sql`create index if not exists chongfuxi_paragraph_owner on chongfuxi_paragraph (owner_email, at desc)`;
  ready = true;
}

const clip = (v: unknown, n = TEXT_MAX) => (typeof v === "string" ? v.trim().replace(/[ \t]+/g, " ").slice(0, n) : "");

function apiKey(): string {
  const key = process.env.CHONGFUXI_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!key) throw new ParagraphError("No Anthropic API key is set (CHONGFUXI_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY).");
  return key;
}

/** One structured call at Look up's model and effort; what it gave, parsed. */
async function ask(system: string, schema: Record<string, unknown>, content: string, maxTokens: number): Promise<Record<string, unknown>> {
  const message = await new Anthropic({ apiKey: apiKey() }).messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    output_config: { effort: EFFORT, format: { type: "json_schema", schema } },
    messages: [{ role: "user", content }],
  });
  console.log("paragraph usage", JSON.stringify(message.usage));
  const text = message.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("");
  try {
    return JSON.parse(text);
  } catch {
    throw new ParagraphError(message.stop_reason === "refusal" ? "The model declined." : "The model's answer came back malformed.");
  }
}

type Trouble = Omit<ParagraphTarget, "en">;

/**
 * The owner's trouble words, worst first: the words to revive (Muse's
 * categories, in their order), then deck words forgotten in the last
 * FORGOT_DAYS (on a card or tapped in a forgotten sentence), the most often
 * first. Those the last REST_AFTER paragraphs were built around wait while
 * TARGETS others remain.
 */
export async function troubleWords(sql: Sql, owner: string): Promise<Trouble[]> {
  await ensureTable(sql);
  const label = new Map(CATEGORIES.map((c) => [c.key, c.label]));
  const stuck = await stuckWords(sql, owner);
  const forgot = (await sql.query(
    `select r.word, count(*)::int as n, w.pinyin, w.defs, w.glosses
     from chongfuxi_review r
     join chongfuxi_word w on w.owner_email = r.owner_email and w.word = r.word and w.status = 'deck' and not ${SUSPENDED_WORD("w")}
     where r.owner_email = $1 and r.grade = 'forgot' and r.word is not null and r.at > now() - make_interval(days => $2)
     group by r.word, w.pinyin, w.defs, w.glosses
     order by n desc, max(r.at) desc
     limit 60`,
    [owner, FORGOT_DAYS],
  )) as unknown as Array<{ word: string; n: number; pinyin: string | null; defs: Definition[] | null; glosses: string[] | null }>;
  const all: Trouble[] = [];
  const seen = new Set<string>();
  for (const s of stuck)
    if (!seen.has(s.word) && seen.add(s.word))
    {
      const name = label.get(s.category) ?? s.category;
      // "Mixed up with 发现" says its category already.
      all.push({ word: s.word, pinyin: s.pinyin, gloss: s.gloss, why: s.why.startsWith(name) ? s.why : `${name}: ${s.why}` });
    }
  for (const f of forgot)
    if (!seen.has(f.word) && seen.add(f.word))
      all.push({ word: f.word, pinyin: shownPinyin(f.pinyin, f.defs) || null, gloss: f.glosses?.[0] ?? null, why: `Forgotten ${f.n === 1 ? "once" : `${f.n} times`} this month` });
  const lately = (await sql`
    select targets from chongfuxi_paragraph where owner_email = ${owner} order by at desc limit ${REST_AFTER}
  `) as unknown as Array<{ targets: ParagraphTarget[] }>;
  const resting = new Set(lately.flatMap((p) => p.targets.map((t) => t.word)));
  const fresh = all.filter((t) => !resting.has(t.word));
  return fresh.length >= TARGETS ? [...fresh, ...all.filter((t) => resting.has(t.word))] : all;
}

const WRITE_SYSTEM = `You write short English paragraphs for a learner of Mandarin to translate into Chinese, to practise words they keep getting wrong.
- Write ONE coherent paragraph of 3 to 6 sentences: a small everyday situation or story that makes sense from start to finish, with people, a place and something happening. Never a list of unrelated sentences, and nothing forced in to fit a word.
- Use as many of the target words as can sit naturally in one situation (at least three; leave out any that would make it strained). Each one you use must be the natural, obvious Chinese for some words of the English, in a sense it really has, so that a good translation would use it; phrase the English so that a near-synonym would not fit as well (the learner is being tested on that exact word).
- Keep everything else easy: words a learner who knows the given vocabulary can say. No names they'd have to transliterate beyond common ones (小王, 李老师).
- Natural, idiomatic English, not translationese.
- title: a few English words naming the situation.
- en: the paragraph.
- zh: a natural Chinese translation in simplified characters, using each target word you used exactly as written.
- targets: one entry per target word you used: the word, and en, the exact run of words in your English paragraph that it translates (copied character for character, as short as makes sense).`;

const WRITE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    en: { type: "string" },
    zh: { type: "string" },
    targets: {
      type: "array",
      items: {
        type: "object",
        properties: { word: { type: "string" }, en: { type: "string" } },
        required: ["word", "en"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "en", "zh", "targets"],
  additionalProperties: false,
} as const;

/** The model's paragraph, kept to what holds: each target word in the Chinese and its English run in the English. */
export function checkParagraph(given: Record<string, unknown>, offered: Trouble[]): { title: string; en: string; zh: string; targets: ParagraphTarget[] } {
  const en = clip(given.en);
  const zh = clip(given.zh);
  const byWord = new Map(offered.map((t) => [t.word, t]));
  const targets: ParagraphTarget[] = [];
  for (const t of Array.isArray(given.targets) ? given.targets : []) {
    const word = clip((t as Record<string, unknown>)?.word, 20);
    const run = clip((t as Record<string, unknown>)?.en, 200);
    const known = byWord.get(word);
    if (!known || !run || !en.includes(run) || !zh.includes(word) || targets.some((x) => x.word === word)) continue;
    targets.push({ ...known, en: run });
  }
  // In the order they come in the English.
  targets.sort((a, b) => en.indexOf(a.en) - en.indexOf(b.en));
  return { title: clip(given.title, 80) || "A paragraph", en, zh, targets };
}

/** The strongest known deck words, to write the rest with. */
async function knownWords(sql: Sql, owner: string): Promise<string[]> {
  const rows = (await sql.query(
    `select w.word from chongfuxi_word w
     join chongfuxi_card c on c.owner_email = w.owner_email and c.word = w.word and c.kind = 'read' and c.meaning_id is null
     where w.owner_email = $1 and w.status = 'deck' and not c.suspended and c.state > 0
     order by c.stability desc nulls last, w.word
     limit $2`,
    [owner, KNOWN_SHOWN],
  )) as unknown as Array<{ word: string }>;
  return rows.map((r) => r.word);
}

type Row = { id: number; at: number; title: string; en: string; zh: string; targets: ParagraphTarget[]; tries: ParagraphTry[] };

const fromRow = (r: Row): Paragraph => ({ id: r.id, at: Math.round(r.at), title: r.title, en: r.en, zh: r.zh, targets: r.targets, tries: r.tries });

/** The paragraphs, newest first. Owner only. */
export async function listParagraphs(sql: Sql, owner: string): Promise<Paragraph[]> {
  await ensureTable(sql);
  const rows = (await sql`
    select id::int as id, (extract(epoch from at) * 1000)::double precision as at, title, en, zh, targets, tries
    from chongfuxi_paragraph where owner_email = ${owner} order by at desc limit ${PARAGRAPHS_SHOWN}
  `) as unknown as Row[];
  return rows.map(fromRow);
}

type Ask = (system: string, schema: Record<string, unknown>, content: string, maxTokens: number) => Promise<Record<string, unknown>>;

/**
 * A new paragraph around the trouble words: up to TARGETS of them offered,
 * the model using those that sit in one situation. A paragraph that uses
 * fewer than three (or all offered, when fewer) is asked for once more.
 */
export async function writeParagraph(sql: Sql, owner: string, model: Ask = ask): Promise<Paragraph> {
  const trouble = await troubleWords(sql, owner);
  if (!trouble.length) throw new ParagraphError("No trouble words right now: nothing forgotten this month.");
  const offered = trouble.slice(0, TARGETS);
  const need = Math.min(3, offered.length);
  const known = await knownWords(sql, owner);
  let made = checkParagraph({}, offered);
  let feedback = "";
  for (let round = 0; round < 2 && made.targets.length < need; round++) {
    const content = [
      "Target words (the learner keeps getting these wrong):",
      ...offered.map((t) => `- ${t.word}${t.pinyin ? ` (${t.pinyin})` : ""}${t.gloss ? `: ${t.gloss}` : ""}`),
      ...(round ? [feedback] : []),
      "",
      `Words the learner knows well (${known.length}), to keep the rest within reach:`,
      known.join(" "),
    ].join("\n");
    made = checkParagraph(await model(WRITE_SYSTEM, WRITE_SCHEMA as unknown as Record<string, unknown>, content, 4000), offered);
    feedback = `Your last paragraph used only ${made.targets.length} of the target words in a way that could be checked (each must appear in zh exactly as written, and its en must be copied exactly from the paragraph). Use at least ${need}.`;
    console.log("paragraph written", JSON.stringify({ round, offered: offered.length, used: made.targets.length }));
  }
  if (!made.en || !made.zh || made.targets.length < Math.min(need, 1)) throw new ParagraphError("The model couldn't write a paragraph around those words. Try again.");
  await ensureTable(sql);
  const [row] = (await sql`
    insert into chongfuxi_paragraph (owner_email, model, title, en, zh, targets)
    values (${owner}, ${MODEL}, ${made.title}, ${made.en}, ${made.zh}, ${JSON.stringify(made.targets)}::jsonb)
    returning id::int as id, (extract(epoch from at) * 1000)::double precision as at, title, en, zh, targets, tries
  `) as unknown as Row[];
  return fromRow(row);
}

const GRADE_SYSTEM = `A learner of Mandarin translated an English paragraph into Chinese, to practise words they keep getting wrong. Grade it as a careful, encouraging teacher would. Judge their Chinese against the English: any natural, correct way of saying it is right, not only the reference translation you're given. The answer may have come from speech recognition: ignore slips that are clearly mishearings of the right words (homophones in the right place), but not real word choices.
- grade: "correct" when it says what the English says, grammatically and naturally (small punctuation slips don't count); "almost" when the meaning comes across but there are errors or unnatural spots; "wrong" when much of the meaning is lost or it is largely ungrammatical.
- fixed: their Chinese with as little changed as makes it correct and natural, keeping their own choices wherever those are right. The same text when correct.
- why: one or two sentences in English on how it went overall.
- points: each real mistake (at most 6, the most important first): wrong, the words they wrote (copied from their answer); right, what to write instead; why, a short English explanation naming the Chinese involved. None when correct.
- targets: for each target word, used: "yes" when they used it rightly for its part of the English, "other" when they said that part another way (said: what they wrote there), "no" when that part is missing or wrong (said: what they wrote there, or "").`;

const GRADE_SCHEMA = {
  type: "object",
  properties: {
    grade: { type: "string", enum: ["correct", "almost", "wrong"] },
    fixed: { type: "string" },
    why: { type: "string" },
    points: {
      type: "array",
      items: {
        type: "object",
        properties: { wrong: { type: "string" }, right: { type: "string" }, why: { type: "string" } },
        required: ["wrong", "right", "why"],
        additionalProperties: false,
      },
    },
    targets: {
      type: "array",
      items: {
        type: "object",
        properties: { word: { type: "string" }, used: { type: "string", enum: ["yes", "other", "no"] }, said: { type: "string" } },
        required: ["word", "used", "said"],
        additionalProperties: false,
      },
    },
  },
  required: ["grade", "fixed", "why", "points", "targets"],
  additionalProperties: false,
} as const;

/** The model's grade, kept to what holds: a known grade, points with something to fix, one verdict per target word (missing ones "no"). */
export function checkTry(given: Record<string, unknown>, answer: string, targets: ParagraphTarget[], at: number): ParagraphTry {
  const grade = given.grade === "correct" || given.grade === "almost" || given.grade === "wrong" ? given.grade : "almost";
  const points = (Array.isArray(given.points) ? given.points : [])
    .map((p) => ({ wrong: clip((p as Record<string, unknown>)?.wrong, 200), right: clip((p as Record<string, unknown>)?.right, 200), why: clip((p as Record<string, unknown>)?.why, 400) }))
    .filter((p) => p.right && p.wrong !== p.right)
    .slice(0, 6);
  const verdicts = new Map<string, { used: ParagraphTry["targets"][number]["used"]; said: string }>();
  for (const t of Array.isArray(given.targets) ? given.targets : []) {
    const r = t as Record<string, unknown>;
    const used = r?.used === "yes" || r?.used === "other" || r?.used === "no" ? r.used : null;
    if (typeof r?.word === "string" && used) verdicts.set(r.word.trim(), { used, said: clip(r.said, 60) });
  }
  return {
    at,
    answer,
    grade,
    fixed: clip(given.fixed, ANSWER_MAX + 200) || answer,
    why: clip(given.why, 600),
    points,
    // Code has the last word on the plain fact: a word that isn't in the answer wasn't used.
    targets: targets.map((t) => {
      const v = verdicts.get(t.word) ?? { used: answer.includes(t.word) ? "yes" : "no", said: "" };
      return { word: t.word, used: v.used === "yes" && !answer.includes(t.word) ? "other" : v.used, said: v.said };
    }),
  };
}

/** A try at a paragraph, graded and kept (newest first, TRIES_KEPT). Owner only. */
export async function tryParagraph(sql: Sql, owner: string, id: number, text: string, model: Ask = ask): Promise<Paragraph> {
  await ensureTable(sql);
  const answer = text.trim().slice(0, ANSWER_MAX);
  if (!/[㐀-鿿]/.test(answer)) throw new ParagraphError("Write it in Chinese.");
  const [row] = (await sql`
    select id::int as id, (extract(epoch from at) * 1000)::double precision as at, title, en, zh, targets, tries
    from chongfuxi_paragraph where owner_email = ${owner} and id = ${id}
  `) as unknown as Row[];
  if (!row) throw new ParagraphError("No such paragraph.");
  const content = [
    `The English:\n${row.en}`,
    `A reference translation (one good way, not the only one):\n${row.zh}`,
    `Target words, with the English each translates:\n${row.targets.map((t) => `- ${t.word}${t.gloss ? ` (${t.gloss})` : ""}: "${t.en}"`).join("\n")}`,
    `Their Chinese:\n${answer}`,
  ].join("\n\n");
  const done = checkTry(await model(GRADE_SYSTEM, GRADE_SCHEMA as unknown as Record<string, unknown>, content, 4000), answer, row.targets, Date.now());
  const tries = [done, ...row.tries].slice(0, TRIES_KEPT);
  await sql`update chongfuxi_paragraph set tries = ${JSON.stringify(tries)}::jsonb where owner_email = ${owner} and id = ${id}`;
  console.log("paragraph try", JSON.stringify({ id, grade: done.grade, used: done.targets.filter((t) => t.used === "yes").length, of: done.targets.length }));
  return fromRow({ ...row, tries });
}
