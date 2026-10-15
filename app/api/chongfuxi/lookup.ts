// Look up: "what do I say here", answered from the owner's own sentences.
//
// One model call that reads the query and judges the options, with the
// evidence as tools it chooses from (lookup-evidence.ts): the owner's
// sentences searched on either side, the words that pair with a word in
// them, CC-CEDICT (both ways) and the deck. The answer has a fixed shape
// (ANSWER_SCHEMA), and the check after it (lookup-check.ts) keeps only what
// the evidence backs. Each lookup is kept (chongfuxi_lookup), which caches it
// and, with the owner's Right / Wrong, is the test set the plan asks for.
//
// The model is CHONGFUXI_LOOKUP_MODEL (default claude-opus-5-5) at
// CHONGFUXI_LOOKUP_EFFORT (default medium), on CHONGFUXI_ANTHROPIC_API_KEY,
// else the site's ANTHROPIC_API_KEY. Owner only: every lookup costs money.

import Anthropic from "@anthropic-ai/sdk";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import type { LookupAnswer, LookupListed, LookupSentence } from "@chongfuxi/lib/api";
import type { Sql } from "./db";
import { dictEntry } from "./headwords";
import { checkAnswer, type ModelAnswer } from "./lookup-check";
import { dictionary, englishCandidates, neighbours, newSeen, searchSentences, together, type Seen } from "./lookup-evidence";

export class LookupError extends Error {}

const MODEL = process.env.CHONGFUXI_LOOKUP_MODEL || "claude-opus-5-5";
const EFFORT = (process.env.CHONGFUXI_LOOKUP_EFFORT || "medium") as "low" | "medium" | "high" | "xhigh" | "max";
/** Models the server-side fallback on a refusal is offered for. */
const WITH_FALLBACK = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);

/** Dollars per million tokens: input, output, cache read, cache write. Estimates, for the cost line under an answer. */
const PRICES: Record<string, [number, number, number, number]> = {
  "claude-opus-5-5": [4, 20, 0.2, 5],
  "claude-sonnet-5-5": [2, 10, 0.2, 2.5],
  "claude-haiku-5-5": [0.1, 0.5, 0.01, 0.125],
};

const SYSTEM = `You are the Look up screen of 重复习, a Mandarin review app with one user: an English speaker at about HSK 5 who studies from their own sentences (Pleco, textbooks, Anki decks), most of which have English translations. They type what they want to say, in English, Chinese, pinyin or a mix, and you tell them what a Chinese speaker would say, and why the near misses are wrong. It is a dictionary, not a chat: the answer is data in a fixed shape, not prose.

Kinds of question:
- pairing: which word goes with another ("develop depression": 得了 / 患上 抑郁症, not 发展).
- meaning: a word with several meanings; say which applies ("trauma": 创伤 of the mind vs 外伤 of the body).
- synonyms: near-synonyms told apart by meaning or grammar (以为 means you were wrong; 帮忙 takes no object).
- tone: connotation (后果 is always bad).
- pattern: a sentence pattern with slots (越…越…).
- expression: a whole-sentence equivalent ("I'm not in the mood": 没心情).
- reading: what something means in context (你真行).

Which part is the question. Split the query into parts and mark which are asked. In a pair, the noun (base) translates on its own and the verb or adjective (collocate) depends on it, so the collocate is usually the question. A part the user wrote in Chinese is known, not asked. A part that fans out to many words is more likely asked than one that is nearly always the same word. If the dictionary tool shows a strong deck card for a word, the user knows it.

Evidence. Gather it before judging, with the tools:
- english_candidates for an English part: dictionary headwords, with how often each is in the user's sentences.
- dictionary for Chinese words: entries, whether the user has it in their deck (and how strong), and how often it is in their sentences.
- neighbours and together for pairing: which words come before or after a word in the user's sentences, and how often two words appear together.
- search_sentences to find the user's sentences by their English translation or by Chinese words; the English side often finds the Chinese the user wants.
Pair counts mislead on their own: 有 is common before 抑郁症 but means having it, not getting it; a pair can be split (帮了我一个忙); a small corpus has few examples. Weigh them with meaning and grammar.

Rules for the answer:
- Never write pinyin; the app adds it from its own dictionary.
- Every option's zh is a Chinese word or short phrase, as it would be written in the gap.
- A point with source "corpus" must give a count exactly as a tool returned it for that word or pair; otherwise use count -1. Use "dictionary" only for what the dictionary tool showed, "deck" only for what it showed about the deck, and "model" for your own knowledge.
- examples are ids of sentences the tools returned, never invented. If you want to show a sentence the tools didn't find, put it in written, which is labelled as yours.
- Give the 2 to 4 options that fit (fits true) and the 2 to 4 near misses a learner would reach for (fits false). For each near miss give a wrong sentence and the right one, in Chinese.
- frame is the Chinese phrase with ___ for the asked part ("___抑郁症"), or "" when there is no single gap.
- senses: only when a word has several meanings that need different words; otherwise [].
- verdict, says, note and summary are short plain English. If the user's sentences had nothing, say so in summary.`;

/** The answer's fixed shape. Every field is required; empty means none. */
const ANSWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reading", "frame", "senses", "options", "written", "summary"],
  properties: {
    reading: {
      type: "object",
      additionalProperties: false,
      required: ["parts", "kind", "note"],
      properties: {
        parts: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["text", "asked"],
            properties: { text: { type: "string" }, asked: { type: "boolean" } },
          },
        },
        kind: { type: "string", enum: ["pairing", "meaning", "synonyms", "tone", "pattern", "expression", "reading"] },
        note: { type: "string" },
      },
    },
    frame: { type: "string" },
    senses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "words"],
        properties: { label: { type: "string" }, words: { type: "array", items: { type: "string" } } },
      },
    },
    options: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["zh", "fits", "verdict", "points", "examples", "wrong", "right"],
        properties: {
          zh: { type: "string" },
          fits: { type: "boolean" },
          verdict: { type: "string" },
          points: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["point", "says", "source", "count"],
              properties: {
                point: { type: "string", enum: ["meaning", "pairing", "grammar", "register", "tone", "frequency"] },
                says: { type: "string" },
                source: { type: "string", enum: ["corpus", "dictionary", "deck", "model"] },
                count: { type: "integer" },
              },
            },
          },
          examples: { type: "array", items: { type: "integer" } },
          wrong: { type: "string" },
          right: { type: "string" },
        },
      },
    },
    written: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["zh", "en"],
        properties: { zh: { type: "string" }, en: { type: "string" } },
      },
    },
    summary: { type: "string" },
  },
} as const;

/** The evidence, as tools for this lookup. Each records what it returned in `seen`. */
function tools(sql: Sql, owner: string, seen: Seen) {
  const json = (v: unknown) => JSON.stringify(v);
  return [
    betaTool({
      name: "english_candidates",
      description:
        "Chinese dictionary headwords whose senses say this English word or short phrase (e.g. 'develop', 'depression'), exact matches first, each with how many of the user's sentences contain it.",
      inputSchema: {
        type: "object",
        properties: { english: { type: "string", description: "One English word or short phrase." } },
        required: ["english"],
        additionalProperties: false,
      },
      run: async ({ english }) => json(await englishCandidates(sql, owner, seen, { english })),
    }),
    betaTool({
      name: "dictionary",
      description:
        "For each Chinese word: its CC-CEDICT entries (senses), whether it is in the user's deck and how strong their card is (days it would be remembered), and how many of their sentences contain it.",
      inputSchema: {
        type: "object",
        properties: { words: { type: "array", items: { type: "string" }, description: "Up to 12 Chinese words." } },
        required: ["words"],
        additionalProperties: false,
      },
      run: async ({ words }) => json(await dictionary(sql, owner, seen, { words })),
    }),
    betaTool({
      name: "neighbours",
      description:
        "The words that come just before (or after) a Chinese word in the user's sentences, within up to 3 words, by how many sentences have each pair. Use it to see what a word goes with, e.g. the verbs before 抑郁症.",
      inputSchema: {
        type: "object",
        properties: {
          word: { type: "string" },
          side: { type: "string", enum: ["before", "after"] },
          window: { type: "integer", description: "1 to 3 words; default 1." },
        },
        required: ["word", "side"],
        additionalProperties: false,
      },
      run: async ({ word, side, window }) => json(await neighbours(sql, owner, seen, { word, side, window })),
    }),
    betaTool({
      name: "together",
      description:
        "How many of the user's sentences have one Chinese word followed by another within a few words (e.g. 得 then 抑郁症), with up to 5 of them.",
      inputSchema: {
        type: "object",
        properties: {
          first: { type: "string" },
          second: { type: "string" },
          window: { type: "integer", description: "1 to 4 words; default 2." },
        },
        required: ["first", "second"],
        additionalProperties: false,
      },
      run: async ({ first, second, window }) => json(await together(sql, owner, seen, { first, second, window })),
    }),
    betaTool({
      name: "search_sentences",
      description:
        "The user's own sentences whose English translation has all these English words (any form: 'develop' finds 'developed') and whose Chinese has all these Chinese words, readable ones first. Returns ids to cite as examples, and the total found.",
      inputSchema: {
        type: "object",
        properties: {
          english: { type: "string", description: "English words to find in the translation, or empty." },
          chinese: { type: "array", items: { type: "string" }, description: "Chinese words the sentence must contain, or empty." },
          limit: { type: "integer", description: "1 to 20; default 10." },
        },
        required: [],
        additionalProperties: false,
      },
      run: async ({ english, chinese, limit }) => json(await searchSentences(sql, owner, seen, { english, chinese, limit })),
    }),
  ];
}

/** Lower case, single spaces: the same question asked twice is one lookup. */
export const normalise = (q: string) => q.trim().replace(/\s+/g, " ").toLowerCase().slice(0, 200);

let ready = false;
/** The table, made on first use so a deploy needs no migration first. Same as sql/001_init.sql. */
async function ensure(sql: Sql) {
  if (ready) return;
  await sql`
    create table if not exists chongfuxi_lookup (
      owner_email text not null,
      query text not null,
      at timestamptz not null default now(),
      model text not null,
      kind text,
      answer jsonb not null,
      verdict text,
      note text,
      primary key (owner_email, query)
    )
  `;
  ready = true;
}

/** The owner's sentences these answers cite, by id. */
async function sentencesById(sql: Sql, owner: string, ids: number[]): Promise<Map<number, LookupSentence>> {
  if (!ids.length) return new Map();
  const rows = (await sql`
    select id::int as id, zh, en, blockers from chongfuxi_sentence
    where owner_email = ${owner} and id = any(${ids}::bigint[])
  `) as unknown as Array<{ id: number; zh: string; en: string | null; blockers: string[] }>;
  return new Map(rows.map((r) => [r.id, { id: r.id, zh: r.zh, en: r.en, readable: r.blockers.length === 0 }]));
}

/** Answer a query: the kept answer, unless `fresh`; otherwise ask the model, check, keep. */
export async function lookUpPhrase(sql: Sql, owner: string, query: string, fresh = false): Promise<LookupAnswer> {
  const q = normalise(query);
  if (!q) throw new LookupError("What do you want to say?");
  await ensure(sql);
  if (!fresh) {
    const kept = (await sql`select answer from chongfuxi_lookup where owner_email = ${owner} and query = ${q}`) as unknown as Array<{
      answer: LookupAnswer;
    }>;
    if (kept[0]) return kept[0].answer;
  }
  const apiKey = process.env.CHONGFUXI_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new LookupError("No Anthropic API key is set (CHONGFUXI_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY).");

  const client = new Anthropic({ apiKey });
  const seen = newSeen();
  const runner = client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    max_iterations: 12,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    output_config: { effort: EFFORT, format: { type: "json_schema", schema: ANSWER_SCHEMA as unknown as Record<string, unknown> } },
    tools: tools(sql, owner, seen),
    messages: [{ role: "user", content: query.trim() }],
    ...(WITH_FALLBACK.has(MODEL) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  });

  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 };
  for await (const message of runner) {
    usage.calls++;
    usage.input += message.usage.input_tokens;
    usage.output += message.usage.output_tokens;
    usage.cacheRead += message.usage.cache_read_input_tokens ?? 0;
    usage.cacheWrite += message.usage.cache_creation_input_tokens ?? 0;
  }
  const final = await runner.done();
  if (final.stop_reason === "refusal") throw new LookupError("The model declined this one.");
  if (final.stop_reason === "max_tokens") throw new LookupError("The answer ran out of room; try a shorter question.");
  const text = final.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let raw: ModelAnswer;
  try {
    raw = JSON.parse(text) as ModelAnswer;
  } catch {
    throw new LookupError(final.stop_reason === "tool_use" ? "The lookup took too many steps; try again." : "The answer came back malformed.");
  }

  const cited = [...new Set(raw.options.flatMap((o) => o.examples))].filter((id) => seen.sentences.has(id));
  const checked = checkAnswer(raw, seen, { entry: (w) => dictEntry(w), sentences: await sentencesById(sql, owner, cited) });
  const answer: LookupAnswer = {
    ...checked,
    query: q,
    model: final.model,
    at: Date.now(),
    usage: { input: usage.input + usage.cacheRead + usage.cacheWrite, output: usage.output, calls: usage.calls },
  };
  const price = PRICES[MODEL];
  if (price) {
    const dollars = (usage.input * price[0] + usage.output * price[1] + usage.cacheRead * price[2] + usage.cacheWrite * price[3]) / 1e6;
    answer.checks.push(`About $${dollars.toFixed(3)} (${usage.calls} model calls, ${MODEL}).`);
  }
  await sql`
    insert into chongfuxi_lookup (owner_email, query, model, kind, answer)
    values (${owner}, ${q}, ${answer.model}, ${answer.reading.kind}, ${JSON.stringify(answer)}::jsonb)
    on conflict (owner_email, query) do update
      set at = now(), model = excluded.model, kind = excluded.kind, answer = excluded.answer, verdict = null, note = null
  `;
  return answer;
}

/** Past lookups, newest first, with the owner's verdicts. */
export async function listLookups(sql: Sql, owner: string): Promise<LookupListed[]> {
  await ensure(sql);
  const rows = (await sql`
    select query, (extract(epoch from at) * 1000)::double precision as at, kind, verdict, note
    from chongfuxi_lookup where owner_email = ${owner}
    order by at desc limit 200
  `) as unknown as Array<{ query: string; at: number; kind: LookupListed["kind"]; verdict: LookupListed["verdict"]; note: string | null }>;
  return rows.map((r) => ({ ...r, at: Math.round(r.at) }));
}

/** The owner's verdict on a lookup: right, wrong (with what was wrong), or cleared. */
export async function judgeLookup(sql: Sql, owner: string, query: string, verdict: "right" | "wrong" | null, note: string | null) {
  await ensure(sql);
  await sql`
    update chongfuxi_lookup set verdict = ${verdict}, note = ${note}
    where owner_email = ${owner} and query = ${normalise(query)}
  `;
}
