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
