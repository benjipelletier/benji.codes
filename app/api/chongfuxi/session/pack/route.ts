import { NextRequest, NextResponse } from "next/server";
import { isStudyDay } from "@chongfuxi/lib/day";
import { ownersLog } from "../../guard";
import { bad, body } from "../../params";
import { nextCards } from "../../review";

export const dynamic = "force-dynamic";
// A page of up to PACK_PAGE cards, dressed for review.
export const maxDuration = 60;

/** Cards a page of the pack holds, at most. */
const PACK_PAGE = 250;

/**
 * A page of the offline pack (lib/offline.ts): the next cards a session
 * would deal, as many as PACK_PAGE, leaving out those already in the pack.
 * POSTed, since the pack's ids run to thousands. Readable like the session.
 */
export async function POST(req: NextRequest) {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  const input = (await body<{ day?: unknown; cutoff?: unknown; exclude?: unknown; limit?: unknown; position?: unknown }>(req)) ?? {};
  const day = { day: input.day, cutoff: input.cutoff };
  if (!isStudyDay(day)) return bad("day and cutoff are required");
  const exclude = Array.isArray(input.exclude) ? input.exclude.filter((x): x is number => Number.isInteger(x) && x > 0) : [];
  const cards = await nextCards(gate.sql, gate.owner, day, {
    limit: Math.min(Math.max(Number(input.limit) || PACK_PAGE, 1), PACK_PAGE),
    position: Math.max(Number(input.position) || 0, 0),
    exclude,
    skipWords: [],
  });
  return NextResponse.json({ cards });
}
