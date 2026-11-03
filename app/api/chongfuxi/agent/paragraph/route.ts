import { NextRequest, NextResponse } from "next/server";
import { agentGate } from "../../agent";
import { ParagraphError, paragraphMaterial, writeMuseParagraph } from "../../paragraph";
import { body } from "../../params";

export const dynamic = "force-dynamic";

/**
 * Write it in Chinese, written by the owner's agent (Muse; paragraph.ts).
 * Same token as agent/lists.
 *
 * GET: the material: { brief, day, written, left, trouble, mistakes, known, recent }.
 * POST { title, note?, sentences: [{ en, zh, note? }], targets: [{ word, en, why? }], model? }:
 *   kept as a paragraph by Muse; targets that don't hold are named back in "dropped".
 */
export async function GET(req: NextRequest) {
  const g = agentGate(req);
  if ("refused" in g) return g.refused;
  return NextResponse.json(await paragraphMaterial(g.sql, g.owner));
}

export async function POST(req: NextRequest) {
  const g = agentGate(req);
  if ("refused" in g) return g.refused;
  try {
    return NextResponse.json({ paragraph: await writeMuseParagraph(g.sql, g.owner, (await body<Record<string, unknown>>(req)) ?? {}) });
  } catch (e) {
    if (e instanceof ParagraphError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
