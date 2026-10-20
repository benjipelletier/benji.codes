// Look up's type-ahead: words of the owner's corpus (in the deck, or on a
// list) matching what is typed, as a dictionary would show them. Characters
// match anywhere in a word, pinyin by its letters from the start (tones and
// spaces ignored: "faju", "fa jue"), English anywhere in its definitions.
// No model: the AI is asked only when what is typed is more than a word.

import type { Sql } from "./db";
import type { WordSuggestion } from "@chongfuxi/lib/api";
import type { Definition } from "@chongfuxi/lib/dict";
import { promptSenses, shownPinyin } from "./review";

const SUGGEST_MAX = 12;
const HAN = /[㐀-鿿]/;

export async function suggestWords(sql: Sql, owner: string, typed: string): Promise<WordSuggestion[]> {
  const q = typed.trim();
  if (!q || q.length > 40) return [];
  const han = HAN.test(q);
  const letters = q.toLowerCase().replace(/[\s\d@'’:-]/g, "");
  const english = !han && q.length >= 3 ? q.toLowerCase() : null;
  const rows = (await sql.query(
    `select word, pinyin, defs, status, exposures,
            ($2::boolean and strpos(word, $3) > 0) as by_han,
            ($4 <> '' and lower(regexp_replace(coalesce(pinyin, defs->0->>'p', ''), '[0-9@ :]', '', 'g')) like $4 || '%') as by_pinyin
     from chongfuxi_word
     where owner_email = $1 and status in ('deck', 'listed')
       and (
         ($2::boolean and strpos(word, $3) > 0)
         or ($4 <> '' and lower(regexp_replace(coalesce(pinyin, defs->0->>'p', ''), '[0-9@ :]', '', 'g')) like $4 || '%')
         or ($5::text is not null and defs::text ilike '%' || $5 || '%')
       )
     order by (word = $3) desc, (strpos(word, $3) = 1) desc,
              (lower(regexp_replace(coalesce(pinyin, defs->0->>'p', ''), '[0-9@ :]', '', 'g')) = $4) desc,
              (status = 'deck') desc, char_length(word), exposures desc, word
     limit ${SUGGEST_MAX}`,
    [owner, han, q, han ? "" : letters, english],
  )) as unknown as Array<{ word: string; pinyin: string | null; defs: Definition[]; status: "deck" | "listed"; by_han: boolean; by_pinyin: boolean }>;
  return rows.map((r) => ({
    word: r.word,
    pinyin: shownPinyin(r.pinyin, r.defs),
    gloss: promptSenses(r.defs, r.pinyin).slice(0, 2).join("; ") || null,
    inDeck: r.status === "deck",
    by: r.by_han ? "chinese" : r.by_pinyin ? "pinyin" : "english",
  }));
}
