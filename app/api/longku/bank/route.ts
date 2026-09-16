import { NextRequest, NextResponse } from "next/server";
import { getDb, hasDb } from "../db";
import { getViewer, NotOwnerError, requireOwner } from "@longku/lib/session";

export const dynamic = "force-dynamic";

/** Whose bank this site serves. Reads are public; only this account writes. */
function ownerEmail(): string | null {
  return process.env.LONGKU_OWNER_EMAIL ?? null;
}

interface BankRow {
  w: string;
  fs: string;
  ls: string | null;
  f: number | null;
  recalls: number;
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
    select w, fs, ls, f, recalls, off_corpus, added, last_recalled, in_sweep
    from longku_bank
    where owner_email = ${owner}
    order by added asc
  `) as unknown as BankRow[];

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
      added: new Date(r.added).getTime(),
      ...(r.last_recalled ? { lastRecalled: new Date(r.last_recalled).getTime() } : {}),
      ...(r.off_corpus ? { offCorpus: true } : {}),
    })),
    sweep: rows.filter((r) => r.in_sweep).map((r) => r.w),
  });
}

type Op =
  | { op: "add"; words: Array<{ w: string; fs: string; ls: string | null; f?: number; offCorpus?: boolean }> }
  | { op: "remove"; w: string }
  | { op: "recall"; w: string }
  | { op: "resetSweep" }
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
      return NextResponse.json({ ok: true });
    }

    case "recall": {
      if (!body.w) return NextResponse.json({ error: "no word given" }, { status: 400 });
      await sql`
        update longku_bank
        set recalls = recalls + 1, last_recalled = now(), in_sweep = true
        where owner_email = ${owner} and w = ${body.w}
      `;
      return NextResponse.json({ ok: true });
    }

    case "resetSweep": {
      await sql`update longku_bank set in_sweep = false where owner_email = ${owner}`;
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
