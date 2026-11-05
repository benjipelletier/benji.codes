// Suspended words: a deck word too hard for now, out of review until brought
// back, its cards and their history kept (words.ts, suspendWord).

import type { SourceAction } from "@chongfuxi/lib/api";
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
  // A source (or several) suspended at once: the sentences it newly suspended, so it can be undone exactly.
  await sql`
    create table if not exists chongfuxi_source_action (
      id bigserial primary key,
      owner_email text not null,
      at timestamptz not null default now(),
      sources text[] not null,
      sentence_ids bigint[] not null,
      undone_at timestamptz
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

/** Suspend-alls kept to undo, newest first, and for how long. */
const ACTIONS_SHOWN = 5;
const ACTION_DAYS = 30;

/** The sentence cards of these sentences woken, those readable (a locked one sleeps until it unlocks). */
async function wake(sql: Sql, owner: string, ids: number[]) {
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

/**
 * Every sentence from some sources (decks, texts' names, shows) suspended
 * at once, or brought back (the owner: "allow me to search through all
 * sentence categories and suspend them all if I want"). The same mark as
 * suspending one sentence from its card, so each can still be brought back
 * alone, and a sentence card asleep while marked. A sentence that is also in
 * another source goes with it: the mark is the sentence's. Suspending is
 * kept as one action with the sentences it newly suspended (not those
 * already suspended), so Undo (`undoSourceAction`) brings back exactly
 * those; Bring back wakes every sentence of the source, those readable.
 */
export async function suspendSources(sql: Sql, owner: string, sources: string[], on: boolean): Promise<{ sentences: number; action: number | null }> {
  await ensureSuspendedSentences(sql);
  const ids = (
    (await sql`
      select id::int as id from chongfuxi_sentence where owner_email = ${owner} and sources && ${sources}::text[]
    `) as unknown as Array<{ id: number }>
  ).map((r) => r.id);
  if (!ids.length) return { sentences: 0, action: null };
  if (!on) {
    await wake(sql, owner, ids);
    return { sentences: ids.length, action: null };
  }
  const already = new Set(
    (
      (await sql`
        select sentence_id::int as id from chongfuxi_sentence_suspended where owner_email = ${owner} and sentence_id = any(${ids}::bigint[])
      `) as unknown as Array<{ id: number }>
    ).map((r) => r.id),
  );
  const fresh = ids.filter((id) => !already.has(id));
  if (!fresh.length) return { sentences: 0, action: null };
  const [, , made] = (await sql.transaction([
    sql`
      insert into chongfuxi_sentence_suspended (owner_email, sentence_id)
      select ${owner}, unnest(${fresh}::bigint[]) on conflict do nothing
    `,
    sql`update chongfuxi_card set suspended = true where owner_email = ${owner} and kind = 'sentence' and sentence_id = any(${fresh}::bigint[])`,
    sql`
      insert into chongfuxi_source_action (owner_email, sources, sentence_ids)
      values (${owner}, ${sources}::text[], ${fresh}::bigint[]) returning id::int as id
    `,
  ])) as unknown as [unknown, unknown, Array<{ id: number }>];
  return { sentences: fresh.length, action: made[0]?.id ?? null };
}

/** A suspend-all undone: only the sentences it suspended are brought back (those readable woken). */
export async function undoSourceAction(sql: Sql, owner: string, id: number): Promise<{ sentences: number }> {
  await ensureSuspendedSentences(sql);
  const [a] = (await sql`
    select sentence_ids::int[] as ids, undone_at is not null as undone from chongfuxi_source_action where owner_email = ${owner} and id = ${id}
  `) as unknown as Array<{ ids: number[]; undone: boolean }>;
  if (!a) throw new SourceError("Nothing to undo there.");
  if (a.undone) throw new SourceError("Already undone.");
  await wake(sql, owner, a.ids);
  await sql`update chongfuxi_source_action set undone_at = now() where owner_email = ${owner} and id = ${id}`;
  return { sentences: a.ids.length };
}

/** The latest suspend-alls not undone, to undo from the Sources sheet. */
export async function recentSourceActions(sql: Sql, owner: string): Promise<SourceAction[]> {
  await ensureSuspendedSentences(sql);
  const rows = (await sql`
    select id::int as id, (extract(epoch from at) * 1000)::double precision as at, sources, cardinality(sentence_ids)::int as n
    from chongfuxi_source_action
    where owner_email = ${owner} and undone_at is null and at > now() - make_interval(days => ${ACTION_DAYS})
    order by at desc limit ${ACTIONS_SHOWN}
  `) as unknown as Array<{ id: number; at: number; sources: string[]; n: number }>;
  return rows.map((r) => ({ id: r.id, at: Math.round(r.at), sources: r.sources, sentences: r.n }));
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
