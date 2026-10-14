// Bugs the owner files from the app (the bug button on every screen), kept so
// a Claude session can read them (scripts/bugs.ts) and fix them.
//
// Screenshots are stored as base64 JPEG beside the report. Readable by
// anyone, like the rest of the log; only the owner files them, and the owner
// or a holder of CHONGFUXI_BUGS_TOKEN (a Claude session) closes them.

import type { BugContext, BugReport, BugStatus } from "@chongfuxi/lib/api";
import type { Sql } from "./db";

let ready = false;

/** The table, made on first use so a deploy needs no migration first. Same as sql/001_init.sql. */
async function ensure(sql: Sql) {
  if (ready) return;
  await sql`
    create table if not exists chongfuxi_bug (
      id bigint generated always as identity primary key,
      owner_email text not null,
      at timestamptz not null default now(),
      text text not null,
      context jsonb not null default '{}',
      image text,
      image_type text,
      status text not null default 'open',
      note text,
      closed_at timestamptz
    )
  `;
  await sql`create index if not exists chongfuxi_bug_owner on chongfuxi_bug (owner_email, status, at desc)`;
  ready = true;
}

export const BUG_STATUSES: BugStatus[] = ["open", "fixed", "wontfix"];

/** Largest screenshot taken, decoded: well under a request's 4.5 MB. */
export const BUG_IMAGE_MAX = 3_000_000;

export async function fileBug(
  sql: Sql,
  owner: string,
  bug: { text: string; context: BugContext; image: { data: string; type: string } | null },
): Promise<number> {
  await ensure(sql);
  const rows = (await sql`
    insert into chongfuxi_bug (owner_email, text, context, image, image_type)
    values (${owner}, ${bug.text}, ${JSON.stringify(bug.context)}::jsonb, ${bug.image?.data ?? null}, ${bug.image?.type ?? null})
    returning id::int as id
  `) as unknown as Array<{ id: number }>;
  return rows[0].id;
}

type Row = {
  id: number;
  at: number;
  text: string;
  context: BugContext;
  has_image: boolean;
  status: BugStatus;
  note: string | null;
  closed_at: number | null;
};

const toReport = (r: Row): BugReport => ({
  id: r.id,
  at: Math.round(r.at),
  text: r.text,
  context: r.context,
  hasImage: r.has_image,
  status: r.status,
  note: r.note,
  closedAt: r.closed_at === null ? null : Math.round(r.closed_at),
});

/** Reports, newest first, without their screenshots: the open ones, or every one. */
export async function listBugs(sql: Sql, owner: string, all: boolean): Promise<BugReport[]> {
  await ensure(sql);
  const rows = (await sql`
    select id::int as id, (extract(epoch from at) * 1000)::double precision as at, text, context,
           image is not null as has_image, status, note,
           (extract(epoch from closed_at) * 1000)::double precision as closed_at
    from chongfuxi_bug
    where owner_email = ${owner} and (${all}::boolean or status = 'open')
    order by at desc
    limit 200
  `) as unknown as Row[];
  return rows.map(toReport);
}

export async function bugImage(sql: Sql, owner: string, id: number): Promise<{ bytes: Buffer; type: string } | null> {
  await ensure(sql);
  const rows = (await sql`
    select image, image_type from chongfuxi_bug where owner_email = ${owner} and id = ${id} and image is not null
  `) as unknown as Array<{ image: string; image_type: string | null }>;
  if (!rows.length) return null;
  return { bytes: Buffer.from(rows[0].image, "base64"), type: rows[0].image_type ?? "image/jpeg" };
}

/** Close a report (fixed, or won't fix) with a line on why, or open it again. */
export async function setBugStatus(sql: Sql, owner: string, id: number, status: BugStatus, note: string | null): Promise<boolean> {
  await ensure(sql);
  const rows = (await sql`
    update chongfuxi_bug
    set status = ${status}, note = coalesce(${note}, note),
        closed_at = case when ${status} = 'open' then null else coalesce(closed_at, now()) end
    where owner_email = ${owner} and id = ${id}
    returning id
  `) as unknown as unknown[];
  return rows.length > 0;
}
