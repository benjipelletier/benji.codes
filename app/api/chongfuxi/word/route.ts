import { NextRequest, NextResponse } from "next/server";
import { ownersLog } from "../guard";
import { bad } from "../params";
import { wordDetail } from "../words";

export const dynamic = "force-dynamic";

/** One word in full: its cards, Pleco's record, and the sentences it is in. Readable by anyone. */
export async function GET(req: NextRequest) {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  const w = req.nextUrl.searchParams.get("w")?.trim();
  if (!w || w.length > 20) return bad("which word?");
  const detail = await wordDetail(gate.sql, gate.owner, w);
  return detail ? NextResponse.json(detail) : bad("not a word in the corpus", 404);
}
