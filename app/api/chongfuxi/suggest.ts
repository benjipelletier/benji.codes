// Look up's type-ahead: words of the owner's corpus (in the deck, or on a
// list) matching what is typed, as a dictionary would show them. Characters
// match anywhere in a word, pinyin by its letters from the start (tones and
// spaces ignored: "faju", "fa jue"), English anywhere in its definitions.
// No model: the AI is asked only when what is typed is more than a word.
//
// English of several words is a situation ("flight delayed", the owner's
// case: a word seen before that won't come back): each content word is
// matched on its own (a word's senses, at a word start, so "delayed" finds
// "to delay"), words matching more of them first, and the owner's sentences
// whose translation has them are listed too, with the Chinese words in them
// that mean what was typed marked (航班延误了: 航班 flight, 延误 delay).

import type { Sql } from "./db";
import type { SentenceSuggestion, WordSuggestion } from "@chongfuxi/lib/api";
import { zhShown } from "@chongfuxi/lib/hanzi";
import type { Definition } from "@chongfuxi/lib/dict";
import { promptSenses, shownPinyin } from "./review";

const SUGGEST_MAX = 12;
/** The owner's sentences listed for a situation. */
const SENTENCES_MAX = 6;
/** Content words of a situation taken, at most. */
const TERMS_MAX = 5;
/** English words that say nothing about the situation. */
const STOP = new Set(
  "a an the and or but to of in on at for with from by as is are was were be been being am i me my we our you your he she it its they them their this that these those have has had do does did not no so too very just got get gets getting how what when where why who which can could would should will shall may might must about into out up down over again then than there here some any all".split(" "),
);

/** The content words of English typed, each cut to a stem that matches its forms at a word start ("delayed" → delay). */
export function termsOf(english: string): string[] {
  const out: string[] = [];
  for (const w of english.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (STOP.has(w) || w.length < 3) continue;
    const stem = w.length > 5 && /(ed|ing)$/.test(w) ? w.replace(/(ed|ing)$/, "") : w.length > 4 && /ies$/.test(w) ? w.slice(0, -3) : w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w;
    if (!out.includes(stem)) out.push(stem);
  }
  return out.slice(0, TERMS_MAX);
}
const HAN = /[㐀-鿿]/;

export async function suggestWords(sql: Sql, owner: string, typed: string): Promise<{ words: WordSuggestion[]; sentences: SentenceSuggestion[] }> {
  const q = typed.trim();
  if (!q || q.length > 40) return { words: [], sentences: [] };
  const han = HAN.test(q);
  const letters = q.toLowerCase().replace(/[\s\d@'’:-]/g, "");
  const english = !han && q.length >= 3 ? q.toLowerCase() : null;
  // A situation: two or more content words, each matched on its own.
  const terms = english && /\s/.test(english) ? termsOf(english) : [];
  const situation = terms.length >= 2;
  const senses = `lower(array_to_string(w.glosses, ' | '))`;
  const hits = `(select count(*) from unnest($6::text[]) t where ${senses} ~ ('\\m' || t))::int`;
  const rows = (await sql.query(
    `select w.word, w.pinyin, w.defs, w.status, w.exposures,
            ($2::boolean and strpos(w.word, $3) > 0) as by_han,
            ($4 <> '' and lower(regexp_replace(coalesce(w.pinyin, w.defs->0->>'p', ''), '[0-9@ :]', '', 'g')) like $4 || '%') as by_pinyin,
            ${hits} as hits
     from chongfuxi_word w
     where w.owner_email = $1 and w.status in ('deck', 'listed')
       and (
         ($2::boolean and strpos(w.word, $3) > 0)
         or ($4 <> '' and lower(regexp_replace(coalesce(w.pinyin, w.defs->0->>'p', ''), '[0-9@ :]', '', 'g')) like $4 || '%')
         or ($5::text is not null and w.defs::text ilike '%' || $5 || '%')
         or (cardinality($6::text[]) > 0 and ${hits} > 0)
       )
     order by (w.word = $3) desc, (strpos(w.word, $3) = 1) desc,
              (lower(regexp_replace(coalesce(w.pinyin, w.defs->0->>'p', ''), '[0-9@ :]', '', 'g')) = $4) desc,
              ${hits} desc, (w.status = 'deck') desc, char_length(w.word), w.exposures desc, w.word
     limit ${SUGGEST_MAX}`,
    [owner, han, q, han ? "" : letters, situation ? null : english, situation ? terms : []],
  )) as unknown as Array<{ word: string; pinyin: string | null; defs: Definition[]; status: "deck" | "listed"; by_han: boolean; by_pinyin: boolean }>;
  const words: WordSuggestion[] = rows.map((r) => ({
    word: r.word,
    pinyin: shownPinyin(r.pinyin, r.defs),
    gloss: promptSenses(r.defs, r.pinyin).slice(0, 2).join("; ") || null,
    inDeck: r.status === "deck",
    by: r.by_han ? "chinese" : r.by_pinyin ? "pinyin" : "english",
  }));
  if (!situation) return { words, sentences: [] };

  // The owner's sentences whose translation has the most of the terms (two at least), readable first, shortest first;
  // with each the corpus words in it whose senses match a term.
  const found = (await sql.query(
    `with s as (
       select s.id::int as id, s.zh, s.en, cardinality(coalesce(s.blockers, '{}')) = 0 as readable,
              (select count(*) from unnest($2::text[]) t where lower(s.en) ~ ('\\m' || t))::int as hits
       from chongfuxi_sentence s
       where s.owner_email = $1 and s.en is not null
     )
     select s.id, s.zh, s.en, s.readable,
            coalesce((select array_agg(distinct t.word) from chongfuxi_token t
                      join chongfuxi_word w on w.owner_email = t.owner_email and w.word = t.word and w.status in ('deck', 'listed')
                      where t.owner_email = $1 and t.sentence_id = s.id
                        and exists (select 1 from unnest($2::text[]) x where lower(array_to_string(w.glosses, ' | ')) ~ ('\\m' || x))), '{}') as marked
     from s where s.hits >= 2
     order by s.hits desc, s.readable desc, char_length(s.zh), s.id
     limit ${SENTENCES_MAX}`,
    [owner, terms],
  )) as unknown as Array<{ id: number; zh: string; en: string; readable: boolean; marked: string[] }>;
  return { words, sentences: found.map((f) => ({ id: f.id, zh: zhShown(f.zh), en: f.en, readable: f.readable, marked: f.marked })) };
}
