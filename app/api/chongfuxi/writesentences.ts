// Sentences the model writes for a word, from its word page (the owner: "ai
// generate a sentence for this word, using words I already know at the time
// so it's unlocked"), for a word with none (扬眉吐气: Readable 0, One away 0,
// Locked 0). The model is given the word and the deck words the owner knows,
// strongest first; each sentence it writes is split as an imported sentence
// is and kept only if every word in it is known now and the word is one of
// them, so it lands readable. Kept as sentences of source "AI", through the
// same import as any deck's (ingestSentences): a sentence card, and the
// word's Read card can show it. Owner only (it costs money), at Look up's
// model and effort (never lower).

import Anthropic from "@anthropic-ai/sdk";
import type { Dict } from "@chongfuxi/lib/dict";
import { isHan } from "@chongfuxi/lib/hanzi";
import { segmentByDictionary } from "@chongfuxi/lib/segment";
import { makeUnlock } from "@chongfuxi/lib/unlock";
import { ingestSentences } from "./corpus";
import type { Sql } from "./db";
import { loadHeadwords } from "./headwords";
import { EFFORT, MODEL } from "./lookup";
import { wordStanding } from "./suspended";

export class WriteError extends Error {}

/** The source the written sentences are filed under, as a deck's are. */
export const AI_SOURCE = "AI";
/** Sentences asked for; at most this many are kept. */
const ASKED = 6;
const KEPT = 3;
/** The deck words the model may build with, strongest first. */
const KNOWN_SHOWN = 1500;
/** Words split as an imported sentence's are. */
const SPLIT_MAX = 4;

const SYSTEM = `You write example sentences for a learner of Mandarin. Given a target word and the list of words the learner knows, write short, natural, everyday sentences (6 to 18 characters) that each use the target word exactly as written, in a sense it really has, and show what it means. Use only words from the list, the target word, numbers, names in the list, and the commonest function words (的 了 吗 呢 吧 很 也 都 不 没 在 是 有 这 那 个 我 你 他 她 们). No other words: a sentence with a word outside the list is useless to the learner. Simplified characters, Chinese punctuation. Give each with a natural English translation. Make them differ from one another in situation and structure.`;

const SCHEMA = {
  type: "object",
  properties: {
    sentences: {
      type: "array",
      items: {
        type: "object",
        properties: { zh: { type: "string" }, en: { type: "string" } },
        required: ["zh", "en"],
        additionalProperties: false,
      },
    },
  },
  required: ["sentences"],
  additionalProperties: false,
} as const;

/** The model, asked for sentences: what it gave, parsed. */
type Ask = (content: string) => Promise<{ sentences?: unknown }>;

async function askModel(content: string): Promise<{ sentences?: unknown }> {
  const apiKey = process.env.CHONGFUXI_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new WriteError("No Anthropic API key is set (CHONGFUXI_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY).");
  const message = await new Anthropic({ apiKey }).messages.create({
    model: MODEL,
    max_tokens: 6000,
    system: SYSTEM,
    output_config: { effort: EFFORT, format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> } },
    messages: [{ role: "user", content }],
  });
  console.log("write sentences usage", JSON.stringify(message.usage));
  const text = message.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("");
  try {
    return JSON.parse(text);
  } catch {
    throw new WriteError(message.stop_reason === "refusal" ? "The model declined to write them." : "The sentences came back malformed.");
  }
}

export interface WrittenSentence {
  zh: string;
  en: string;
}

/**
 * Write up to KEPT sentences for a known word, each readable now, and add
 * them to the corpus. A first round that keeps none is tried once more, told
 * which words it used that the owner doesn't know.
 */
export async function writeSentences(sql: Sql, owner: string, dict: Dict, word: string, ask: Ask = askModel): Promise<{ kept: WrittenSentence[]; dropped: Array<WrittenSentence & { unknown: string[] }> }> {
  const standing = await wordStanding(sql, owner);
  const known = new Set(standing.filter((w) => w.known).map((w) => w.word));
  if (!known.has(word)) throw new WriteError(`${word} isn't a known word yet: a sentence with it would be locked. Add it to the deck first.`);
  // The words to build with: known deck words, the strongest first (those the owner is surest of).
  const strongest = (await sql`
    select w.word from chongfuxi_word w
    join chongfuxi_card c on c.owner_email = w.owner_email and c.word = w.word and c.kind = 'read' and c.meaning_id is null
    where w.owner_email = ${owner} and w.status = 'deck' and not c.suspended and w.word <> ${word}
    order by c.stability desc nulls last, w.word
    limit ${KNOWN_SHOWN}
  `) as unknown as Array<{ word: string }>;
  const vocabulary = strongest.map((r) => r.word).filter((w) => known.has(w));
  const [entry] = dict.lookup(word);
  const [row] = (await sql`select glosses from chongfuxi_word where owner_email = ${owner} and word = ${word}`) as unknown as Array<{ glosses: string[] | null }>;
  const meaning = row?.glosses?.slice(0, 3).join("; ") || entry?.senses.slice(0, 3).join("; ") || "";

  // Readable now: split as an import splits it, every word known (or made of known words).
  const universe = new Set(standing.map((w) => w.word));
  const unlock = makeUnlock(known, universe, loadHeadwords());
  const vocab = dict.headwords(SPLIT_MAX);
  for (const w of universe) if ([...w].length <= SPLIT_MAX) vocab.add(w);
  vocab.add(word);
  const context = { charReadings: dict.readings as Map<string, Set<string>>, vocab, maxLen: SPLIT_MAX };
  const had = (await sql`
    select key from chongfuxi_sentence where owner_email = ${owner} and strpos(zh, ${word}) > 0
  `) as unknown as Array<{ key: string }>;
  const existing = new Set(had.map((h) => h.key));

  const kept: WrittenSentence[] = [];
  const dropped: Array<WrittenSentence & { unknown: string[] }> = [];
  let feedback = "";
  for (let round = 0; round < 2 && !kept.length; round++) {
    const content = [
      `Target word: ${word}${meaning ? ` (${meaning})` : ""}`,
      `Write ${ASKED} sentences.`,
      feedback,
      "",
      `Words the learner knows (${vocabulary.length}):`,
      vocabulary.join(" "),
    ]
      .filter((x, i) => x || i === 3)
      .join("\n");
    const given = await ask(content);
    const sentences = (Array.isArray(given.sentences) ? given.sentences : []).flatMap((s): WrittenSentence[] =>
      s && typeof s.zh === "string" && typeof s.en === "string" ? [{ zh: s.zh.trim(), en: s.en.trim() }] : [],
    );
    for (const s of sentences) {
      const key = [...s.zh].filter(isHan).join("");
      if (!key || !s.zh.includes(word) || existing.has(key) || kept.length >= KEPT) continue;
      const words = segmentByDictionary(s.zh, context).words;
      // The word must stand as a word in it, not inside a longer one.
      if (!words.includes(word)) {
        dropped.push({ ...s, unknown: [] });
        continue;
      }
      const blockers = unlock.blockersOf(words);
      if (blockers.length) {
        dropped.push({ ...s, unknown: blockers });
        continue;
      }
      existing.add(key);
      kept.push(s);
    }
    const missing = [...new Set(dropped.flatMap((d) => d.unknown))];
    feedback = missing.length ? `The last ones used words the learner doesn't know: ${missing.join(" ")}. Don't use them.` : "";
    console.log("write sentences", JSON.stringify({ word, round, kept: kept.length, dropped: dropped.length }));
  }
  if (kept.length) await ingestSentences(sql, owner, kept.map((s) => ({ zh: s.zh, pinyin: "", en: s.en, source: AI_SOURCE })), dict);
  return { kept, dropped };
}
