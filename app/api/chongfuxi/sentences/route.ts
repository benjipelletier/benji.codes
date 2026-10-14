import { NextRequest, NextResponse } from "next/server";
import { ownersLog } from "../guard";
import { listSentences } from "../review";

export const dynamic = "force-dynamic";

/** Sentences by how close they are to readable, shortest first; or every one with a given word in it. Readable by anyone. */
export async function GET(req: NextRequest) {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  const p = req.nextUrl.searchParams;
  const show = p.get("show");
  const sentences = await listSentences(gate.sql, gate.owner, {
    show: show === "one" || show === "locked" ? show : "readable",
    blocker: p.get("blocker") || undefined,
    word: p.get("word")?.trim().slice(0, 20) || undefined,
    within: p.get("within") === "1",
    source: p.get("source")?.slice(0, 120) || undefined,
    offset: Math.max(Number(p.get("offset")) || 0, 0),
    limit: Math.min(Math.max(Number(p.get("limit")) || 40, 1), 100),
  });
  return NextResponse.json({ sentences });
}
