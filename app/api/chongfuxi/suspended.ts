// Suspended words: a deck word too hard for now, out of review until brought
// back, its cards and their history kept (words.ts, suspendWord).

import type { Sql } from "./db";

/**
 * Whether the word row aliased `w` is suspended. Its main Read card being
 * suspended is the mark: the only other suspended cards are a merged
 * meaning's and a locked sentence's. The word stays 'deck', so no import,
 * list, sync or 龙库 link brings it back by itself.
 */
export const SUSPENDED_WORD = (w: string) =>
  `exists (select 1 from chongfuxi_card sw where sw.owner_email = ${w}.owner_email and sw.kind = 'read'
     and sw.word = ${w}.word and sw.meaning_id is null and sw.suspended)`;

/**
 * Every word row, and whether it counts as known for reading sentences: in
 * the deck or a marked name, and not suspended (a suspended word's sentences
 * lock until it comes back, at the owner's choice).
 */
export async function wordStanding(sql: Sql, owner: string): Promise<Array<{ word: string; status: string; known: boolean }>> {
  return (await sql.query(
    `select w.word, w.status, (w.status <> 'listed' and not ${SUSPENDED_WORD("w")}) as known
     from chongfuxi_word w where w.owner_email = $1`,
    [owner],
  )) as unknown as Array<{ word: string; status: string; known: boolean }>;
}

// Suspended sentences: a sentence card the owner took out of review by hand
// (the owner asked). The card is suspended; the mark is kept apart, since a
// sentence's card is also suspended while it is locked and woken when it
// unlocks (recomputeUnlocks), which must not wake one put away by hand.

let sentenceTable = false;
export async function ensureSuspendedSentences(sql: Sql) {
  if (sentenceTable) return;
  await sql`
    create table if not exists chongfuxi_sentence_suspended (
      owner_email text not null,
      sentence_id bigint not null,
      at timestamptz not null default now(),
      primary key (owner_email, sentence_id)
    )
  `;
  sentenceTable = true;
}

/** Take a sentence's card out of review, or bring it back (only dealt again while the sentence is readable). */
export async function suspendSentence(sql: Sql, owner: string, id: number, on: boolean): Promise<{ suspended: boolean }> {
  await ensureSuspendedSentences(sql);
  if (on) {
    await sql.transaction([
      sql`insert into chongfuxi_sentence_suspended (owner_email, sentence_id) values (${owner}, ${id}) on conflict do nothing`,
      sql`update chongfuxi_card set suspended = true where owner_email = ${owner} and kind = 'sentence' and sentence_id = ${id}`,
    ]);
  } else {
    await sql.transaction([
      sql`delete from chongfuxi_sentence_suspended where owner_email = ${owner} and sentence_id = ${id}`,
      sql`
        update chongfuxi_card c set suspended = false
        from chongfuxi_sentence s
        where c.owner_email = ${owner} and c.kind = 'sentence' and c.sentence_id = ${id}
          and s.owner_email = c.owner_email and s.id = c.sentence_id and cardinality(coalesce(s.blockers, '{}')) = 0
      `,
    ]);
  }
  return { suspended: on };
}

/**
 * Every sentence from one source (a deck, a text's name, a show) suspended
 * or brought back at once (the owner: "allow me to search through all
 * sentence categories and suspend them all if I want"). The same mark as
 * suspending one sentence from its card, so each can still be brought back
 * alone, and a sentence card asleep while marked; bringing a source back
 * wakes those of its sentences that are readable. A sentence that is also
 * in another source goes with it: the mark is the sentence's.
 */
export async function suspendSource(sql: Sql, owner: string, source: string, on: boolean): Promise<{ sentences: number }> {
  await ensureSuspendedSentences(sql);
  const ids = (
    (await sql`select id::int as id from chongfuxi_sentence where owner_email = ${owner} and ${source} = any(sources)`) as unknown as Array<{ id: number }>
  ).map((r) => r.id);
  if (!ids.length) return { sentences: 0 };
  if (on) {
    await sql.transaction([
      sql`
        insert into chongfuxi_sentence_suspended (owner_email, sentence_id)
        select ${owner}, unnest(${ids}::bigint[]) on conflict do nothing
      `,
      sql`update chongfuxi_card set suspended = true where owner_email = ${owner} and kind = 'sentence' and sentence_id = any(${ids}::bigint[])`,
    ]);
  } else {
    await sql.transaction([
      sql`delete from chongfuxi_sentence_suspended where owner_email = ${owner} and sentence_id = any(${ids}::bigint[])`,
      sql`
        update chongfuxi_card c set suspended = false
        from chongfuxi_sentence s
        where c.owner_email = ${owner} and c.kind = 'sentence' and c.sentence_id = any(${ids}::bigint[])
          and s.owner_email = c.owner_email and s.id = c.sentence_id and cardinality(coalesce(s.blockers, '{}')) = 0
      `,
    ]);
  }
  return { sentences: ids.length };
}

export class SourceError extends Error {}

/**
 * A source renamed on every sentence carrying it (the owner asked to rename
 * them from the Sources sheet). A name already in use merges the two: a
 * sentence in both keeps one. A deck imported again under its old name
 * brings the old name back onto its sentences, as any import tags them.
 */
export async function renameSource(sql: Sql, owner: string, from: string, to: string): Promise<{ sentences: number; merged: boolean }> {
  const name = to.replace(/\s+/g, " ").trim();
  if (!name || name.length > 80) throw new SourceError("A source's name is 1 to 80 characters.");
  if (name === from) return { sentences: 0, merged: false };
  const [{ n }] = (await sql`
    select count(*)::int as n from chongfuxi_sentence where owner_email = ${owner} and ${name} = any(sources)
  `) as unknown as Array<{ n: number }>;
  const rows = (await sql`
    update chongfuxi_sentence
    set sources = array(select distinct x from unnest(array_replace(sources, ${from}, ${name})) x order by x)
    where owner_email = ${owner} and ${from} = any(sources)
    returning id
  `) as unknown as Array<{ id: number }>;
  if (!rows.length) throw new SourceError(`No sentences come from ${from}.`);
  return { sentences: rows.length, merged: n > 0 };
}
