import { NextRequest, NextResponse } from "next/server";
import { listAdditions } from "../additions";
import { ownersLog } from "../guard";

export const dynamic = "force-dynamic";

/** Recent batches of words added to the deck, for the new-words screen; or one, by ?id=. Readable by anyone. */
export async function GET(req: NextRequest) {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  const id = Number(req.nextUrl.searchParams.get("id"));
  const only = Number.isInteger(id) && id > 0 ? id : null;
  return NextResponse.json({ additions: await listAdditions(gate.sql, gate.owner, only ? 1 : 10, only) });
}
