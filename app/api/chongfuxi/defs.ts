// The order of a word's dictionary entries, where the word's own record can't
// choose between them (lib/senses.ts, `bestEntries`): 只 zhī has "grain that
// has begun to ripen" and "classifier for birds", both read zhī. The word's
// sentences choose: the entry their translations are about goes first among
// those, when the vote is clear. Everything that shows one meaning takes the
// first of the best, so this is the only place the order is decided.
//
// Run after definitions are written: words added (`addWords`, before they are
// stored), an import (`ingest`), and once for every word by
// scripts/order-defs.ts.

import type { Sql } from "./db";
import type { Definition } from "@chongfuxi/lib/dict";
import { bestEntries, votedEntry } from "@chongfuxi/lib/senses";

/** Translations read per word: plenty for a vote, few enough for 你's thousands. */
const TRANSLATIONS_PER_WORD = 200;

/**
 * For words whose best entries tie, their definitions with the one their
 * sentences are about first among those. Only the words that change.
 */
export async function voteOrder(
  sql: Sql,
  owner: string,
  items: Array<{ word: string; pinyin: string | null; defs: Definition[] }>,
): Promise<Map<string, Definition[]>> {
  const tied = items.map((it) => ({ it, best: bestEntries(it.defs, it.pinyin) })).filter((x) => x.best.length > 1);
  const out = new Map<string, Definition[]>();
  if (!tied.length) return out;
  const words = tied.map((x) => x.it.word);
  const said = (await sql`
    select x.word, x.en
    from (
      select t.word, s.en, row_number() over (partition by t.word order by s.id) as rn
      from (
        select distinct word, sentence_id from chongfuxi_token
        where owner_email = ${owner} and word = any(${words}::text[])
      ) t
      join chongfuxi_sentence s on s.owner_email = ${owner} and s.id = t.sentence_id
      where s.en is not null
    ) x
    where x.rn <= ${TRANSLATIONS_PER_WORD}
  `) as unknown as Array<{ word: string; en: string }>;
  for (const { it, best } of tied) {
    const won = votedEntry(
      best,
      said.filter((s) => s.word === it.word).map((s) => s.en),
    );
    if (!won || won === best[0]) continue;
    // Moved up to just before the entry that was first among the best; the rest as they were.
    const rest = it.defs.filter((d) => d !== won);
    rest.splice(rest.indexOf(best[0]), 0, won);
    out.set(it.word, rest);
  }
  return out;
}

/** Reorder stored definitions (these words, or every word with more than one entry). Returns the words changed. */
export async function orderStoredDefs(sql: Sql, owner: string, words: string[] | null = null, dryRun = false): Promise<string[]> {
  const rows = (
    words
      ? await sql`
          select word, pinyin, defs from chongfuxi_word
          where owner_email = ${owner} and word = any(${words}::text[]) and jsonb_array_length(defs) > 1
        `
      : await sql`
          select word, pinyin, defs from chongfuxi_word
          where owner_email = ${owner} and jsonb_array_length(defs) > 1
        `
  ) as unknown as Array<{ word: string; pinyin: string | null; defs: Definition[] }>;
  const changed = await voteOrder(sql, owner, rows);
  if (changed.size && !dryRun) {
    await sql`
      update chongfuxi_word w set defs = e.value->'d'
      from jsonb_array_elements(${JSON.stringify([...changed].map(([w, d]) => ({ w, d })))}::jsonb) e
      where w.owner_email = ${owner} and w.word = e.value->>'w'
    `;
  }
  return [...changed.keys()];
}
