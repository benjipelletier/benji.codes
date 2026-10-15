import { NextRequest, NextResponse } from "next/server";
import { ownersLog } from "../guard";
import { bad } from "../params";
import { sentenceDetail } from "../review";

export const dynamic = "force-dynamic";

/** One sentence in full: its words and how each stands, what blocks it, its card. Readable by anyone. */
export async function GET(req: NextRequest) {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return bad("which sentence?");
  const detail = await sentenceDetail(gate.sql, gate.owner, id);
  return detail ? NextResponse.json(detail) : bad("no such sentence", 404);
}
