import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { ownerOnly, ownersLog } from "../guard";
import { bad, body } from "../params";
import { dailyStory } from "../daily";
import { RescueError, checkOwnSentence, makeRescue, newWords, rescueOf, speedWords, stuckWords } from "../rescue";

export const dynamic = "force-dynamic";
// One model call, at Look up's effort.
export const maxDuration = 120;

/** Memory kits: the stuck words and the new words on the Learn ladder (`fresh`); with ?w=, that word's rescue (null if none yet); with ?story=1, the latest daily story (Muse's, daily.ts). Readable by anyone. */
export async function GET(req: NextRequest) {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  if (req.nextUrl.searchParams.get("story") === "1") return NextResponse.json({ story: await dailyStory(gate.sql, gate.owner) });
  if (req.nextUrl.searchParams.get("speed") === "1") return NextResponse.json({ words: await speedWords(gate.sql, gate.owner) });
  const w = req.nextUrl.searchParams.get("w")?.trim();
  if (w !== undefined) {
    if (!w || w.length > 20) return bad("which word?");
    return NextResponse.json({ rescue: await rescueOf(gate.sql, gate.owner, w) });
  }
  const [words, fresh] = await Promise.all([stuckWords(gate.sql, gate.owner), newWords(gate.sql, gate.owner)]);
  return NextResponse.json({ words, fresh });
}

/**
 * { word, fresh? }: make the word's rescue (or give back the one made). Owner only: it costs money.
 * { word, own: "…" }: the owner's own sentence with the word, checked by the model.
 */
export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const input = await body<{ word?: string; fresh?: boolean; own?: string }>(req);
  const word = input?.word?.trim();
  if (!word || word.length > 20) return bad("which word?");
  try {
    if (!word) return bad("which word?");
    if (typeof input?.own === "string") {
      if (!input.own.trim()) return bad("write a sentence");
      return NextResponse.json({ rescue: await checkOwnSentence(gate.sql, gate.owner, word, input.own) });
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
