// Look up: "what do I say here", answered from the owner's own sentences.
//
// One model call that reads the query and composes the answer, with the
// evidence as tools it chooses from (lookup-evidence.ts): the owner's
// sentences searched on either side, the words that pair with a word in
// them, CC-CEDICT (both ways) and the deck. The answer is a list of blocks
// from a closed set the app draws (ANSWER_SCHEMA: gap phrase, sense,
// contrast, scale, pattern, family, wrong-right, example), and the check
// after it (lookup-check.ts) keeps only what the evidence backs. Each lookup is kept (chongfuxi_lookup), which caches it
// and, with the owner's Right / Wrong, is the test set the plan asks for.
//
// The model is CHONGFUXI_LOOKUP_MODEL (default claude-haiku-5-5, the owner's
// choice: well under a cent a lookup) at CHONGFUXI_LOOKUP_EFFORT (default
// medium), on CHONGFUXI_ANTHROPIC_API_KEY, else the site's ANTHROPIC_API_KEY.
// Owner only: every lookup costs money.

import Anthropic from "@anthropic-ai/sdk";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import type { LookupAnswer, LookupAnswerV1, LookupDeck, LookupListed, LookupSentence } from "@chongfuxi/lib/api";
import { addWords } from "./additions";
import type { Sql } from "./db";
import { loadDict } from "./dictfile";
import { dictEntry } from "./headwords";
import { checkAnswer, citedIds, fromV1, mistakeKey, normaliseAnswer, type ModelAnswer } from "./lookup-check";
import { dictionary, englishCandidates, neighbours, newSeen, searchSentences, together, type Seen } from "./lookup-evidence";

export class LookupError extends Error {}

const MODEL = process.env.CHONGFUXI_LOOKUP_MODEL || "claude-haiku-5-5";
const EFFORT = (process.env.CHONGFUXI_LOOKUP_EFFORT || "medium") as "low" | "medium" | "high" | "xhigh" | "max";
/** Models the server-side fallback on a refusal is offered for. Haiku has none: a refusal there is shown as such. */
const WITH_FALLBACK = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);

/**
 * Dollars per million tokens: input, output, cache read, cache write. Estimates,
 * for the cost line under an answer. Haiku's are its published rates for
 * prompts of 100K tokens or fewer (each call of a lookup is; above that they
 * are five times as much), with the 5-minute cache write. Checked October 2026.
 */
const PRICES: Record<string, [number, number, number, number]> = {
  "claude-opus-5-5": [4, 20, 0.2, 5],
  "claude-sonnet-5-5": [2, 10, 0.2, 2.5],
  "claude-haiku-5-5": [0.1, 0.5, 0.01, 0.125],
};

const SYSTEM = `You are the Look up screen of 重复习, a Mandarin review app with one user: an English speaker at about HSK 5 who studies from their own sentences (Pleco, textbooks, Anki decks), most of which have English translations. They type what they want to say, in English, Chinese, pinyin or a mix, and you answer with what a Chinese speaker would say. It is a dictionary, not a chat: you compose the answer from blocks the app draws, and the blocks' shapes must carry the answer. The user should see it, not read an explanation of it.

Kinds of question:
- pairing: which word goes with another ("develop depression": 得了 / 患上 抑郁症, not 发展).
- meaning: a word with several meanings; which applies ("trauma": 创伤 of the mind vs 外伤 of the body).
- synonyms: near-synonyms told apart by meaning or grammar (以为 means you were wrong; 帮忙 takes no object).
- tone: connotation or register (后果 is always bad; 结果 is neutral).
- pattern: a sentence pattern with slots (越…越…).
- expression: a whole-sentence equivalent ("I'm not in the mood": 没心情).
- reading: what something means in context (你真行).
- breakdown: how a word is built, why these characters, a way to remember it ("不着痕迹 character breakdown", "畅销 why these characters", "及格 mnemonic"). The English is the request, not something to translate.

Which part is the question. Split the query into parts and mark which are asked. In a pair, the noun (base) translates on its own and the verb or adjective (collocate) depends on it, so the collocate is usually the question. A part the user wrote in Chinese is known, not asked. A part that fans out to many words is more likely asked than one that is nearly always the same word. If the dictionary tool shows a strong deck card for a word, the user knows it.

Evidence. Gather it before answering, with the tools:
- english_candidates for an English part: dictionary headwords, with how often each is in the user's sentences.
- dictionary for Chinese words: entries, whether the user has it in their deck (and how strong), and how often it is in their sentences.
- neighbours and together: which words come before or after a word in the user's sentences, and how often two words appear together. Use them for pairing, and to find the family a word belongs to (the illnesses that come after 得).
- search_sentences to find the user's sentences by their English translation or by Chinese words; the English side often finds the Chinese the user wants.
Pair counts mislead on their own: 有 is common before 抑郁症 but means having it, not getting it; a pair can be split (帮了我一个忙); a small corpus has few examples. Weigh them with meaning and grammar.

The blocks. Use the ones the question needs, usually two to four, one of them a headline:
- gap (headline for pairing): frame is the Chinese phrase with ___ for the asked part ("他去年___抑郁症。"); options are every candidate, fitting ones with a label of at most five words ("spoken, everyday"), near misses with fits false. why is one short sentence.
- sense (headline for which meaning; or the entries behind a gap): the words that fit, numbered. label is when it's the one ("the mind; lasting harm"), why one sentence; points are judgments on it with their source; examples are ids of the user's sentences the tools returned.
- contrast (headline for near-synonyms): two or three words, and rows that compare them on the same aspect ("means", "turned out true?", "sounds", "takes an object?"). Keep cells to a few words; mark a cell yes or no where the row is a yes/no question.
- scale (headline for tone or register): words placed along one line, at from 0 (left) to 1 (right), with left, middle and right naming the ends ("good", "neutral", "bad" or "casual", "", "formal"). gloss is a few words of meaning.
- pattern (headline for patterns): template with slots in braces ("越{A}越{B}"), what each slot takes, and fillings: a sentence id from the tools (or -1 for one you write), its text and translation, and the words that fill the slots (marks).
- family: the rule behind the answer, so it carries to other cases: head ("得"), rule ("+ an illness"), and members from the user's sentences ("得感冒", "得了癌症") with their counts as the tools returned them (-1 when you have none). Include it whenever the answer follows a rule the user can reuse.
- wrong-right: the mistake an English speaker would make, beside the fix, both in Chinese, and why in one short sentence. One per likely mistake; any word you warn against belongs here or among a gap's near misses. Warn only against what is really wrong, not what is merely less explicit: search_sentences for the wrong phrase first, and if the user's sentences use it, it is not a mistake (哪个站 is everyday Chinese). The app tests every warning against their sentences and shows the ones they contradict as in doubt.
- example: one sentence, by id from the tools, or id -1 for one you write (it is labelled as yours).
- parts (headline for breakdown): the word, and each of its characters in order with what it means in this word, a few words ("着: to touch, to reach"); then literal, the characters' sense put together and how it comes to mean what the word means ("not touching any mark or trace, so: seamlessly"). Never pinyin: the app reads each character as the word reads it. Follow it with a sense block for the word itself when its meaning needs saying.

Rules:
- Never write pinyin; the app adds it from its own dictionary.
- A judgment with source "corpus" gives a count exactly as a tool returned it for that word or pair; otherwise count -1. "dictionary" is only for what the dictionary tool showed, "deck" only for what it showed about the deck, "model" for your own knowledge.
- Put each judgment under what it is about: frequency is how common, pairing is what it goes with; what the deck shows is its own judgment with source "deck".
- No block explains the answer in a sentence; let the blocks show it. summary is at most two sentences of anything the blocks don't show, and says so if the user's sentences had nothing.
- Evidence for the question's own words may come with it, in <evidence_already_gathered> (the same as those tools return, already counted): use it, and don't fetch it again.
- Each step costs the user a wait. When you need more evidence, ask for all of it at once, several tool calls in one turn, rather than one at a time.
- When you have the evidence, hand in the answer by calling the answer tool, once, following its schema exactly. Write nothing else.`;

const POINT = {
  type: "object",
  additionalProperties: false,
  required: ["point", "says", "source", "count"],
  properties: {
    point: { type: "string", enum: ["meaning", "pairing", "grammar", "register", "tone", "frequency"] },
    says: { type: "string" },
    source: { type: "string", enum: ["corpus", "dictionary", "deck", "model"] },
    count: { type: "integer" },
  },
} as const;

/** An object of these string, integer, boolean or array properties, every one required, nothing else allowed. */
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const str = { type: "string" } as const;
const int = { type: "integer" } as const;
const list = (items: unknown) => ({ type: "array", items });

/**
 * The answer: how the query was read, the blocks it is composed of, and a
 * sentence or two more. The answer tool's input, not an enforced output
 * format: enforced, eight kinds of block compile to a grammar the API refuses
 * as too large. normaliseAnswer makes up for it.
 */
const ANSWER_SCHEMA = obj({
  reading: obj({
    parts: list(obj({ text: str, asked: { type: "boolean" } })),
    kind: { type: "string", enum: ["pairing", "meaning", "synonyms", "tone", "pattern", "expression", "reading", "breakdown"] },
    note: str,
  }),
  blocks: list({
    anyOf: [
      obj({ type: { const: "gap" }, frame: str, options: list(obj({ zh: str, label: str, fits: { type: "boolean" }, why: str })) }),
      obj({ type: { const: "sense" }, items: list(obj({ zh: str, label: str, why: str, points: list(POINT), examples: list(int) })) }),
      obj({
        type: { const: "contrast" },
        words: list(str),
        rows: list(obj({ aspect: str, cells: list(obj({ text: str, mark: { type: "string", enum: ["yes", "no", "none"] } })) })),
      }),
      obj({ type: { const: "scale" }, left: str, middle: str, right: str, points: list(obj({ zh: str, gloss: str, at: { type: "number" } })) }),
      obj({
        type: { const: "pattern" },
        template: str,
        slots: list(obj({ name: str, note: str })),
        fillings: list(obj({ id: int, zh: str, en: str, marks: list(str) })),
      }),
      obj({ type: { const: "family" }, head: str, rule: str, members: list(obj({ zh: str, count: int })) }),
      obj({ type: { const: "wrong-right" }, wrong: str, right: str, why: str }),
      obj({ type: { const: "example" }, id: int, zh: str, en: str }),
      obj({ type: { const: "parts" }, word: str, chars: list(obj({ zh: str, gloss: str })), literal: str }),
    ],
  }),
  summary: str,
});

/** The evidence, as tools for this lookup. Each records what it returned in `seen`. */
/** When each tool ran, [start, end] in ms: several run at once, so their time is the union. */
type Spans = Array<[number, number]>;
const spanTotal = (spans: Spans) => {
  let total = 0;
  let reach = -Infinity;
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) {
    if (b <= reach) continue;
    total += b - Math.max(a, reach);
    reach = b;
  }
  return total;
};

function tools(sql: Sql, owner: string, seen: Seen, spans: Spans = []) {
  const timed =
    <A,>(f: (a: A) => Promise<unknown>) =>
    async (a: A) => {
      const t = performance.now();
      try {
        return JSON.stringify(await f(a));
      } finally {
        spans.push([t, performance.now()]);
      }
    };
  return [
    betaTool({
      name: "answer",
      description: "Hand in the finished answer, once, after gathering the evidence. Nothing comes back: the answer is drawn for the user.",
      // Cast: inferring a type from the whole schema is slow and unused.
      inputSchema: ANSWER_SCHEMA as unknown as { type: "object" },
      run: () => "Kept.",
    }),
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
      run: timed(({ english }: { english: string }) => englishCandidates(sql, owner, seen, { english })),
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
      run: timed(({ words }: { words: string[] }) => dictionary(sql, owner, seen, { words })),
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
      run: timed(({ word, side, window }: { word: string; side: "before" | "after"; window?: number }) =>
        neighbours(sql, owner, seen, { word, side, window }),
      ),
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
      run: timed(({ first, second, window }: { first: string; second: string; window?: number }) =>
        together(sql, owner, seen, { first, second, window }),
      ),
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
      run: timed(({ english, chinese, limit }: { english?: string; chinese?: string[]; limit?: number }) =>
        searchSentences(sql, owner, seen, { english, chinese, limit }),
      ),
    }),
  ];
}

/** Words of an English question that say nothing to look up. */
const STOP = new Set(
  "a an the to of in on at for from with by into onto about as is are be been was were i you he she it we they me my your his her its our their this that these those what which who how do does did say said and or but not no so".split(
    " ",
  ),
);

/** English that asks about the Chinese in the question rather than being something to say. */
const ASKING = new Set(
  "character characters breakdown break down parse parsing mnemonic remember memorise memorize etymology radical radicals component components origin why explain explanation literally literal meaning means mean use usage".split(
    " ",
  ),
);

/**
 * The evidence nearly every lookup asks for first, fetched before the model
 * is called, all at once: dictionary candidates for each English word (and
 * the phrase), the dictionary for each Chinese word, and the owner's
 * sentences whose translation has the English. It goes in with the question,
 * so the model starts a step ahead: each step it saves is a whole model call.
 * Recorded in `seen` like any tool's, so the check stands behind it.
 */
async function evidenceUpFront(sql: Sql, owner: string, seen: Seen, query: string) {
  const chinese = [...new Set(query.match(/[\u3400-\u9fff]+/g) ?? [])].slice(0, 6);
  const english = query.replace(/[\u3400-\u9fff]+/g, " ").toLowerCase().replace(/[^a-z' -]+/g, " ").replace(/\s+/g, " ").trim();
  // "不着痕迹 character breakdown": the English asks about the Chinese, so
  // its words aren't looked up (they once had "character" read as 人物);
  // the word's characters are, beside the word.
  const asking = chinese.length > 0 && english.split(" ").some((w) => ASKING.has(w));
  if (asking) {
    const words = [...new Set([...chinese, ...chinese.flatMap((c) => (c.length > 1 && c.length <= 6 ? [...c] : []))])].slice(0, 12);
    return { dictionary: await dictionary(sql, owner, seen, { words }) };
  }
  const content = [...new Set(english.split(" ").filter((w) => w.length > 1 && !STOP.has(w)))].slice(0, 3);
  const phrases = content.length > 1 && english.split(" ").length <= 5 ? [english, ...content] : content;
  const [candidates, dict, sentences] = await Promise.all([
    Promise.all(phrases.map(async (e) => ({ english: e, candidates: (await englishCandidates(sql, owner, seen, { english: e })).slice(0, 15) }))),
    chinese.length ? dictionary(sql, owner, seen, { words: chinese }) : Promise.resolve([]),
    content.length ? searchSentences(sql, owner, seen, { english: content.join(" "), limit: 8 }) : Promise.resolve(null),
  ]);
  const found: Record<string, unknown> = {};
  if (candidates.length) found.english_candidates = candidates;
  if (dict.length) found.dictionary = dict;
  if (sentences) found.search_sentences = { english: content.join(" "), ...sentences };
  return Object.keys(found).length ? found : null;
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
async function sentencesById(sql: Sql, owner: string, ids: number[]): Promise<Map<number, LookupSentence & { words: string[] }>> {
  if (!ids.length) return new Map();
  const rows = (await sql`
    select s.id::int as id, s.zh, s.en, s.blockers,
           coalesce((select array_agg(t.word order by t.pos) from chongfuxi_token t
                     where t.owner_email = s.owner_email and t.sentence_id = s.id), '{}') as words
    from chongfuxi_sentence s
    where s.owner_email = ${owner} and s.id = any(${ids}::bigint[])
  `) as unknown as Array<{ id: number; zh: string; en: string | null; blockers: string[]; words: string[] }>;
  return new Map(rows.map((r) => [r.id, { id: r.id, zh: r.zh, en: r.en, readable: r.blockers.length === 0, words: r.words }]));
}

/** Answer a query: the kept answer, unless `fresh`; otherwise ask the model, check, keep. */
export async function lookUpPhrase(sql: Sql, owner: string, query: string, fresh = false): Promise<LookupAnswer> {
  const q = normalise(query);
  if (!q) throw new LookupError("What do you want to say?");
  await ensure(sql);
  if (!fresh) {
    const kept = (await sql`select answer from chongfuxi_lookup where owner_email = ${owner} and query = ${q}`) as unknown as Array<{
      answer: LookupAnswer | LookupAnswerV1;
    }>;
    // Kept before blocks: drawn as blocks all the same.
    if (kept[0]) {
      const answer = "blocks" in kept[0].answer ? kept[0].answer : fromV1(kept[0].answer);
      return withDeck(sql, owner, await withParts(sql, owner, await withUsage(sql, owner, answer)));
    }
  }
  const apiKey = process.env.CHONGFUXI_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new LookupError("No Anthropic API key is set (CHONGFUXI_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY).");

  const client = new Anthropic({ apiKey });
  const seen = newSeen();
  const started = performance.now();
  const ahead = await evidenceUpFront(sql, owner, seen, query.trim());
  const aheadMs = performance.now() - started;
  const spans: Spans = [];
  const runner = client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    max_iterations: 12,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    output_config: { effort: EFFORT },
    tools: tools(sql, owner, seen, spans),
    messages: [
      {
        role: "user",
        content: ahead
          ? `${query.trim()}\n\n<evidence_already_gathered>\n${JSON.stringify(ahead)}\n</evidence_already_gathered>`
          : query.trim(),
      },
    ],
    ...(WITH_FALLBACK.has(MODEL) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  });

  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 };
  let handedIn: unknown = undefined;
  let last: Anthropic.Beta.BetaMessage | null = null;
  for await (const message of runner) {
    usage.calls++;
    usage.input += message.usage.input_tokens;
    usage.output += message.usage.output_tokens;
    usage.cacheRead += message.usage.cache_read_input_tokens ?? 0;
    usage.cacheWrite += message.usage.cache_creation_input_tokens ?? 0;
    last = message;
    const call = message.content.find((c) => c.type === "tool_use" && c.name === "answer");
    // Handed in: stop here rather than send "Kept." back for another call.
    if (call && call.type === "tool_use") {
      handedIn = call.input;
      break;
    }
  }
  if (!last) throw new LookupError("The model didn't answer.");
  if (handedIn === undefined) {
    if (last.stop_reason === "refusal") throw new LookupError("The model declined this one.");
    if (last.stop_reason === "max_tokens") throw new LookupError("The answer ran out of room; try a shorter question.");
    if (last.stop_reason === "tool_use") throw new LookupError("The lookup took too many steps; try again.");
    // Answered in text instead of through the tool: take it if it's the answer.
    const text = last.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("");
    try {
      handedIn = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    } catch {
      throw new LookupError("The answer came back malformed.");
    }
  }
  const modelDone = performance.now();
  const raw: ModelAnswer = normaliseAnswer(handedIn);
  if (!raw.blocks.length) throw new LookupError("The answer came back empty; try again.");

  const cited = citedIds(raw).filter((id) => seen.sentences.has(id));
  const checked = checkAnswer(raw, seen, { entry: (w) => dictEntry(w), sentences: await sentencesById(sql, owner, cited) });
  const answer: LookupAnswer = {
    ...checked,
    query: q,
    model: last.model,
    at: Date.now(),
    usage: { input: usage.input + usage.cacheRead + usage.cacheWrite, output: usage.output, calls: usage.calls },
  };
  const price = PRICES[MODEL];
  if (price) {
    const dollars = (usage.input * price[0] + usage.output * price[1] + usage.cacheRead * price[2] + usage.cacheWrite * price[3]) / 1e6;
    answer.checks.push(`About $${dollars.toFixed(3)} (${usage.calls} model calls, ${MODEL}).`);
  }
  // Where the time went, to see what to speed up next: the model's share is
  // the loop's time less the tools' (which overlap, so counted once).
  const s = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  const toolMs = spanTotal(spans);
  const timing = {
    total: performance.now() - started,
    ahead: aheadMs,
    model: modelDone - started - aheadMs - toolMs,
    tools: toolMs,
    check: performance.now() - modelDone,
  };
  answer.checks.push(
    `Took ${s(timing.total)}: evidence up front ${s(timing.ahead)}, ${usage.calls} model calls ${s(timing.model)}, tools ${s(timing.tools)}, check ${s(timing.check)}.`,
  );
  console.log("lookup timing", JSON.stringify({ query: q, calls: usage.calls, ...Object.fromEntries(Object.entries(timing).map(([k, v]) => [k, Math.round(v)])) }));
  await sql`
    insert into chongfuxi_lookup (owner_email, query, model, kind, answer)
    values (${owner}, ${q}, ${answer.model}, ${answer.reading.kind}, ${JSON.stringify(answer)}::jsonb)
    on conflict (owner_email, query) do update
      set at = now(), model = excluded.model, kind = excluded.kind, answer = excluded.answer, verdict = null, note = null
  `;
  return withDeck(sql, owner, await withParts(sql, owner, await withUsage(sql, owner, answer)));
}

/**
 * For a word taken apart, the owner's deck words that share each character
 * (着 in 着急, 睡着): what to hang it on. Looked up each time the answer is
 * shown, like the deck marks, since the deck moves.
 */
async function withParts(sql: Sql, owner: string, answer: LookupAnswer): Promise<LookupAnswer> {
  if (!answer.blocks.some((b) => b.type === "parts")) return answer;
  const blocks = await Promise.all(
    answer.blocks.map(async (b) => {
      if (b.type !== "parts") return b;
      const chars = [...new Set(b.chars.map((c) => c.zh))];
      const rows = (await sql`
        select c.ch, w.word
        from unnest(${chars}::text[]) c(ch)
        cross join lateral (
          select w.word from chongfuxi_word w
          where w.owner_email = ${owner} and w.status = 'deck' and w.word <> ${b.word} and strpos(w.word, c.ch) > 0
          order by char_length(w.word), w.word
          limit 3
        ) w
      `) as unknown as Array<{ ch: string; word: string }>;
      return { ...b, chars: b.chars.map((c) => ({ ...c, also: rows.filter((r) => r.ch === c.zh).map((r) => r.word) })) };
    }),
  );
  return { ...answer, blocks };
}

/**
 * Each warning tested against the owner's sentences: when the "wrong" part
 * is in them, the model's rule is in doubt (哪个站 is everyday Chinese,
 * whatever Haiku said), and the block shows those sentences instead of a
 * strike. A database search, no model call; done each time the answer is
 * shown, so kept answers get it too.
 */
async function withUsage(sql: Sql, owner: string, answer: LookupAnswer): Promise<LookupAnswer> {
  const checks = answer.checks.filter((c) => !c.startsWith("Warned against "));
  const blocks = await Promise.all(
    answer.blocks.map(async (b) => {
      if (b.type !== "wrong-right") return b;
      const { used: _, ...plain } = b;
      const key = mistakeKey(b.wrong, b.right);
      if (!key) return plain;
      const rows = (await sql`
        select id::int as id, zh, en, blockers, count(*) over ()::int as total
        from chongfuxi_sentence
        where owner_email = ${owner} and strpos(zh, ${key}) > 0
        order by cardinality(blockers) = 0 desc, length(zh)
        limit 2
      `) as unknown as Array<{ id: number; zh: string; en: string | null; blockers: string[]; total: number }>;
      if (!rows.length) return plain;
      checks.push(`Warned against ${key}, which is in ${rows[0].total} of your sentences: shown as in doubt.`);
      return {
        ...plain,
        used: { key, count: rows[0].total, examples: rows.map((r) => ({ id: r.id, zh: r.zh, en: r.en, readable: r.blockers.length === 0 })) },
      };
    }),
  );
  return { ...answer, blocks, checks };
}

/** A word's Read card, as the Words wall shades it: not answered here yet, under three weeks, under six months, beyond. */
const stageOf = (answered: number, stability: number): LookupDeck["stage"] =>
  answered === 0 ? "new" : stability < 21 ? "young" : stability < 180 ? "mature" : "strong";

/** Each word's place in the deck as it stands now: the kept answer doesn't keep it, since the deck moves. */
async function withDeck(sql: Sql, owner: string, answer: LookupAnswer): Promise<LookupAnswer> {
  const words = Object.keys(answer.words);
  const rows = words.length
    ? ((await sql`
        select w.word, w.status, c.answered, c.stability
        from chongfuxi_word w
        left join chongfuxi_card c on c.owner_email = w.owner_email and c.kind = 'read' and c.meaning_id is null and c.word = w.word
        where w.owner_email = ${owner} and w.word = any(${words}::text[])
      `) as unknown as Array<{ word: string; status: "deck" | "listed" | "name"; answered: number | null; stability: number | null }>)
    : [];
  const of = new Map(rows.map((r) => [r.word, r]));
  return {
    ...answer,
    words: Object.fromEntries(
      Object.entries(answer.words).map(([w, info]) => {
        const r = of.get(w);
        const deck: LookupDeck = r
          ? { status: r.status, stage: r.status === "deck" && r.answered !== null ? stageOf(r.answered, r.stability ?? 0) : null }
          : { status: null, stage: null };
        return [w, { ...info, deck }];
      }),
    ),
  };
}

/** Put a word from an answer in the deck: one addition, source "lookup:<question>", to keep or undo like any other. */
export async function addFromLookup(sql: Sql, owner: string, query: string, word: string) {
  if (!/^[\u3400-\u9fff]{1,8}$/.test(word)) throw new LookupError("Only a Chinese word can go in the deck.");
  if (!dictEntry(word)) throw new LookupError(`${word} isn't a dictionary word, so it has no definition to put on a card.`);
  return addWords(sql, owner, `lookup:${normalise(query)}`, [word], loadDict());
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
