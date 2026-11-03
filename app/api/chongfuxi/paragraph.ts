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
import { ownersDay } from "./daily";
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
  // Muse writes them too (agent/paragraph): who wrote it, its sentences side by side with a note on each, and a note on the whole.
  await sql`alter table chongfuxi_paragraph add column if not exists by text not null default 'app'`;
  await sql`alter table chongfuxi_paragraph add column if not exists sentences jsonb`;
  await sql`alter table chongfuxi_paragraph add column if not exists note text`;
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

/** A trouble word as the writer is told about it: what is stored, plus what it needs. */
export type Trouble = Omit<ParagraphTarget, "en"> & {
  /** For a word mixed up: the word it is taken for, and that word's meaning. */
  partner: { word: string; gloss: string | null } | null;
  /** What the owner wrote after forgetting it (newest first), and what they wrote for it in earlier paragraphs. */
  notes: string[];
  said: string[];
};

/** Earlier paragraphs read for what went wrong; mistakes from them passed on; notes read per word. */
const PAST_PARAGRAPHS = 5;
const MISTAKES_SHOWN = 8;
const NOTES_PER_WORD = 2;
const NOTE_DAYS = 90;

/** The latest try of each of the last PAST_PARAGRAPHS paragraphs tried: the words it missed and its mistakes. */
async function pastTries(sql: Sql, owner: string) {
  const rows = (await sql`
    select targets, tries from chongfuxi_paragraph
    where owner_email = ${owner} and jsonb_array_length(tries) > 0
    order by at desc limit ${PAST_PARAGRAPHS}
  `) as unknown as Array<{ targets: ParagraphTarget[]; tries: ParagraphTry[] }>;
  const missed = new Map<string, { target: ParagraphTarget; said: string[]; other: boolean }>();
  const mistakes: ParagraphTry["points"] = [];
  for (const r of rows) {
    const last = r.tries[0];
    for (const t of last.targets) {
      if (t.used === "yes") continue;
      const target = r.targets.find((x) => x.word === t.word);
      if (!target) continue;
      const m = missed.get(t.word) ?? { target, said: [], other: false };
      if (t.said) m.said.push(t.said);
      if (t.used === "other") m.other = true;
      missed.set(t.word, m);
    }
    for (const p of last.points) if (mistakes.length < MISTAKES_SHOWN && !mistakes.some((x) => x.right === p.right)) mistakes.push(p);
  }
  return { missed, mistakes };
}

/**
 * The owner's trouble words, most needed first: those missed in their
 * latest paragraphs (said another way or left out), then the words to
 * revive (Muse's categories, in their order), then deck words forgotten in
 * the last FORGOT_DAYS (on a card or tapped in a forgotten sentence), the
 * most often first. Those the last REST_AFTER paragraphs were built around
 * wait while TARGETS others remain, unless they were missed. Each comes
 * with what it needs: its partner when mixed up, the owner's notes after
 * forgetting it, what they wrote for it before.
 */
export async function troubleWords(sql: Sql, owner: string): Promise<Trouble[]> {
  await ensureTable(sql);
  const label = new Map(CATEGORIES.map((c) => [c.key, c.label]));
  const stuck = await stuckWords(sql, owner);
  const past = await pastTries(sql, owner);
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
  const add = (t: Trouble) => {
    if (seen.has(t.word)) return;
    seen.add(t.word);
    all.push(t);
  };
  // A word to revive: its category and why ("Mixed up with 发现" says its category already).
  const revive = new Map(
    stuck.map((w) => {
      const name = label.get(w.category) ?? w.category;
      return [w.word, { why: w.why.startsWith(name) ? w.why : `${name}: ${w.why}`, partner: w.partner ? { word: w.partner, gloss: null } : null }];
    }),
  );
  for (const [word, m] of past.missed) {
    const missedWhy = m.other ? `Said another way in a paragraph${m.said.length ? ` (you wrote ${m.said[0]})` : ""}` : `Left out of a paragraph${m.said.length ? ` (you wrote ${m.said[0]})` : ""}`;
    const r = revive.get(word);
    add({ word, pinyin: m.target.pinyin, gloss: m.target.gloss, why: r ? `${missedWhy}; ${r.why}` : missedWhy, partner: r?.partner ?? null, notes: [], said: m.said });
  }
  for (const w of stuck) {
    const r = revive.get(w.word)!;
    add({ word: w.word, pinyin: w.pinyin, gloss: w.gloss, why: r.why, partner: r.partner, notes: [], said: [] });
  }
  for (const f of forgot)
    add({ word: f.word, pinyin: shownPinyin(f.pinyin, f.defs) || null, gloss: f.glosses?.[0] ?? null, why: `Forgotten ${f.n === 1 ? "once" : `${f.n} times`} this month`, partner: null, notes: [], said: [] });

  const lately = (await sql`
    select targets from chongfuxi_paragraph where owner_email = ${owner} order by at desc limit ${REST_AFTER}
  `) as unknown as Array<{ targets: ParagraphTarget[] }>;
  const resting = new Set(lately.flatMap((p) => p.targets.map((t) => t.word)).filter((w) => !past.missed.has(w)));
  const fresh = all.filter((t) => !resting.has(t.word));
  const ordered = fresh.length >= TARGETS ? [...fresh, ...all.filter((t) => resting.has(t.word))] : all;

  // What the first few need: the partner's meaning, the notes written after forgetting them, what they wrote before.
  const head = ordered.slice(0, TARGETS * 2);
  if (head.length) {
    const words = head.map((t) => t.word);
    const notes = (await sql`
      select word, comment from chongfuxi_review
      where owner_email = ${owner} and word = any(${words}) and comment is not null and comment <> ''
        and at > now() - make_interval(days => ${NOTE_DAYS})
      order by at desc
    `) as unknown as Array<{ word: string; comment: string }>;
    for (const n of notes) {
      const t = head.find((x) => x.word === n.word)!;
      if (t.notes.length < NOTES_PER_WORD) t.notes.push(n.comment.trim().slice(0, 200));
    }
    const partners = head.flatMap((t) => (t.partner ? [t.partner.word] : []));
    if (partners.length) {
      const glosses = (await sql`
        select word, glosses from chongfuxi_word where owner_email = ${owner} and word = any(${partners})
      `) as unknown as Array<{ word: string; glosses: string[] | null }>;
      for (const t of head) if (t.partner) t.partner.gloss = glosses.find((g) => g.word === t.partner!.word)?.glosses?.[0] ?? null;
    }
  }
  return ordered;
}

/** The mistakes of the latest paragraphs tried, for the writer to give another go at. */
export async function recentMistakes(sql: Sql, owner: string): Promise<ParagraphTry["points"]> {
  await ensureTable(sql);
  return (await pastTries(sql, owner)).mistakes;
}

/** What the writer is told about one trouble word. */
export function briefOf(t: Trouble): string {
  const lines = [`- ${t.word}${t.pinyin ? ` (${t.pinyin})` : ""}${t.gloss ? `: ${t.gloss}` : ""}`, `  Trouble: ${t.why}.`];
  if (t.partner) lines.push(`  They take it for ${t.partner.word}${t.partner.gloss ? ` (${t.partner.gloss})` : ""}.`);
  for (const n of t.notes) lines.push(`  Their note after forgetting it: "${n}"`);
  if (t.said.length) lines.push(`  In an earlier paragraph they wrote ${t.said.map((x) => `"${x}"`).join(", ")} where it belonged.`);
  return lines.join("\n");
}

const WRITE_SYSTEM = `You write short English paragraphs for a learner of Mandarin to translate into Chinese, to practise the words and points they keep getting wrong. You are told, for each target word, why it is trouble and what they did wrong with it; aim each word's part of the paragraph at exactly that.
- Write ONE coherent paragraph of 3 to 6 sentences: a small everyday situation or story that makes sense from start to finish, with people, a place and something happening. Never a list of unrelated sentences, and nothing forced in to fit a word.
- Use as many of the target words as can sit naturally in one situation (at least three, the first ones listed first: they are the most needed; leave out any that would make it strained). Each one you use must be the natural, obvious Chinese for some words of the English, in a sense it really has, so that a good translation would use it; phrase the English so that a near-synonym would not fit as well (the learner is being tested on that exact word).
- Aim at the trouble:
  - Taken for another word (mixed up): make the English clearly call for this word and not the other, ideally with the other word's meaning nearby too so both must be told apart.
  - Can't produce it (recognises it, can't come up with it): make the English unmistakable, so the only thing between them and the word is recall.
  - Breaks in context: use it in a full, natural sentence with real context around it, in its usual collocations.
  - Slipping, won't stick, a leech, forgotten lately: a vivid, memorable use in its commonest sense.
  - Missed in an earlier paragraph (they wrote something else, or left it out): set up the same kind of meaning again so they get a second chance at it.
  - Use their notes: they say what the learner thought or confused; make the paragraph test exactly that.
- If you are given mistakes from earlier paragraphs, also give them a natural chance to get one or two of those points right this time (the same structure, collocation or word, in new words), when it fits the story.
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
    targets.push({ word: known.word, pinyin: known.pinyin, gloss: known.gloss, why: known.why, en: run });
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

type Row = {
  id: number;
  at: number;
  title: string;
  en: string;
  zh: string;
  targets: ParagraphTarget[];
  tries: ParagraphTry[];
  by: Paragraph["by"];
  sentences: Paragraph["sentences"];
  note: string | null;
};
const COLUMNS = `id::int as id, (extract(epoch from at) * 1000)::double precision as at, title, en, zh, targets, tries, by, sentences, note`;

const fromRow = (r: Row): Paragraph => ({
  id: r.id,
  at: Math.round(r.at),
  title: r.title,
  en: r.en,
  zh: r.zh,
  targets: r.targets,
  tries: r.tries,
  by: r.by === "muse" ? "muse" : "app",
  sentences: r.sentences ?? null,
  note: r.note ?? null,
});

/** The paragraphs, newest first. Owner only. */
export async function listParagraphs(sql: Sql, owner: string): Promise<Paragraph[]> {
  await ensureTable(sql);
  const rows = (await sql.query(
    `select ${COLUMNS} from chongfuxi_paragraph where owner_email = $1 order by at desc limit $2`,
    [owner, PARAGRAPHS_SHOWN],
  )) as unknown as Row[];
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
  const mistakes = await recentMistakes(sql, owner);
  let made = checkParagraph({}, offered);
  let feedback = "";
  for (let round = 0; round < 2 && made.targets.length < need; round++) {
    const content = [
      "Target words, the most needed first, each with why it is trouble:",
      ...offered.map(briefOf),
      ...(mistakes.length
        ? ["", "Mistakes from their earlier paragraphs (wrote → should be: why):", ...mistakes.map((m) => `- ${m.wrong || "(nothing)"} → ${m.right}: ${m.why}`)]
        : []),
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
    returning id
  `) as unknown as Array<{ id: number }>;
  return paragraphById(sql, owner, Number(row.id));
}

async function paragraphById(sql: Sql, owner: string, id: number): Promise<Paragraph> {
  const [row] = (await sql.query(`select ${COLUMNS} from chongfuxi_paragraph where owner_email = $1 and id = $2`, [owner, id])) as unknown as Row[];
  if (!row) throw new ParagraphError("No such paragraph.");
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
  const row = await paragraphById(sql, owner, id);
  const content = [
    `The English:\n${row.en}`,
    `A reference translation (one good way, not the only one):\n${row.zh}`,
    ...(row.sentences?.some((x) => x.note) ? [`Notes on the reference's choices:\n${row.sentences.filter((x) => x.note).map((x) => `- ${x.zh}: ${x.note}`).join("\n")}`] : []),
    `Target words, with the English each translates:\n${row.targets.map((t) => `- ${t.word}${t.gloss ? ` (${t.gloss})` : ""}: "${t.en}"`).join("\n")}`,
    `Their Chinese:\n${answer}`,
  ].join("\n\n");
  const done = checkTry(await model(GRADE_SYSTEM, GRADE_SCHEMA as unknown as Record<string, unknown>, content, 4000), answer, row.targets, Date.now());
  const tries = [done, ...row.tries].slice(0, TRIES_KEPT);
  await sql`update chongfuxi_paragraph set tries = ${JSON.stringify(tries)}::jsonb where owner_email = ${owner} and id = ${id}`;
  console.log("paragraph try", JSON.stringify({ id, grade: done.grade, used: done.targets.filter((t) => t.used === "yes").length, of: done.targets.length }));
  return { ...row, tries };
}

// ------------------------------------------------------------------ Muse

/** Paragraphs Muse may write in 24 hours; sentences in one. */
export const MUSE_A_DAY = 5;
const SENTENCES_MIN = 2;
const SENTENCES_MAX = 8;
/** Trouble words handed to Muse, with what each needs. */
const TROUBLE_SHOWN = 15;

const MUSE_BRIEF = `Write the learner's "Write it in Chinese" paragraphs: the main thing on their Muse tab. They read an English paragraph, write it in Chinese (typed or said), and the app's model grades each try against the English at once, with fixes and whether each target word was used. Afterwards they compare their try with your ideal translation, sentence by sentence, with your notes.

What to write (POST /api/chongfuxi/agent/paragraph):
{ "title": "a few English words naming the situation",
  "note"?: "one line on what this paragraph is aimed at (shown with your translation once they have tried, so it may name the words)",
  "sentences": [{ "en": "one English sentence", "zh": "your ideal Chinese for it, simplified", "note"?: "why you said it this way: the word choice, the structure, what a learner would get wrong" }],
  "targets": [{ "word": "a deck word it tests", "en": "the exact words of the English it translates", "why"?: "why it is trouble, if you know better than the material" }],
  "model"? }
${SENTENCES_MIN}–${SENTENCES_MAX} sentences forming ONE coherent everyday situation or little story that makes sense from start to finish (never unrelated sentences, nothing forced in to fit a word). 3–5 targets, each the natural, obvious Chinese for its English (phrase the English so a near-synonym fits worse), each "word" appearing in your Chinese exactly as written and each "en" copied exactly from one sentence's English. Everything else within words they know ("known"). Natural English, not translationese; the ideal Chinese natural too, the way a native would write it, not word for word. Up to ${MUSE_A_DAY} in 24 hours; one a day is usually right.

Aim at what they need ("trouble", most needed first, each with why, the word it's taken for, their notes after forgetting it, what they wrote in its place before; "mistakes" from their recent tries):
- Taken for another word: make the English call for this word and not the other, ideally with the other's meaning nearby too.
- Can't produce it: unmistakable English, so recall is all that stands between them and the word.
- Breaks in context: a full sentence in its usual collocations.
- Slipping, won't stick, leech, forgotten: a vivid use in its commonest sense.
- Missed in an earlier paragraph: the same kind of meaning again, a second chance.
- Their notes say what they confused: test exactly that.
- Give one or two earlier mistakes another chance (the same structure or collocation in new words) when it fits.
Use "recent" (their last paragraphs and every graded try): don't repeat a paragraph's words that went well; come back to what didn't.`;

/** What Muse needs to write a paragraph. Same token as agent/lists. */
export async function paragraphMaterial(sql: Sql, owner: string) {
  await ensureTable(sql);
  const day = await ownersDay(sql, owner);
  const [trouble, mistakes, known, recent, today] = await Promise.all([
    troubleWords(sql, owner),
    recentMistakes(sql, owner),
    knownWords(sql, owner),
    sql.query(`select ${COLUMNS} from chongfuxi_paragraph where owner_email = $1 order by at desc limit 8`, [owner]) as unknown as Promise<Row[]>,
    sql`select count(*)::int as n from chongfuxi_paragraph where owner_email = ${owner} and by = 'muse' and at > now() - interval '24 hours'` as unknown as Promise<Array<{ n: number }>>,
  ]);
  return {
    brief: MUSE_BRIEF,
    day,
    /** Written by you in the last 24 hours, and how many more may be. */
    written: today[0]?.n ?? 0,
    left: Math.max(0, MUSE_A_DAY - (today[0]?.n ?? 0)),
    trouble: trouble.slice(0, TROUBLE_SHOWN),
    mistakes,
    known,
    recent: recent.map(fromRow),
  };
}

/**
 * A paragraph Muse wrote, kept to what holds: 2 to 8 sentences with
 * English and Chinese; each target a deck word in the Chinese, its English
 * copied from the English. Each target's reading and meaning come from the
 * deck, and why it is trouble from the trouble words unless Muse says.
 */
export async function writeMuseParagraph(sql: Sql, owner: string, input: Record<string, unknown>): Promise<Paragraph> {
  await ensureTable(sql);
  const sentences = (Array.isArray(input.sentences) ? input.sentences : [])
    .map((x) => {
      const r = (x ?? {}) as Record<string, unknown>;
      const note = clip(r.note, 400);
      return { en: clip(r.en, 400), zh: clip(r.zh, 300), ...(note ? { note } : {}) };
    })
    .filter((x) => x.en && /[㐀-鿿]/.test(x.zh));
  if (sentences.length < SENTENCES_MIN) throw new ParagraphError(`Give ${SENTENCES_MIN} to ${SENTENCES_MAX} sentences, each with "en" and Chinese "zh".`);
  if (sentences.length > SENTENCES_MAX) throw new ParagraphError(`At most ${SENTENCES_MAX} sentences.`);
  const en = sentences.map((x) => x.en).join(" ");
  const zh = sentences.map((x) => x.zh).join("");
  const given = (Array.isArray(input.targets) ? input.targets : []).map((x) => (x ?? {}) as Record<string, unknown>);
  const words = [...new Set(given.map((t) => clip(t.word, 20)).filter(Boolean))];
  const deck = (await sql`
    select word, pinyin, defs, glosses from chongfuxi_word where owner_email = ${owner} and status = 'deck' and word = any(${words})
  `) as unknown as Array<{ word: string; pinyin: string | null; defs: Definition[] | null; glosses: string[] | null }>;
  const trouble = new Map((await troubleWords(sql, owner)).map((t) => [t.word, t]));
  const targets: ParagraphTarget[] = [];
  const dropped: string[] = [];
  for (const t of given) {
    const word = clip(t.word, 20);
    const run = clip(t.en, 200);
    const row = deck.find((d) => d.word === word);
    if (!row) dropped.push(`${word || "?"}: not a deck word`);
    else if (!zh.includes(word)) dropped.push(`${word}: not in the Chinese`);
    else if (!run || !en.includes(run)) dropped.push(`${word}: its "en" isn't copied from the English`);
    else if (!targets.some((x) => x.word === word))
      targets.push({
        word,
        pinyin: shownPinyin(row.pinyin, row.defs) || null,
        gloss: row.glosses?.[0] ?? null,
        why: clip(t.why, 200) || trouble.get(word)?.why || "Picked by Muse",
        en: run,
      });
  }
  if (!targets.length) throw new ParagraphError(`No target held${dropped.length ? `: ${dropped.join("; ")}` : ""}. Each needs a deck "word" in the Chinese and its "en" copied from the English.`);
  targets.sort((a, b) => en.indexOf(a.en) - en.indexOf(b.en));
  const [{ n }] = (await sql`
    select count(*)::int as n from chongfuxi_paragraph
    where owner_email = ${owner} and by = 'muse' and at > now() - interval '24 hours'
  `) as unknown as Array<{ n: number }>;
  if (n >= MUSE_A_DAY) throw new ParagraphError(`Already ${MUSE_A_DAY} paragraphs in the last 24 hours.`);
  const [row] = (await sql`
    insert into chongfuxi_paragraph (owner_email, model, title, en, zh, targets, by, sentences, note)
    values (${owner}, ${clip(input.model, 80) || "Muse"}, ${clip(input.title, 80) || "A paragraph"}, ${en}, ${zh}, ${JSON.stringify(targets)}::jsonb,
            'muse', ${JSON.stringify(sentences)}::jsonb, ${clip(input.note, 300) || null})
    returning id
  `) as unknown as Array<{ id: number }>;
  const made = await paragraphById(sql, owner, Number(row.id));
  return Object.assign(made, dropped.length ? { dropped } : {});
}
