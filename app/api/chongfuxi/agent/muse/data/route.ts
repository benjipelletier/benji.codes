import { NextRequest, NextResponse } from "next/server";
import { AgentError, agentGate } from "../../../agent";
import { museData } from "../../../musepage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET ?what=stuck | words | log | week | lookups | known | sentences: Muse's data tools (musepage.ts). Same token as agent/lists. */
export async function GET(req: NextRequest) {
  const g = agentGate(req);
  if ("refused" in g) return g.refused;
  try {
    return NextResponse.json(await museData(g.sql, g.owner, req.nextUrl.searchParams));
  } catch (e) {
    if (e instanceof AgentError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
