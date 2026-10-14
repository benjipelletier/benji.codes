import { NextRequest, NextResponse } from "next/server";
import { ownerOnly } from "../../guard";
import { bad, body } from "../../params";
import { ReviewError, undoReview } from "../../review";

export const dynamic = "force-dynamic";

/** Take back the last answer, to give it again. */
export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const input = await body<{ id?: unknown }>(req);
  if (!input || typeof input.id !== "string" || !input.id || input.id.length > 64) return bad("which answer?");
  try {
    return NextResponse.json(await undoReview(gate.sql, gate.owner, input.id));
  } catch (e) {
    if (e instanceof ReviewError) return bad(e.message, 409);
    throw e;
  }
}
