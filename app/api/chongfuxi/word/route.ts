import { NextRequest, NextResponse } from "next/server";
import { AdditionError, addFromPage, removeWord } from "../additions";
import { loadDict } from "../dictfile";
import { ownerOnly, ownersLog } from "../guard";
import { bad, body } from "../params";
import { WordError, suspendWord, wordDetail } from "../words";

export const dynamic = "force-dynamic";
// Removing, suspending or bringing back a word re-checks every sentence.
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

/**
 * { word, action: "add" }: put it in the deck from its page (an addition, undone through additions/[id]).
 * { word, action: "remove" }: take a word out of the deck, its cards and answers with it.
 * { word, action: "suspend" | "resume" }: suspend it (its cards kept, not dealt, its sentences locked) or bring it back.
 */
export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const input = await body<{ word?: string; action?: string }>(req);
  const word = input?.word?.trim();
  const action = input?.action;
  if (!word || word.length > 20 || (action !== "add" && action !== "remove" && action !== "suspend" && action !== "resume")) {
    return bad("expected a word and action: add, remove, suspend or resume");
  }
  try {
    if (action === "add") {
      const added = await addFromPage(gate.sql, gate.owner, word, loadDict());
      return NextResponse.json({ id: added?.id ?? null, added: added?.added ?? [], unlocked: added?.unlocked ?? 0 });
    }
    if (action === "remove") return NextResponse.json(await removeWord(gate.sql, gate.owner, word));
    return NextResponse.json(await suspendWord(gate.sql, gate.owner, word, action === "suspend"));
  } catch (e) {
    if (e instanceof AdditionError) return bad(e.message, 409);
    if (e instanceof WordError) return bad(e.message, 409);
    throw e;
  }
}
