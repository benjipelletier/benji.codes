import { NextRequest, NextResponse } from "next/server";
import { ownersLog } from "../../guard";
import { suggestWords } from "../../suggest";

export const dynamic = "force-dynamic";

/** ?q=: words of the corpus matching what is typed, for Look up's type-ahead. No model. Readable by anyone. */
export async function GET(req: NextRequest) {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  return NextResponse.json({ words: await suggestWords(gate.sql, gate.owner, req.nextUrl.searchParams.get("q") ?? "") });
}
