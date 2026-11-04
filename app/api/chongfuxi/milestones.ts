// Milestones: what new words unlocked (the owner: "whenever new words are
// added to my deck and they hit some sort of milestone… completing a list to
// 100% or improving an episode's comprehension up to 98%. I want that to be
// surfaced… what these new words have unlocked for me… start small"). Each
// is recorded once, when it is first reached, with the addition that
// reached it (an undone addition takes its milestones with it) and what it
// took. Two kinds so far:
//   list     a word list (an HSK level, a lesson, a song, a Muse list) all in the deck
//   episode  an episode's words READY_SHARE (98%) known, the share at which it can be watched
// Found after every addition (addWords, additions.ts) and, for episodes, when
// one is opened (words learnt for the show raise it too). Shown on Today until
// seen, and listed in the New words sheet. Owner only to read.

import type { Milestone } from "@chongfuxi/lib/api";
import { READY_SHARE } from "@chongfuxi/lib/review";
import type { Sql } from "./db";

/** A list this small isn't a milestone to finish. */
const LIST_MIN = 5;
/** Lists not studied from (Cards › Lists leaves them off too). */
const LISTS_HIDDEN = /npcr|成语/i;
/** Milestones listed, newest first. */
const SHOWN = 30;

let ready = false;
export async function ensureMilestones(sql: Sql) {
  if (ready) return;
  await sql`
    create table if not exists chongfuxi_milestone (
      id bigserial primary key,
      owner_email text not null,
      kind text not null,
      key text not null,
      at timestamptz not null default now(),
      addition_id bigint,
      title text not null,
      detail jsonb not null default '{}'::jsonb,
      seen_at timestamptz,
      unique (owner_email, kind, key)
    )
  `;
  ready = true;
}

type Row = { id: number; kind: Milestone["kind"]; key: string; at: number; title: string; detail: Milestone["detail"]; seen: boolean };
const COLUMNS = `id::int as id, kind, key, (extract(epoch from at) * 1000)::double precision as at, title, detail, seen_at is not null as seen`;
const fromRow = (r: Row): Milestone => ({ id: r.id, kind: r.kind, key: r.key, at: Math.round(r.at), title: r.title, detail: r.detail, seen: r.seen });

/** Keep a milestone the first time it is reached; none if it was reached before. */
export async function recordMilestone(
  sql: Sql,
  owner: string,
  m: { kind: Milestone["kind"]; key: string; title: string; detail: Milestone["detail"]; additionId: number | null },
): Promise<Milestone | null> {
  await ensureMilestones(sql);
  const [row] = (await sql.query(
    `insert into chongfuxi_milestone (owner_email, kind, key, title, detail, addition_id)
     values ($1, $2, $3, $4, $5::jsonb, $6)
     on conflict (owner_email, kind, key) do nothing
     returning ${COLUMNS}`,
    [owner, m.kind, m.key, m.title, JSON.stringify(m.detail), m.additionId],
  )) as unknown as Row[];
  return row ? fromRow(row) : null;
}

/**
 * Lists the new words completed: every list they are filed under, and the
 * lists above it, now all in the deck (a word filed under two lessons counts
 * once in the book, as Cards › Lists counts). Only lists of LIST_MIN words or
 * more, and not the hidden ones.
 */
export async function listMilestones(sql: Sql, owner: string, words: string[], additionId: number | null): Promise<Milestone[]> {
  if (!words.length) return [];
  const rows = (await sql`
    select distinct unnest(lists) as list from chongfuxi_word where owner_email = ${owner} and word = any(${words}::text[]) and lists is not null
  `) as unknown as Array<{ list: string }>;
  const paths = new Set<string>();
  for (const { list } of rows) {
    const parts = list.split("/");
    for (let k = 1; k <= parts.length; k++) paths.add(parts.slice(0, k).join("/"));
  }
  const candidates = [...paths].filter((p) => !LISTS_HIDDEN.test(p));
  if (!candidates.length) return [];
  const counts = (await sql`
    select p.path, count(*)::int as total, count(*) filter (where w.status = 'deck')::int as deck,
           array_agg(w.word) filter (where w.word = any(${words}::text[])) as tipped
    from unnest(${candidates}::text[]) as p(path)
    join chongfuxi_word w on w.owner_email = ${owner} and w.status in ('deck', 'listed')
      and exists (select 1 from unnest(w.lists) l where l = p.path or l like p.path || '/%')
    group by p.path
  `) as unknown as Array<{ path: string; total: number; deck: number; tipped: string[] | null }>;
  const done: Milestone[] = [];
  // The deepest first, so a lesson comes before the book it finished.
  for (const c of counts.sort((a, b) => b.path.split("/").length - a.path.split("/").length)) {
    if (c.total < LIST_MIN || c.deck < c.total) continue;
    const name = c.path.split("/").pop()!;
    const m = await recordMilestone(sql, owner, {
      kind: "list",
      key: c.path,
      title: `${name} complete`,
      detail: { list: c.path, total: c.total, words: (c.tipped ?? []).slice(0, 12) },
      additionId,
    });
    if (m) done.push(m);
  }
  return done;
}

/** An episode that has just come to READY_SHARE known: from `before` (below it, or never measured) to `after`. */
export async function episodeMilestone(
  sql: Sql,
  owner: string,
  e: { id: number; show: string; episode: string; before: number | null; after: number; words: string[] },
  additionId: number | null,
): Promise<Milestone | null> {
  if (e.after < READY_SHARE || (e.before !== null && e.before >= READY_SHARE)) return null;
  return recordMilestone(sql, owner, {
    kind: "episode",
    key: String(e.id),
    title: `${e.show} ${e.episode} is ready to watch`,
    detail: { episode: e.id, show: e.show, name: e.episode, before: e.before, after: e.after, words: e.words.slice(0, 12) },
    additionId,
  });
}

/** The milestones, newest first, or those not yet seen. Owner only. */
export async function milestones(sql: Sql, owner: string, unseen = false): Promise<Milestone[]> {
  await ensureMilestones(sql);
  const rows = (await sql.query(
    `select ${COLUMNS} from chongfuxi_milestone where owner_email = $1 ${unseen ? "and seen_at is null" : ""} order by at desc, id desc limit $2`,
    [owner, SHOWN],
  )) as unknown as Row[];
  return rows.map(fromRow);
}

/** Mark them seen, so Today stops showing them. */
export async function seeMilestones(sql: Sql, owner: string, ids: number[]) {
  await ensureMilestones(sql);
  await sql`update chongfuxi_milestone set seen_at = now() where owner_email = ${owner} and id = any(${ids}::bigint[]) and seen_at is null`;
}

/** An addition undone takes the milestones it reached with it (they can be reached again). */
export async function dropMilestones(sql: Sql, owner: string, additionId: number) {
  await ensureMilestones(sql);
  const gone = (await sql`
    delete from chongfuxi_milestone where owner_email = ${owner} and addition_id = ${additionId} returning kind, key
  `) as unknown as Array<{ kind: string; key: string }>;
  // An episode it made ready reads as unmeasured, so adding the words back reaches it again.
  const episodes = gone.filter((g) => g.kind === "episode").map((g) => Number(g.key));
  if (episodes.length) await sql`update chongfuxi_episode set known = null where owner_email = ${owner} and id = any(${episodes}::bigint[])`;
}
