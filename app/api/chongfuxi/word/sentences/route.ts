import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { loadDict } from "../../dictfile";
import { ownerOnly } from "../../guard";
import { bad, body } from "../../params";
import { WriteError, writeSentences } from "../../writesentences";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** { word }: the model writes sentences for a known word, each readable now, and they join the corpus (writesentences.ts). Owner only: it costs money. */
export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const word = (await body<{ word?: string }>(req))?.word?.trim();
  if (!word || word.length > 20) return bad("which word?");
  try {
    return NextResponse.json(await writeSentences(gate.sql, gate.owner, loadDict(), word));
  } catch (e) {
    if (e instanceof WriteError) return bad(e.message, 422);
    console.error("write sentences failed", e);
    if (e instanceof Anthropic.APIError) {
      const detail = (e.error as { error?: { message?: string } } | undefined)?.error?.message ?? e.message;
      return bad(`The model call failed (${e.status ?? "no status"}): ${detail}`, 502);
    }
    return bad(`Writing them failed: ${e instanceof Error ? e.message : String(e)}`, 500);
  }
}
