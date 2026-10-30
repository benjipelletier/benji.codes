import { NextRequest, NextResponse } from "next/server";
import { getDb, hasDb } from "../db";
import { readLongku, type BankRow } from "@longku/lib/read";

export const dynamic = "force-dynamic";

/** Whose bank this site serves, as in the bank route. */
function ownerEmail(): string | null {
  return process.env.LONGKU_OWNER_EMAIL ?? null;
}

/** Syllables one call may ask the corpus for, and words each. */
const MAX_SYLLABLES = 40;
const MAX_PER = 200;

/**
 * GET: 龙库 as data (longku/lib/read.ts): the bank's words, the facts per
 * syllable and the bank's measures. ?corpus=zhi,ji&per=30 adds the corpus
 * words starting on those syllables. Read by the owner's agent (Muse); public,
 * like the bank route.
 */
export async function GET(req: NextRequest) {
  const owner = ownerEmail();
  if (!hasDb() || !owner) {
    return NextResponse.json({ error: "bank storage is not configured" }, { status: 503 });
  }
  const q = req.nextUrl.searchParams;
  const corpusOn = (q.get("corpus") ?? "")
    .split(/[,，\s]+/)
    .filter(Boolean)
    .slice(0, MAX_SYLLABLES);
  const per = Math.min(MAX_PER, Math.max(1, Number(q.get("per")) || 30));

  const sql = getDb();
  const rows = (await sql`
    select w, fs, ls, f, recalls, strength, misses, added, last_recalled, due
    from longku_bank where owner_email = ${owner}
    order by added asc
  `) as unknown as BankRow[];
  const excluded = (await sql`
    select w from longku_excluded where owner_email = ${owner}
  `) as unknown as Array<{ w: string }>;

  return NextResponse.json(readLongku(rows, new Set(excluded.map((r) => r.w)), { corpusOn, per }));
}
