import { NextRequest, NextResponse } from "next/server";
import { ownerOnly } from "../guard";
import { bad, body } from "../params";
import { ReviewError, submitReview } from "../review";
import type { ReviewInput } from "@chongfuxi/lib/api";
import { isStudyDay } from "@chongfuxi/lib/day";

export const dynamic = "force-dynamic";

function isReview(r: ReviewInput | null): r is ReviewInput {
  return (
    !!r &&
    typeof r.id === "string" &&
    r.id.length > 0 &&
    r.id.length <= 64 &&
    !r.id.includes(":") &&
    Number.isInteger(r.cardId) &&
    (r.grade === "good" || r.grade === "forgot") &&
    typeof r.at === "number" &&
    typeof r.session === "string" &&
    isStudyDay(r) &&
    (r.tapped === undefined || (Array.isArray(r.tapped) && r.tapped.length <= 60 && r.tapped.every((w) => typeof w === "string"))) &&
    (r.tz === undefined || (typeof r.tz === "string" && r.tz.length <= 64)) &&
    (r.utcOffset === undefined || (Number.isInteger(r.utcOffset) && Math.abs(r.utcOffset) <= 16 * 60)) &&
    (r.position === undefined || (Number.isInteger(r.position) && r.position > 0)) &&
    (r.device === undefined || (typeof r.device === "string" && r.device.length <= 20))
  );
}

/** Record an answer. An id that was already recorded changes nothing. */
export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const input = await body<ReviewInput>(req);
  if (!isReview(input)) return bad("not a review");
  try {
    return NextResponse.json(await submitReview(gate.sql, gate.owner, input));
  } catch (e) {
    if (e instanceof ReviewError) return bad(e.message, 409);
    throw e;
  }
}
