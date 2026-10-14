import { NextRequest, NextResponse } from "next/server";
import { AdditionError, markSeen, undoAddition } from "../../additions";
import { ownerOnly } from "../../guard";
import { bad, body } from "../../params";

export const dynamic = "force-dynamic";
// Undoing re-checks every sentence.
export const maxDuration = 60;

/** Keep an addition (mark it seen) or undo it. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const id = Number((await params).id);
  const input = await body<{ action?: string }>(req);
  if (!Number.isInteger(id) || id <= 0) return bad("which addition?");
  try {
    if (input?.action === "seen") {
      await markSeen(gate.sql, gate.owner, id);
      return NextResponse.json({ ok: true });
    }
    if (input?.action === "undo") return NextResponse.json(await undoAddition(gate.sql, gate.owner, id));
    return bad("action must be seen or undo");
  } catch (e) {
    if (e instanceof AdditionError) return bad(e.message, 409);
    throw e;
  }
}
