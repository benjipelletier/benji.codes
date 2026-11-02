import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { ownerOnly } from "../guard";
import { bad, body } from "../params";
import { ParagraphError, listParagraphs, tryParagraph, writeParagraph } from "../paragraph";

export const dynamic = "force-dynamic";
// A model call to write a paragraph or grade a try.
export const maxDuration = 120;

/** The paragraphs to write in Chinese, newest first (paragraph.ts). Owner only. */
export async function GET() {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  return NextResponse.json({ paragraphs: await listParagraphs(gate.sql, gate.owner) });
}

/** { new: true }: a new paragraph around the trouble words; { id, answer }: a try at one, graded. Owner only: it costs money. */
export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const input = (await body<{ new?: boolean; id?: number; answer?: string }>(req)) ?? {};
  try {
    if (input.new === true) return NextResponse.json({ paragraph: await writeParagraph(gate.sql, gate.owner) });
    if (typeof input.id !== "number" || typeof input.answer !== "string") return bad("give { new: true } or { id, answer }");
    return NextResponse.json({ paragraph: await tryParagraph(gate.sql, gate.owner, input.id, input.answer) });
  } catch (e) {
    if (e instanceof ParagraphError) return bad(e.message, 422);
    console.error("paragraph failed", e);
    if (e instanceof Anthropic.APIError) {
      const detail = (e.error as { error?: { message?: string } } | undefined)?.error?.message ?? e.message;
      return bad(`The model call failed (${e.status ?? "no status"}): ${detail}`, 502);
    }
    throw e;
  }
}
