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

let wholeReady = false;

/**
 * Words the owner marked as words of their own, never read from their parts
 * (lib/unlock.ts, `whole`): 式样 though he knows 式 and 样. The table is made
 * on first use.
 */
export async function ensureWholeTable(sql: Sql) {
  if (wholeReady) return;
  await sql`
    create table if not exists chongfuxi_whole_word (
      owner_email text not null,
      word text not null,
      at timestamptz not null default now(),
      primary key (owner_email, word)
    )
  `;
  wholeReady = true;
}

export async function wholeWords(sql: Sql, owner: string): Promise<Set<string>> {
  await ensureWholeTable(sql);
  const rows = (await sql`select word from chongfuxi_whole_word where owner_email = ${owner}`) as unknown as Array<{ word: string }>;
  return new Set(rows.map((r) => r.word));
}
