import { NextResponse } from "next/server";
import { ownersLog } from "../guard";
import { listBlockers } from "../review";

export const dynamic = "force-dynamic";

/** The words standing alone between the owner and some sentences. Readable by anyone. */
export async function GET() {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  return NextResponse.json(await listBlockers(gate.sql, gate.owner, 150));
}
