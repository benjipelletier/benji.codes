import { NextRequest, NextResponse } from "next/server";
import { agentGate } from "../../../agent";
import { EpisodeError, writeBlurbs } from "../../../episodes";
import { body } from "../../../params";

export const dynamic = "force-dynamic";

/**
 * POST { id, blurbs: [{ i, meaning, literal?, parts?, tip? }], replace? }: Muse's
 * study notes on an episode's hard lines (episodes.ts), at the top of a
 * line when it is opened. One a line. Same token as agent/lists.
 */
export async function POST(req: NextRequest) {
  const g = agentGate(req);
  if ("refused" in g) return g.refused;
  try {
    return NextResponse.json(await writeBlurbs(g.sql, g.owner, (await body<Record<string, unknown>>(req)) ?? {}));
  } catch (e) {
    if (e instanceof EpisodeError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
