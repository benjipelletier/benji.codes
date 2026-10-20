import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { ownerOnly, ownersLog } from "../guard";
import { bad, body } from "../params";
import { RescueError, finishRescue, makeRescue, rescueOf, stuckWords } from "../rescue";

export const dynamic = "force-dynamic";
// One model call, at Look up's effort.
export const maxDuration = 120;

/** The stuck words; with ?w=, that word's rescue (null if none yet). Readable by anyone. */
export async function GET(req: NextRequest) {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  const w = req.nextUrl.searchParams.get("w")?.trim();
  if (w !== undefined) {
    if (!w || w.length > 20) return bad("which word?");
    return NextResponse.json({ rescue: await rescueOf(gate.sql, gate.owner, w) });
  }
  return NextResponse.json({ words: await stuckWords(gate.sql, gate.owner) });
}

/**
 * { word, fresh? }: make the word's rescue (or give back the one made). Owner only: it costs money.
 * { word, done: true, drill: [{ i, right }] }: worked through; its hook goes on its cards.
 */
export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const input = await body<{ word?: string; fresh?: boolean; done?: boolean; drill?: Array<{ i: number; right: boolean }> }>(req);
  const word = input?.word?.trim();
  if (!word || word.length > 20) return bad("which word?");
  try {
    if (input?.done) {
      const drill = (Array.isArray(input.drill) ? input.drill : [])
        .filter((d) => Number.isInteger(d?.i) && typeof d?.right === "boolean")
        .slice(0, 20);
      await finishRescue(gate.sql, gate.owner, word, drill);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ rescue: await makeRescue(gate.sql, gate.owner, word, input?.fresh === true) });
  } catch (e) {
    if (e instanceof RescueError) return bad(e.message, 422);
    console.error("rescue failed", e);
    if (e instanceof Anthropic.APIError) {
      const detail = (e.error as { error?: { message?: string } } | undefined)?.error?.message ?? e.message;
      return bad(`The model call failed (${e.status ?? "no status"}): ${detail}`, 502);
    }
    return bad(`Making the rescue failed: ${e instanceof Error ? e.message : String(e)}`, 500);
  }
}
