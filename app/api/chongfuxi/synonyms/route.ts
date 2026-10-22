import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { ownerOnly, ownersLog } from "../guard";
import { bad, body } from "../params";
import { SynonymError, compareGroup, keysOfWord, synonymGroup, synonymGroups } from "../synonyms";

export const dynamic = "force-dynamic";
// The first call cuts every word's keys; a comparison is one model call.
export const maxDuration = 120;

/**
 * Groups of words with the same English (?q= to find some by English or by a word);
 * ?key= one group side by side (&dict=1 with the dictionary's other words);
 * ?w= a word's keys that make groups, for its page. Readable by anyone.
 */
export async function GET(req: NextRequest) {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  const p = req.nextUrl.searchParams;
  const key = p.get("key")?.trim();
  if (key !== undefined) {
    if (!key || key.length > 60) return bad("which key?");
    const group = await synonymGroup(gate.sql, gate.owner, key, p.get("dict") === "1");
    return group ? NextResponse.json(group) : bad("no word of yours has that English", 404);
  }
  const w = p.get("w")?.trim();
  if (w !== undefined) {
    if (!w || w.length > 20) return bad("which word?");
    return NextResponse.json({ keys: await keysOfWord(gate.sql, gate.owner, w) });
  }
  return NextResponse.json({ groups: await synonymGroups(gate.sql, gate.owner, (p.get("q") ?? "").slice(0, 60)) });
}

/** { key }: the model compares the group's words, and it is kept. Owner only: it costs money. */
export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const input = await body<{ key?: string }>(req);
  const key = input?.key?.trim();
  if (!key || key.length > 60) return bad("which key?");
  try {
    return NextResponse.json({ compare: await compareGroup(gate.sql, gate.owner, key) });
  } catch (e) {
    if (e instanceof SynonymError) return bad(e.message, 422);
    console.error("synonyms compare failed", e);
    if (e instanceof Anthropic.APIError) {
      const detail = (e.error as { error?: { message?: string } } | undefined)?.error?.message ?? e.message;
      return bad(`The model call failed (${e.status ?? "no status"}): ${detail}`, 502);
    }
    return bad(`Comparing them failed: ${e instanceof Error ? e.message : String(e)}`, 500);
  }
}
