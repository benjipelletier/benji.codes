// A definition written by the model, for a word CC-CEDICT doesn't have and
// whose Pleco card brought none (扬眉吐气). Asked for from the word's card or
// sheet, by the owner only (it costs money), with the word's reading and a
// few of the owner's sentences that use it. Saved as the word's definition,
// marked `ai`, which the app shows as an AI tag beside the word; an import
// that brings no definition keeps it (corpus.ts).

import Anthropic from "@anthropic-ai/sdk";
import { glossesOf, type Definition } from "@chongfuxi/lib/dict";
import { toneless } from "@chongfuxi/lib/hanzi";
import type { Sql } from "./db";
import { loadDict } from "./dictfile";
import { EFFORT, MODEL } from "./lookup";

export class DefineError extends Error {}

/** Sentences of the owner's shown to the model, for the sense they use it in. */
const SENTENCES = 6;
const MAX_SENSES = 4;
const MAX_SENSE = 120;

const SYSTEM = `You write entries for a Chinese–English learner's dictionary in the style of CC-CEDICT. Given a Chinese word, give its meanings in English: one to four senses, each a few words, the commonest first ("to feel proud and elated", "to hold one's head high"). Begin a chengyu's first sense with "(idiom) ". Mark a sense with its register only where it matters ("(literary)", "(slang)"). No pinyin and no examples in the senses. Some of the user's own sentences that use the word may come with it: let them show which senses matter, but define the word, not the sentence. Give pinyin as numbered syllables separated by spaces ("yang2 mei2 tu3 qi4"). If you don't know the word, give no senses.`;

const SCHEMA = {
  type: "object",
  properties: {
    pinyin: { type: "string" },
    senses: { type: "array", items: { type: "string" } },
  },
  required: ["pinyin", "senses"],
  additionalProperties: false,
} as const;

/**
 * Numbered pinyin as the app writes it ("yang2@mei2@tu3@qi4"), when each
 * syllable is one the dictionary gives that character; null otherwise.
 */
function checkedPinyin(word: string, pinyin: string): string | null {
  const chars = [...word];
  const sounds = pinyin
    .trim()
    .toLowerCase()
    .replace(/ü/g, "u:")
    .split(/[\s@-]+/)
    .filter(Boolean);
  if (sounds.length !== chars.length || sounds.some((s) => !/^[a-z:]+[1-5]$/.test(s))) return null;
  const { readings } = loadDict();
  const fits = chars.every((ch, i) => {
    const known = readings.get(ch);
    return !known || known.has(toneless(sounds[i]));
  });
  return fits ? sounds.join("@") : null;
}

/** Write the word a definition and keep it. Refused for a word that has one. */
export async function defineWord(sql: Sql, owner: string, word: string): Promise<{ pinyin: string | null; defs: Definition[] }> {
  const [row] = (await sql`
    select pinyin, defs from chongfuxi_word where owner_email = ${owner} and word = ${word}
  `) as unknown as Array<{ pinyin: string | null; defs: Definition[] }>;
  if (!row) throw new DefineError("not a word in the corpus");
  if (row.defs.length) throw new DefineError(`${word} already has a definition`);

  const apiKey = process.env.CHONGFUXI_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new DefineError("No Anthropic API key is set (CHONGFUXI_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY).");

  const sentences = (await sql`
    select zh, en from chongfuxi_sentence
    where owner_email = ${owner} and strpos(zh, ${word}) > 0 and en is not null
    order by char_length(zh), id
    limit ${SENTENCES}
  `) as unknown as Array<{ zh: string; en: string }>;
  const reading = row.pinyin ? ` (read ${row.pinyin.replace(/@/g, " ")})` : "";
  const content = [
    `Define ${word}${reading}.`,
    ...(sentences.length ? ["", "The user's sentences with it:", ...sentences.map((s) => `- ${s.zh} — ${s.en}`)] : []),
  ].join("\n");

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    output_config: { effort: EFFORT, format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> } },
    messages: [{ role: "user", content }],
  });
  const text = message.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("");
  let given: { pinyin?: unknown; senses?: unknown };
  try {
    given = JSON.parse(text);
  } catch {
    throw new DefineError(message.stop_reason === "refusal" ? "The model declined to define it." : "The definition came back malformed.");
  }
  const senses = [
    ...new Set(
      (Array.isArray(given.senses) ? given.senses : [])
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.trim().replace(/\s+/g, " "))
        .filter((s) => s && s.length <= MAX_SENSE),
    ),
  ].slice(0, MAX_SENSES);
  if (!senses.length) throw new DefineError(`The model doesn't know ${word}.`);

  // Its own reading where it has one: the model's only fills a gap, and only when the dictionary agrees with each syllable.
  const pinyin = row.pinyin ?? (typeof given.pinyin === "string" ? checkedPinyin(word, given.pinyin) : null);
  const defs: Definition[] = [{ p: pinyin ?? "", senses, ai: true }];
  const [saved] = (await sql`
    update chongfuxi_word set defs = ${JSON.stringify(defs)}::jsonb, glosses = ${glossesOf(defs)}::text[],
           pinyin = coalesce(pinyin, ${pinyin})
    where owner_email = ${owner} and word = ${word} and jsonb_array_length(defs) = 0
    returning pinyin
  `) as unknown as Array<{ pinyin: string | null }>;
  if (!saved) throw new DefineError(`${word} already has a definition`);
  console.log("define", JSON.stringify({ word, senses, usage: message.usage }));
  return { pinyin: saved.pinyin, defs };
}
