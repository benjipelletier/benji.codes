import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { ownerOnly, ownersLog } from "../guard";
import { bad, body } from "../params";
import { RescueError, checkOwnSentence, makeRescue, makeStory, pickHandle, rescueOf, speedWords, storyOf, stuckWords } from "../rescue";

export const dynamic = "force-dynamic";
// One model call, at Look up's effort.
export const maxDuration = 120;

/** The stuck words; with ?w=, that word's rescue (null if none yet); with ?story=1, their story. Readable by anyone. */
export async function GET(req: NextRequest) {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  if (req.nextUrl.searchParams.get("story") === "1") return NextResponse.json({ story: await storyOf(gate.sql, gate.owner) });
  if (req.nextUrl.searchParams.get("speed") === "1") return NextResponse.json({ words: await speedWords(gate.sql, gate.owner) });
  const w = req.nextUrl.searchParams.get("w")?.trim();
  if (w !== undefined) {
    if (!w || w.length > 20) return bad("which word?");
    return NextResponse.json({ rescue: await rescueOf(gate.sql, gate.owner, w) });
  }
  return NextResponse.json({ words: await stuckWords(gate.sql, gate.owner) });
}

/**
 * { word, fresh? }: make the word's rescue (or give back the one made). Owner only: it costs money.
 * { word, pick: index | "own" }: that handle (or the owner's own sentence) becomes the hook on its cards.
 * { word, own: "…" }: the owner's own sentence with the word, checked by the model.
 * { story: true }: write a story with the stuck words in it (owner only, it costs money).
 */
export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const input = await body<{ word?: string; fresh?: boolean; story?: boolean; pick?: number | "own"; own?: string }>(req);
  const word = input?.word?.trim();
  if (!input?.story && (!word || word.length > 20)) return bad("which word?");
  try {
    if (input?.story) return NextResponse.json({ story: await makeStory(gate.sql, gate.owner) });
    if (!word) return bad("which word?");
    if (input?.pick === "own" || (typeof input?.pick === "number" && Number.isInteger(input.pick) && input.pick >= 0)) {
      return NextResponse.json({ rescue: await pickHandle(gate.sql, gate.owner, word, input.pick) });
    }
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
