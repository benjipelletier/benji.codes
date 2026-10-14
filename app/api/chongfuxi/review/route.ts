import { NextRequest, NextResponse } from "next/server";
import { ownerOnly } from "../guard";
import { bad, body } from "../params";
import { ReviewError, isReviewInput, submitReview } from "../review";
import type { ReviewInput } from "@chongfuxi/lib/api";

export const dynamic = "force-dynamic";

/** Record an answer. An id that was already recorded changes nothing. */
export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const input = await body<ReviewInput>(req);
  if (!isReviewInput(input)) return bad("not a review");
  try {
    return NextResponse.json(await submitReview(gate.sql, gate.owner, input));
  } catch (e) {
    if (e instanceof ReviewError) return bad(e.message, 409);
    throw e;
  }
}
