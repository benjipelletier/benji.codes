import { NextRequest, NextResponse } from "next/server";
import { ownersLog } from "../guard";
import { getCoverage, listMissing } from "../review";

export const dynamic = "force-dynamic";

/**
 * How much of each HSK level is in the deck. With ?list=<path> it is instead
 * the words of that level still missing, a page at a time. Readable by anyone.
 */
export async function GET(req: NextRequest) {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  const p = req.nextUrl.searchParams;
  const list = p.get("list");
  if (!list) return NextResponse.json(await getCoverage(gate.sql, gate.owner));
  const words = await listMissing(
    gate.sql,
    gate.owner,
    list,
    Math.max(Number(p.get("offset")) || 0, 0),
    Math.min(Math.max(Number(p.get("limit")) || 60, 1), 200),
  );
  return NextResponse.json({ words });
}
