import { NextRequest, NextResponse } from "next/server";
import { AgentError, agentGate } from "../../agent";
import { storyMaterial, writeDailyStory } from "../../daily";
import { body } from "../../params";

export const dynamic = "force-dynamic";

/**
 * The daily story, written by the owner's agent (Muse) each morning. Same
 * token as agent/lists.
 *
 * GET: the day's material: { day, targets: [{ word, pinyin, gloss, why }],
 *   known: [words], brief, written }.
 * POST { title, paragraphs: [{ zh, en }], day?, model? }: keep it as that
 *   day's story (today's by default; one already there is replaced).
 */
export async function GET(req: NextRequest) {
  const g = agentGate(req);
  if ("refused" in g) return g.refused;
  return NextResponse.json(await storyMaterial(g.sql, g.owner));
}

export async function POST(req: NextRequest) {
  const g = agentGate(req);
  if ("refused" in g) return g.refused;
  const input = await body<{ day?: unknown; title?: unknown; paragraphs?: unknown; model?: unknown }>(req);
  try {
    return NextResponse.json({ story: await writeDailyStory(g.sql, g.owner, input ?? {}) });
  } catch (e) {
    if (e instanceof AgentError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
