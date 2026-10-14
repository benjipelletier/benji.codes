import { NextRequest, NextResponse } from "next/server";
import { ownerOnly } from "../guard";
import { bad, body } from "../params";
import { setNote } from "../review";

export const dynamic = "force-dynamic";

/** Put a note on a card ({ cardId, note }), or take it off with an empty one. */
export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const b = await body<{ cardId?: number; note?: string }>(req);
  if (!b || !Number.isInteger(b.cardId) || typeof b.note !== "string") return bad("cardId and note are required");
  await setNote(gate.sql, gate.owner, b.cardId!, b.note.slice(0, 500));
  return NextResponse.json({ ok: true });
}
