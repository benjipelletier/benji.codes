import { NextRequest, NextResponse } from "next/server";
import { getDb, hasDb } from "../db";
import { nextSyllables } from "@longku/lib/next";

export const dynamic = "force-dynamic";

/** Whose bank this site serves, as in the bank route. */
function ownerEmail(): string | null {
  return process.env.LONGKU_OWNER_EMAIL ?? null;
}

const clamp = (raw: string | null, dflt: number, max: number) =>
  Math.min(max, Math.max(1, Number(raw) || dflt));

/**
 * GET ?limit=15&per=3: the syllables nothing in the owner's bank starts on,
 * dead ends first, each with the chengyu to learn there (longku/lib/next.ts).
 * Read by the owner's agent (Muse) when it picks what to put in front of
 * them. Public, like the bank it is worked out from.
 */
export async function GET(req: NextRequest) {
  const owner = ownerEmail();
  if (!hasDb() || !owner) {
    return NextResponse.json({ error: "bank storage is not configured" }, { status: 503 });
  }
  const q = req.nextUrl.searchParams;
  const limit = clamp(q.get("limit"), 15, 100);
  const per = clamp(q.get("per"), 3, 10);

  const sql = getDb();
  const bank = (await sql`
    select w, fs, ls from longku_bank where owner_email = ${owner}
  `) as unknown as Array<{ w: string; fs: string; ls: string | null }>;
  const excluded = (await sql`
    select w from longku_excluded where owner_email = ${owner}
  `) as unknown as Array<{ w: string }>;

  return NextResponse.json(
    nextSyllables(bank, new Set(excluded.map((r) => r.w)), { limit, per }),
  );
}
