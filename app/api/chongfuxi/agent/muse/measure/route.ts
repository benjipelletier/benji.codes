import { NextRequest, NextResponse } from "next/server";
import { AgentError, agentGate } from "../../../agent";
import { loadDict } from "../../../dictfile";
import { body } from "../../../params";
import { measure } from "../../../musepage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST { text } or { url }: how readable it is for the owner now; with a url, its text too (musepage.ts). Same token as agent/lists. */
export async function POST(req: NextRequest) {
  const g = agentGate(req);
  if ("refused" in g) return g.refused;
  try {
    return NextResponse.json(await measure(g.sql, g.owner, loadDict(), (await body<Record<string, unknown>>(req)) ?? {}));
  } catch (e) {
    if (e instanceof AgentError) return NextResponse.json({ error: e.message }, { status: 422 });
    throw e;
  }
}
