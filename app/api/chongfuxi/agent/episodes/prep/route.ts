import { NextRequest, NextResponse } from "next/server";
import { AgentError, agentGate } from "../../../agent";
import { loadDict } from "../../../dictfile";
import { EpisodeError, writePrep } from "../../../episodes";
import { body } from "../../../params";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { id, words, names, scenes, questions, model? }: Muse's prep of an
 * episode (episodes.ts): the words ranked, the names, the scenes as
 * chapters, the questions. The must-know words are filed as the list
 * Muse/<show>/<episode>. Same token as agent/lists.
 */
export async function POST(req: NextRequest) {
  const g = agentGate(req);
  if ("refused" in g) return g.refused;
  try {
    return NextResponse.json(await writePrep(g.sql, g.owner, loadDict(), (await body<Record<string, unknown>>(req)) ?? {}));
  } catch (e) {
    if (e instanceof AgentError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof EpisodeError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
