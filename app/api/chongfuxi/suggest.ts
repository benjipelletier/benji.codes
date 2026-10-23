// Look up's type-ahead: words of the owner's corpus (in the deck, or on a
// list) matching what is typed, as a dictionary would show them. Characters
// match anywhere in a word, pinyin by its letters from the start (tones and
// spaces ignored: "faju", "fa jue"), English anywhere in its definitions.
// No model: the AI is asked only when what is typed is more than a word.
//
// English is fuzzy (the owner's ask: "smart and fuzzy, unlike a normal
// dictionary"; lib/fuzzy.ts): each content word ("my flight got delayed" →
// flight, delay) finds the words with an English key holding it, in any of
// its forms and forgiving a typo (dleay), then their meaning neighbours (delay
// → 延误, whose "hold up" brings 耽误). Words matching more of what was typed
// come first, and words that sit together in the owner's sentences saying it
// get a lift (航班 and 延误, from 我的航班延误了). Those sentences are listed
// too, the words for what was typed marked in them.

import type { Sql } from "./db";
import type { SentenceSuggestion, WordSuggestion } from "@chongfuxi/lib/api";
import { zhShown } from "@chongfuxi/lib/hanzi";
import type { Definition } from "@chongfuxi/lib/dict";
import { buildIndex, fuzzyWords, stem, stemsFor, type KeyIndex } from "@chongfuxi/lib/fuzzy";
import { promptSenses, shownPinyin } from "./review";
import { glossKeys, glossStamp } from "./synonyms";

const SUGGEST_MAX = 12;
/** The owner's sentences listed for a situation. */
const SENTENCES_MAX = 6;
/** Content words of a situation taken, at most. */
const TERMS_MAX = 5;
/** English words that say nothing about the situation. */
const STOP = new Set(
  "a an the and or but to of in on at for with from by as is are was were be been being am i me my we our you your he she it its they them their this that these those have has had do does did not no so too very just got get gets getting how what when where why who which can could would should will shall may might must about into out up down over again then than there here some any all".split(" "),
);

/** The content words of English typed, each cut to its stem ("delayed" → delay). */
export function termsOf(english: string): string[] {
  const out: string[] = [];
  for (const w of english.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (STOP.has(w) || w.length < 3) continue;
    const s = stem(w);
    if (!out.includes(s)) out.push(s);
  }
  return out.slice(0, TERMS_MAX);
}

/** Words lifted for sitting together in a sentence that says what was typed. */
const TOGETHER_LIFT = 1.5;
/** Fuzzy words scored before the best are kept. */
const FUZZY_POOL = 30;

/** The owner's key index, kept per server while its stamp holds (rebuilt when words change). */
let kept: { owner: string; stamp: string; index: KeyIndex } | null = null;
async function keyIndex(sql: Sql, owner: string): Promise<KeyIndex | null> {
  const stamp = await glossStamp(sql, owner);
  if (!stamp) return null;
  if (kept && kept.owner === owner && kept.stamp === stamp) return kept.index;
  const got = await glossKeys(sql, owner);
  if (!got) return null;
  kept = { owner, stamp: got.stamp, index: buildIndex(got.rows) };
  return kept.index;
}
const HAN = /[㐀-鿿]/;

export async function suggestWords(sql: Sql, owner: string, typed: string): Promise<{ words: WordSuggestion[]; sentences: SentenceSuggestion[] }> {
  const q = typed.trim();
  if (!q || q.length > 40) return { words: [], sentences: [] };
  const han = HAN.test(q);
  const letters = q.toLowerCase().replace(/[\s\d@'’:-]/g, "");
  // Characters and pinyin: as a dictionary matches them.
  const exact = (await sql.query(
    `select w.word, w.pinyin, w.defs, w.status,
            ($2::boolean and strpos(w.word, $3) > 0) as by_han,
            lower(regexp_replace(coalesce(w.pinyin, w.defs->0->>'p', ''), '[0-9@ :]', '', 'g')) = $4 as whole_pinyin
     from chongfuxi_word w
     where w.owner_email = $1 and w.status in ('deck', 'listed')
       and (($2::boolean and strpos(w.word, $3) > 0)
         or ($4 <> '' and lower(regexp_replace(coalesce(w.pinyin, w.defs->0->>'p', ''), '[0-9@ :]', '', 'g')) like $4 || '%'))
     order by (w.word = $3) desc, (strpos(w.word, $3) = 1) desc,
              (lower(regexp_replace(coalesce(w.pinyin, w.defs->0->>'p', ''), '[0-9@ :]', '', 'g')) = $4) desc,
              (w.status = 'deck') desc, char_length(w.word), w.exposures desc, w.word
     limit ${SUGGEST_MAX}`,
    [owner, han, q, han ? "" : letters],
  )) as unknown as Array<Row & { by_han: boolean; whole_pinyin: boolean }>;
  if (han || q.length < 3) return { words: exact.map((r) => toSuggestion(r, r.by_han ? "chinese" : "pinyin")), sentences: [] };

  // English: fuzzy, through the words' English keys.
  const index = await keyIndex(sql, owner);
  const terms = termsOf(q);
  if (!index || !terms.length) return { words: exact.map((r) => toSuggestion(r, "pinyin")), sentences: [] };
  const hits = fuzzyWords(index, terms, FUZZY_POOL);
  const score = new Map(hits.map((h) => [h.word, h.score]));

  // The owner's sentences saying it: their English has the terms (any form, typos read as meant), or they hold a word
  // found for it; two signals at least, readable first. Each with the found words in it marked.
  const variants = [...new Set(terms.flatMap((t) => [t, ...stemsFor(index, t).map((x) => x.stem)]))];
  const found = (await sql.query(
    `with s as (
       select s.id::int as id, s.zh, s.en, cardinality(coalesce(s.blockers, '{}')) = 0 as readable,
              (select count(*) from unnest($2::text[]) t where lower(s.en) ~ ('\\m' || t))::int as said,
              (select array_agg(distinct t.word) from chongfuxi_token t
                where t.owner_email = s.owner_email and t.sentence_id = s.id and t.word = any($3::text[])) as marked
       from chongfuxi_sentence s
       where s.owner_email = $1 and s.en is not null
         and (lower(s.en) ~ ('\\m(' || array_to_string($2::text[], '|') || ')')
              or exists (select 1 from chongfuxi_token t where t.owner_email = s.owner_email and t.sentence_id = s.id and t.word = any($3::text[])))
     )
     select id, zh, en, readable, coalesce(marked, '{}') as marked
     from s
     where s.said + least(coalesce(cardinality(s.marked), 0), 1) >= 2 and s.said >= 1
     order by s.said + least(coalesce(cardinality(s.marked), 0), 2) desc, s.readable desc, char_length(s.zh), s.id
     limit ${SENTENCES_MAX}`,
    [owner, variants, hits.map((h) => h.word)],
  )) as unknown as Array<{ id: number; zh: string; en: string; readable: boolean; marked: string[] }>;
  // Words marked in those sentences sit together where the owner met them: lifted.
  for (const f of found) for (const w of f.marked) score.set(w, (score.get(w) ?? 0) + TOGETHER_LIFT / Math.max(1, found.indexOf(f) + 1));

  const best = [...score.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length).map(([w]) => w);
  const rows = best.length
    ? ((await sql`
        select word, pinyin, defs, status from chongfuxi_word
        where owner_email = ${owner} and status in ('deck', 'listed') and word = any(${best}::text[])
      `) as unknown as Row[])
    : [];
  const byWord = new Map(rows.map((r) => [r.word, r]));
  // A whole pinyin match first (hang → 航), then the fuzzy English, then other pinyin starts.
  const words: WordSuggestion[] = [];
  const seen = new Set<string>();
  const add = (r: Row | undefined, by: WordSuggestion["by"]) => {
    if (r && !seen.has(r.word) && words.length < SUGGEST_MAX) {
      seen.add(r.word);
      words.push(toSuggestion(r, by));
    }
  };
  for (const r of exact.filter((x) => x.whole_pinyin)) add(r, "pinyin");
  for (const w of best) add(byWord.get(w), "english");
  for (const r of exact) add(r, "pinyin");
  return { words, sentences: found.map((f) => ({ id: f.id, zh: zhShown(f.zh), en: f.en, readable: f.readable, marked: f.marked })) };
}

type Row = { word: string; pinyin: string | null; defs: Definition[]; status: "deck" | "listed" };

function toSuggestion(r: Row, by: WordSuggestion["by"]): WordSuggestion {
  return {
    word: r.word,
    pinyin: shownPinyin(r.pinyin, r.defs),
    gloss: promptSenses(r.defs, r.pinyin).slice(0, 2).join("; ") || null,
    inDeck: r.status === "deck",
    by,
  };
}
