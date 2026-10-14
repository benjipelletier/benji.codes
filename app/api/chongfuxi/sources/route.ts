import { NextResponse } from "next/server";
import { ownersLog } from "../guard";
import { listSources } from "../review";

export const dynamic = "force-dynamic";

/** Where the sentences came from, each with how many are readable, one word away and locked. Readable by anyone. */
export async function GET() {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  return NextResponse.json({ sources: await listSources(gate.sql, gate.owner) });
}
