import { NextRequest, NextResponse } from "next/server";
import { ownersLog } from "../../guard";
import { bad } from "../../params";
import { wordPage, wordSentences, type SentenceStatus } from "../../wordpage";

export const dynamic = "force-dynamic";

/**
 * ?w=: a word's page, everything about how it lives in the corpus; with
 * &status=readable|oneAway|locked&sentences=<offset>, a page of its sentences of that standing. Readable by anyone.
 */
export async function GET(req: NextRequest) {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  const p = req.nextUrl.searchParams;
  const w = p.get("w")?.trim();
  if (!w || w.length > 20) return bad("which word?");
  const more = p.get("sentences");
  if (more !== null) {
    const status = p.get("status") as SentenceStatus | null;
    if (status !== "readable" && status !== "oneAway" && status !== "locked") return bad("status is readable, oneAway or locked");
    return NextResponse.json({ rows: await wordSentences(gate.sql, gate.owner, w, status, Math.max(Number(more) || 0, 0)) });
  }
  const page = await wordPage(gate.sql, gate.owner, w);
  return page ? NextResponse.json(page) : bad("not a word in the corpus", 404);
}
