import { NextRequest, NextResponse } from "next/server";
import { ownersLog } from "../guard";
import { listNotes } from "../notes";

export const dynamic = "force-dynamic";

/** The owner's notes after a Forgot, newest first, with Muse's answers (notes.ts); ?offset= pages on. Readable by anyone. */
export async function GET(req: NextRequest) {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  const offset = Math.max(Number(req.nextUrl.searchParams.get("offset")) || 0, 0);
  return NextResponse.json(await listNotes(gate.sql, gate.owner, offset));
}
