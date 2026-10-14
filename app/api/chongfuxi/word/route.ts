import { NextRequest, NextResponse } from "next/server";
import { AdditionError, removeWord } from "../additions";
import { ownerOnly, ownersLog } from "../guard";
import { bad, body } from "../params";
import { wordDetail } from "../words";

export const dynamic = "force-dynamic";
// Removing a word re-checks every sentence.
export const maxDuration = 60;

/** One word in full: its cards, Pleco's record, and the sentences it is in. Readable by anyone. */
export async function GET(req: NextRequest) {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  const w = req.nextUrl.searchParams.get("w")?.trim();
  if (!w || w.length > 20) return bad("which word?");
  const detail = await wordDetail(gate.sql, gate.owner, w);
  return detail ? NextResponse.json(detail) : bad("not a word in the corpus", 404);
}

/** Take a word out of the deck: { word, action: "remove" }. */
export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const input = await body<{ word?: string; action?: string }>(req);
  const word = input?.word?.trim();
  if (!word || word.length > 20 || input?.action !== "remove") return bad("expected a word and action: remove");
  try {
    return NextResponse.json(await removeWord(gate.sql, gate.owner, word));
  } catch (e) {
    if (e instanceof AdditionError) return bad(e.message, 409);
    throw e;
  }
}
