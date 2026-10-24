// The owner fixing how a sentence is split into words (乱 + 翻 read as one
// word, 乱翻, "rummage"): the decks' splits and the dictionary matching get
// some wrong, and a word cut in two can't be tapped as the one that tripped
// them. The new split replaces the sentence's tokens (import writes a
// sentence's tokens once and never again, so it stays); each edit is logged
// with the split before it, since tokens are otherwise a record of how the
// sentence was read. The sentence is then checked again: a joined word
// that isn't known locks it, as any unknown word does.

import type { SentenceInfo } from "@chongfuxi/lib/api";
import type { Sql } from "./db";
import { recomputeUnlocks } from "./corpus";
import { sentenceDresser } from "./review";

export class ResplitError extends Error {}

/** Characters a word may run to. */
const WORD_MAX = 12;

let ready = false;
async function ensureTable(sql: Sql) {
  if (ready) return;
  await sql`
    create table if not exists chongfuxi_split_edit (
      owner_email text not null,
      sentence_id bigint not null,
      at timestamptz not null default now(),
      before text[] not null,
      after text[] not null
    )
  `;
  ready = true;
}

/** Split a sentence anew: the same characters in the same order, cut differently. Owner only. */
export async function resplitSentence(
  sql: Sql,
  owner: string,
  id: number,
  given: unknown,
): Promise<{ sentence: SentenceInfo; blockers: string[] }> {
  await ensureTable(sql);
  const [row] = (await sql`
    select s.id::int as id, s.zh, s.en, s.sources,
           coalesce((select array_agg(t.word order by t.pos) from chongfuxi_token t where t.owner_email = s.owner_email and t.sentence_id = s.id), '{}') as words
    from chongfuxi_sentence s where s.owner_email = ${owner} and s.id = ${id}
  `) as unknown as Array<{ id: number; zh: string; en: string | null; sources: string[]; words: string[] }>;
  if (!row) throw new ResplitError("No such sentence.");
  const words = (Array.isArray(given) ? given : []).map((w) => (typeof w === "string" ? w : ""));
  if (!words.length || words.some((w) => !w || [...w].length > WORD_MAX)) throw new ResplitError(`Each word needs 1 to ${WORD_MAX} characters.`);
  if (words.join("") !== row.words.join("")) throw new ResplitError("The words must be the sentence's own characters, in order.");
  const same = words.length === row.words.length && words.every((w, i) => w === row.words[i]);
  if (!same) {
    await sql.transaction([
      sql`delete from chongfuxi_token where owner_email = ${owner} and sentence_id = ${id}`,
      sql`
        insert into chongfuxi_token (owner_email, sentence_id, pos, word)
        select ${owner}, ${id}, (t.ord - 1)::int, t.word from unnest(${words}::text[]) with ordinality as t(word, ord)
      `,
      sql`insert into chongfuxi_split_edit (owner_email, sentence_id, before, after) values (${owner}, ${id}, ${row.words}::text[], ${words}::text[])`,
    ]);
    await recomputeUnlocks(sql, owner);
  }
  const dress = await sentenceDresser(sql, owner, [id]);
  const [b] = (await sql`select blockers from chongfuxi_sentence where owner_email = ${owner} and id = ${id}`) as unknown as Array<{ blockers: string[] | null }>;
  return { sentence: dress(row)!, blockers: b?.blockers ?? [] };
}
