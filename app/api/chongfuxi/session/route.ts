import { NextRequest, NextResponse } from "next/server";
import { ownersLog } from "../guard";
import { bad, dayFrom, numbers, words } from "../params";
import { nextCards } from "../review";

export const dynamic = "force-dynamic";

/** The next cards to review. Readable by anyone; only the owner can answer them. */
export async function GET(req: NextRequest) {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  const day = dayFrom(req);
  if (!day) return bad("day and cutoff are required");
  const p = req.nextUrl.searchParams;
  const cards = await nextCards(gate.sql, gate.owner, day, {
    limit: Math.min(Math.max(Number(p.get("limit")) || 10, 1), 30),
    position: Math.max(Number(p.get("position")) || 0, 0),
    exclude: numbers(p.get("exclude")),
    skipWords: words(p.get("skip")),
    read: p.get("read") !== "0",
    recall: p.get("recall") !== "0",
    sentences: p.get("sentences") !== "0",
    list: p.get("list") || undefined,
    more: p.get("more") === "1",
  });
  return NextResponse.json({ cards });
}
