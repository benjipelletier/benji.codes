import { NextRequest, NextResponse } from "next/server";
import { setName } from "../corpus";
import { ownerOnly } from "../guard";
import { bad, body } from "../params";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Mark a word as a name ({ word }) so it stops blocking sentences, or take that back ({ word, on: false }). */
export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const b = await body<{ word?: string; on?: boolean }>(req);
  if (!b || typeof b.word !== "string" || !b.word || b.word.length > 20) return bad("word is required");
  const result = await setName(gate.sql, gate.owner, b.word, b.on !== false);
  return NextResponse.json({ ok: true, ...result });
}
