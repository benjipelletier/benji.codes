import { NextRequest, NextResponse } from "next/server";
import { AgentError, agentGate } from "../../agent";
import { loadDict } from "../../dictfile";
import { body } from "../../params";
import { readingMaterial, writeReadings } from "../../reading";

export const dynamic = "force-dynamic";
// Each piece is fetched and measured as it is handed in.
export const maxDuration = 120;

/**
 * Native reading, found by the owner's agent (Muse). Same token as agent/lists.
 *
 * GET: what to pick by: { day, brief, target, focus, today, recent }.
 * POST { items: [{ url, why, questions: [{ zh, en }], title? }], day?, model? }:
 *   keep them as that day's reading. Answers { written, failed }.
 */
export async function GET(req: NextRequest) {
  const g = agentGate(req);
  if ("refused" in g) return g.refused;
  return NextResponse.json(await readingMaterial(g.sql, g.owner));
}

export async function POST(req: NextRequest) {
  const g = agentGate(req);
  if ("refused" in g) return g.refused;
  const input = await body<{ items?: unknown; day?: unknown; model?: unknown }>(req);
  try {
    return NextResponse.json(await writeReadings(g.sql, g.owner, loadDict(), input ?? {}));
  } catch (e) {
    if (e instanceof AgentError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
