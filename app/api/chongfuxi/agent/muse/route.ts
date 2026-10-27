import { NextRequest, NextResponse } from "next/server";
import { AgentError, agentGate } from "../../agent";
import { body } from "../../params";
import { museMaterial, writePage } from "../../musepage";

export const dynamic = "force-dynamic";

/**
 * Muse's daily page, laid out by the owner's agent (musepage.ts). Same token as agent/lists.
 *
 * GET: the brief (the blocks and the data tools), the day, and the recent pages with everything done on them.
 * POST { title, note?, style?, blocks, day?, model? }: that day's page (one already there replaced).
 */
export async function GET(req: NextRequest) {
  const g = agentGate(req);
  if ("refused" in g) return g.refused;
  return NextResponse.json(await museMaterial(g.sql, g.owner));
}

export async function POST(req: NextRequest) {
  const g = agentGate(req);
  if ("refused" in g) return g.refused;
  try {
    return NextResponse.json(await writePage(g.sql, g.owner, (await body<Record<string, unknown>>(req)) ?? {}));
  } catch (e) {
    if (e instanceof AgentError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
