import { NextRequest, NextResponse } from "next/server";
import { ownersLog } from "../../guard";
import { bad } from "../../params";
import { wordPage, wordSentences } from "../../wordpage";

export const dynamic = "force-dynamic";

/** ?w=: a word's page, everything about how it lives in the corpus; with &sentences=<offset>, more of its sentences. Readable by anyone. */
export async function GET(req: NextRequest) {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  const p = req.nextUrl.searchParams;
  const w = p.get("w")?.trim();
  if (!w || w.length > 20) return bad("which word?");
  const more = p.get("sentences");
  if (more !== null) return NextResponse.json({ rows: await wordSentences(gate.sql, gate.owner, w, Math.max(Number(more) || 0, 0)) });
  const page = await wordPage(gate.sql, gate.owner, w);
  return page ? NextResponse.json(page) : bad("not a word in the corpus", 404);
}
