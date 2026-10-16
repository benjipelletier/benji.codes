import { NextRequest, NextResponse } from "next/server";
import { ownerOnly } from "../../guard";
import { bad, body } from "../../params";
import { ReviewError, changeAnswer } from "../../review";

export const dynamic = "force-dynamic";
// A change replays the later answers that depend on it, one at a time.
export const maxDuration = 120;

/** { id, grade }: change an answer already given to Got it or Forgot, as if given that way. */
export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const input = await body<{ id?: unknown; grade?: unknown }>(req);
  if (!input || typeof input.id !== "string" || !input.id || input.id.length > 64) return bad("which answer?");
  if (input.grade !== "good" && input.grade !== "forgot") return bad("grade is good or forgot");
  try {
    return NextResponse.json(await changeAnswer(gate.sql, gate.owner, input.id, input.grade));
  } catch (e) {
    if (e instanceof ReviewError) return bad(e.message, 409);
    throw e;
  }
}
