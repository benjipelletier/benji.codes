import { NextRequest, NextResponse } from "next/server";
import { AgentError, agentGate } from "../../agent";
import { body } from "../../params";
import { weekMaterial, writeWeek } from "../../week";

export const dynamic = "force-dynamic";

/**
 * The weekly debrief, written by the owner's agent (Muse). Same token as
 * agent/lists.
 *
 * GET (?to=YYYY-MM-DD, the week's last study day; today's by default): the
 *   week's figures, counted by the app, the brief, and whether it is written.
 * POST { to?, title, sections: [{ kind, title, text, words }], focus, model? }:
 *   keep it as that week's debrief (one already there is replaced).
 */
export async function GET(req: NextRequest) {
  const g = agentGate(req);
  if ("refused" in g) return g.refused;
  return NextResponse.json(await weekMaterial(g.sql, g.owner, req.nextUrl.searchParams.get("to") ?? undefined));
}

export async function POST(req: NextRequest) {
  const g = agentGate(req);
  if ("refused" in g) return g.refused;
  try {
    return NextResponse.json({ week: await writeWeek(g.sql, g.owner, (await body<Record<string, unknown>>(req)) ?? {}) });
  } catch (e) {
    if (e instanceof AgentError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
