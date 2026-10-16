import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { DefineError, defineWord } from "../define";
import { ownerOnly } from "../guard";
import { bad, body } from "../params";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** { word }: write a word with no definition one, by the model, and keep it (marked AI). Owner only: it costs money. */
export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const input = await body<{ word?: string }>(req);
  const word = input?.word?.trim();
  if (!word || word.length > 20) return bad("which word?");
  try {
    return NextResponse.json(await defineWord(gate.sql, gate.owner, word));
  } catch (e) {
    if (e instanceof DefineError) return bad(e.message, 422);
    console.error("define failed", e);
    if (e instanceof Anthropic.APIError) {
      const detail = (e.error as { error?: { message?: string } } | undefined)?.error?.message ?? e.message;
      return bad(`The model call failed (${e.status ?? "no status"}): ${detail}`, 502);
    }
    return bad(`Defining it failed: ${e instanceof Error ? e.message : String(e)}`, 500);
  }
}
