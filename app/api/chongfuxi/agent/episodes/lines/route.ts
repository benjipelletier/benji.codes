import { NextRequest, NextResponse } from "next/server";
import { agentGate } from "../../../agent";
import { EpisodeError, writeLineNotes } from "../../../episodes";
import { body } from "../../../params";

export const dynamic = "force-dynamic";

/**
 * POST { id, lines: [{ i, quote?, kind, text, words? }], replace? }: Muse's
 * notes on an episode's lines, like Genius annotations (episodes.ts). A
 * note replaces the one on its line. Same token as agent/lists.
 */
export async function POST(req: NextRequest) {
  const g = agentGate(req);
  if ("refused" in g) return g.refused;
  try {
    return NextResponse.json(await writeLineNotes(g.sql, g.owner, (await body<Record<string, unknown>>(req)) ?? {}));
  } catch (e) {
    if (e instanceof EpisodeError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
