import { NextResponse } from "next/server";
import { listAnkiSyncs } from "../additions";
import { ownersLog } from "../guard";

export const dynamic = "force-dynamic";

/** Every Anki sync and what it did to the corpus, for the Import page. Readable by anyone. */
export async function GET() {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  return NextResponse.json({ syncs: await listAnkiSyncs(gate.sql, gate.owner) });
}
