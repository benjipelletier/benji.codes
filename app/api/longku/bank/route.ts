import { NextRequest, NextResponse } from "next/server";
import { getDb, hasDb } from "../db";
import { getViewer, NotOwnerError, requireOwner } from "@longku/lib/session";

export const dynamic = "force-dynamic";

/** The session row as the client keeps it. Written whole; never patched. */
interface SweepEnvelope {
  /** Words played this session, in the order they were produced. */
  played?: string[];
  /** Words this session set out to ask for. */
  session?: string[];
  /** When the session was planned, epoch ms, or null for none. */
  started?: number | null;
}

/**
 * The sweep is always written whole — it's small and never partially updated.
 *
 * The played order matters to the log, so it is stored here rather than
 * inferred from longku_bank.in_sweep, which can only say whether a word was
 * used and hands them back in the order they were added.
 */
async function saveSweep(
  sql: ReturnType<typeof getDb>,
  owner: string,
  env: SweepEnvelope,
): Promise<void> {
  const started = typeof env.started === "number" ? new Date(env.started) : null;
  // `chains` is deliberately absent: nothing writes a linear chain any more,
  // and naming it here would overwrite the last chain-walking session's log
  // with an empty array on the first review.
  await sql`
    insert into longku_sweep (owner_email, played, session, started, updated)
    values (${owner},
            ${JSON.stringify(env.played ?? [])}::jsonb,
            ${JSON.stringify(env.session ?? [])}::jsonb,
            ${started}, now())
    on conflict (owner_email) do update
      set played  = excluded.played,
          session = excluded.session,
          started = excluded.started,
          updated = now()
  `;
}

/** Whose bank this site serves. Reads are public; only this account writes. */
function ownerEmail(): string | null {
  return process.env.LONGKU_OWNER_EMAIL ?? null;
}

/**
 * longku_bank.in_sweep is still set per word as it is played, so a row says
 * for itself whether it has come up and one statement can clear the lot. What
 * the client reads back is longku_sweep.played, which also knows the order.
 */
interface BankRow {
  w: string;
  fs: string;
  ls: string | null;
  f: number | null;
  recalls: number;
  strength: number;
  misses: number;
  last_seen: string | null;
  off_corpus: boolean;
  added: string;
  last_recalled: string | null;
  in_sweep: boolean;
}

/**
 * The owner's bank, readable by anyone.
 *
 * Spectators get the same corpus the owner sees — that's the point of putting
 * it on a server — plus a flag so the UI can present itself as read-only
 * instead of letting them click things that will 403.
 */
export async function GET() {
  const viewer = await getViewer();
  const owner = ownerEmail();

  if (!hasDb() || !owner) {
    // Unconfigured deploy: report it plainly so the client can stay on local
    // storage rather than silently showing an empty bank.
    return NextResponse.json(
      { configured: false, isOwner: false, email: viewer.email, bank: [], sweep: [] },
      { status: 200 },
    );
  }

  const sql = getDb();
  const rows = (await sql`
    select w, fs, ls, f, recalls, strength, misses, off_corpus,
           added, last_recalled, last_seen, in_sweep
    from longku_bank
    where owner_email = ${owner}
    order by added asc
  `) as unknown as BankRow[];

  const sweepRows = (await sql`
    select played, session, started
    from longku_sweep where owner_email = ${owner}
  `) as unknown as Array<{
    played: string[];
    session: string[];
    started: string | null;
  }>;
  const sweepRow = sweepRows[0];
  // Fall back to the flags for a row written before played existed, so an
  // in-progress sweep isn't lost on the deploy that adds it.
  const played =
    sweepRow?.played && sweepRow.played.length > 0
      ? sweepRow.played
      : rows.filter((r) => r.in_sweep).map((r) => r.w);

  return NextResponse.json({
    configured: true,
    isOwner: viewer.isOwner,
    email: viewer.email,
    bank: rows.map((r) => ({
      w: r.w,
      fs: r.fs,
      ls: r.ls,
      ...(r.f === null ? {} : { f: r.f }),
      recalls: r.recalls,
      strength: r.strength ?? 0,
      misses: r.misses ?? 0,
      added: new Date(r.added).getTime(),
      ...(r.last_seen ? { lastSeen: new Date(r.last_seen).getTime() } : {}),
      ...(r.last_recalled ? { lastRecalled: new Date(r.last_recalled).getTime() } : {}),
      ...(r.off_corpus ? { offCorpus: true } : {}),
    })),
    sweep: played,
    session: sweepRow?.session ?? [],
    started: sweepRow?.started ? new Date(sweepRow.started).getTime() : null,
  });
}

type Op =
  | { op: "add"; words: Array<{ w: string; fs: string; ls: string | null; f?: number; offCorpus?: boolean }> }
  | { op: "remove"; w: string; sweep?: SweepEnvelope }
  | { op: "play"; w: string; recalled: boolean; strength: number; sweep?: SweepEnvelope }
  | { op: "miss"; words: Array<{ w: string; strength: number }> }
  | { op: "startSession"; sweep?: SweepEnvelope }
  | { op: "hydrate"; readings: Array<{ w: string; fs?: string; ls?: string | null; f?: number }> };

/**
 * Every mutation, behind one owner check.
 *
 * Funnelling writes through a single route keeps the authorization decision in
 * one place — a new operation can't accidentally ship without the gate.
 */
export async function POST(req: NextRequest) {
  const owner = ownerEmail();
  if (!hasDb() || !owner) {
    return NextResponse.json({ error: "bank storage is not configured" }, { status: 503 });
  }

  try {
    await requireOwner();
  } catch (e) {
    if (e instanceof NotOwnerError) {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    throw e;
  }

  let body: Op;
  try {
    body = (await req.json()) as Op;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const sql = getDb();

  switch (body.op) {
    case "add": {
      if (!Array.isArray(body.words) || body.words.length === 0) {
        return NextResponse.json({ error: "no words given" }, { status: 400 });
      }
      if (body.words.length > 500) {
        return NextResponse.json({ error: "too many words in one call" }, { status: 413 });
      }
      const added: string[] = [];
      for (const word of body.words) {
        if (!word?.w || !word?.fs) continue;
        // A repeat add must not reset recalls or the added date, but should
        // fill in a reading or frequency the first pass didn't have.
        const res = (await sql`
          insert into longku_bank (owner_email, w, fs, ls, f, off_corpus)
          values (${owner}, ${word.w}, ${word.fs}, ${word.ls ?? null},
                  ${word.f ?? null}, ${word.offCorpus ?? false})
          on conflict (owner_email, w) do update set
            ls = coalesce(longku_bank.ls, excluded.ls),
            f  = coalesce(longku_bank.f,  excluded.f)
          returning (xmax = 0) as inserted
        `) as unknown as Array<{ inserted: boolean }>;
        if (res[0]?.inserted) added.push(word.w);
      }
      return NextResponse.json({ ok: true, added });
    }

    case "remove": {
      if (!body.w) return NextResponse.json({ error: "no word given" }, { status: 400 });
      await sql`delete from longku_bank where owner_email = ${owner} and w = ${body.w}`;
      if (body.sweep) await saveSweep(sql, owner, body.sweep);
      return NextResponse.json({ ok: true });
    }

    case "play": {
      if (!body.w) return NextResponse.json({ error: "no word given" }, { status: 400 });
      // A prompted play advances the sweep but leaves the recall count alone —
      // it records that the word came up, not that it was produced.
      if (body.recalled) {
        await sql`
          update longku_bank
          set recalls = recalls + 1,
              last_recalled = now(),
              last_seen = now(),
              strength = ${body.strength ?? 0},
              in_sweep = true
          where owner_email = ${owner} and w = ${body.w}
        `;
      } else {
        // Shown rather than produced: the miss was taken when the list opened.
        await sql`
          update longku_bank set in_sweep = true, last_seen = now()
          where owner_email = ${owner} and w = ${body.w}
        `;
      }
      if (body.sweep) await saveSweep(sql, owner, body.sweep);
      return NextResponse.json({ ok: true });
    }

    case "miss": {
      if (!Array.isArray(body.words)) {
        return NextResponse.json({ error: "no words given" }, { status: 400 });
      }
      for (const m of body.words.slice(0, 200)) {
        if (!m?.w) continue;
        await sql`
          update longku_bank
          set misses = misses + 1, last_seen = now(), strength = ${m.strength ?? 0}
          where owner_email = ${owner} and w = ${m.w}
        `;
      }
      return NextResponse.json({ ok: true });
    }

    case "startSession": {
      // A new session drops every flag first: the incoming envelope carries an
      // empty played list, so leaving the old ones set would strand words as
      // used with nothing recording that they were.
      await sql`update longku_bank set in_sweep = false where owner_email = ${owner}`;
      await saveSweep(sql, owner, body.sweep ?? {});
      return NextResponse.json({ ok: true });
    }

    case "hydrate": {
      if (!Array.isArray(body.readings)) {
        return NextResponse.json({ error: "no readings given" }, { status: 400 });
      }
      for (const r of body.readings) {
        if (!r?.w) continue;
        await sql`
          update longku_bank
          set ls = coalesce(ls, ${r.ls ?? null}),
              f  = coalesce(f,  ${r.f ?? null}),
              fs = coalesce(${r.fs ?? null}, fs)
          where owner_email = ${owner} and w = ${r.w}
        `;
      }
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: "unknown op" }, { status: 400 });
  }
}
