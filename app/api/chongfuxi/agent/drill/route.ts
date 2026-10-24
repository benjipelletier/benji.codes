import { NextRequest, NextResponse } from "next/server";
import { AgentError, agentGate } from "../../agent";
import { drillMaterial, writeDrill } from "../../drill";
import { body } from "../../params";

export const dynamic = "force-dynamic";

/**
 * Muse's review, written by the owner's agent from their problem areas. Same
 * token as agent/lists.
 *
 * GET: the material: { day, brief (the card shapes), written, stuck, notes,
 *   trips, lookups, attempts, last (the last review and how each card went),
 *   known }.
 * POST { title?, note?, cards: [...], day?, model? }: keep it as that day's
 *   review (today's by default; one already there is replaced). Answers
 *   { drill, dropped } (cards that weren't one of the shapes).
 */
export async function GET(req: NextRequest) {
  const g = agentGate(req);
  if ("refused" in g) return g.refused;
  return NextResponse.json(await drillMaterial(g.sql, g.owner));
}

export async function POST(req: NextRequest) {
  const g = agentGate(req);
  if ("refused" in g) return g.refused;
  const input = await body<{ day?: unknown; title?: unknown; note?: unknown; cards?: unknown; model?: unknown }>(req);
  try {
    return NextResponse.json(await writeDrill(g.sql, g.owner, input ?? {}));
  } catch (e) {
    if (e instanceof AgentError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
