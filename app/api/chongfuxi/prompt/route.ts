import { NextRequest, NextResponse } from "next/server";
import { ownerOnly } from "../guard";
import { bad, body } from "../params";
import { ReviewError, setPrompt } from "../review";

export const dynamic = "force-dynamic";

/** Choose the senses a Recall card asks with ({ cardId, senses }), or go back to the automatic ones with none. Owner only. */
export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const b = await body<{ cardId?: number; senses?: unknown }>(req);
  if (!b || !Number.isInteger(b.cardId) || !Array.isArray(b.senses) || b.senses.some((s) => typeof s !== "string")) {
    return bad("cardId and senses are required");
  }
  try {
    await setPrompt(gate.sql, gate.owner, b.cardId!, (b.senses as string[]).map((s) => s.slice(0, 200)));
  } catch (e) {
    if (e instanceof ReviewError) return bad(e.message, 409);
    throw e;
  }
  return NextResponse.json({ ok: true });
}
