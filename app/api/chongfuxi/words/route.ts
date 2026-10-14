import { NextResponse } from "next/server";
import { ownersLog } from "../guard";
import { listWords } from "../words";

export const dynamic = "force-dynamic";

/** Every deck word with where its Read card stands, for the Words wall. Readable by anyone. */
export async function GET() {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  return NextResponse.json({ words: await listWords(gate.sql, gate.owner) });
}
