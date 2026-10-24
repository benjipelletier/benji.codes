import { NextRequest, NextResponse } from "next/server";
import { AgentError, agentGate } from "../../../agent";
import { loadDict } from "../../../dictfile";
import { body } from "../../../params";
import { checkLink } from "../../../reading";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST { url }: how readable the page or video is for the owner now (reading.ts, Coverage). Same token as agent/lists. */
export async function POST(req: NextRequest) {
  const g = agentGate(req);
  if ("refused" in g) return g.refused;
  const input = await body<{ url?: unknown }>(req);
  if (typeof input?.url !== "string" || !input.url.trim()) return NextResponse.json({ error: "give { url }" }, { status: 400 });
  try {
    return NextResponse.json(await checkLink(g.sql, g.owner, loadDict(), input.url.trim()));
  } catch (e) {
    if (e instanceof AgentError) return NextResponse.json({ error: e.message }, { status: 422 });
    throw e;
  }
}
