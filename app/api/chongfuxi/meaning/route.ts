import { NextRequest, NextResponse } from "next/server";
import { ownerOnly } from "../guard";
import { bad, body } from "../params";
import { ReviewError, mergeMeaning, splitMeaning } from "../review";

export const dynamic = "force-dynamic";

/** Split a meaning off a word ({ word, gloss }) or fold one back ({ merge: id }). */
export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const b = await body<{ word?: string; gloss?: string; merge?: number }>(req);
  if (b && Number.isInteger(b.merge)) {
    await mergeMeaning(gate.sql, gate.owner, b.merge!);
    return NextResponse.json({ ok: true });
  }
  if (!b || typeof b.word !== "string" || typeof b.gloss !== "string" || !b.gloss.trim() || b.gloss.length > 400) {
    return bad("word and gloss are required");
  }
  try {
    return NextResponse.json({ ok: true, id: await splitMeaning(gate.sql, gate.owner, b.word, b.gloss.trim()) });
  } catch (e) {
    if (e instanceof ReviewError) return bad(e.message, 409);
    throw e;
  }
}
