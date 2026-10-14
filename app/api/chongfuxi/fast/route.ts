import { NextRequest, NextResponse } from "next/server";
import { ownersLog } from "../guard";
import { bad, dayFrom } from "../params";
import { fastCards } from "../review";

export const dynamic = "force-dynamic";

/** Fast review: the Read cards due today, a page at a time. Readable by anyone; only the owner can answer them. */
export async function GET(req: NextRequest) {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  const day = dayFrom(req);
  if (!day) return bad("day and cutoff are required");
  const p = req.nextUrl.searchParams;
  return NextResponse.json(
    await fastCards(
      gate.sql,
      gate.owner,
      day,
      Math.max(Number(p.get("offset")) || 0, 0),
      Math.min(Math.max(Number(p.get("limit")) || 150, 1), 300),
    ),
  );
}
