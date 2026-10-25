import { NextRequest, NextResponse } from "next/server";
import { AgentError, agentGate } from "../../agent";
import { agentNotes, writeAnswers } from "../../notes";
import { body } from "../../params";

export const dynamic = "force-dynamic";

/**
 * The owner's notes after a Forgot, for the owner's agent (Muse) to answer.
 * Same token as agent/lists.
 *
 * GET: { brief, notes, left }: the unanswered notes, oldest first (?all=1
 *   for every note), each with the card's word, the sentence, what was
 *   written and the words it names, with their meanings.
 * POST { answers: [{ id, partner, difference, pair }], model? }: keep them
 *   (every answer is kept). Answers { saved, failed }.
 */
export async function GET(req: NextRequest) {
  const g = agentGate(req);
  if ("refused" in g) return g.refused;
  return NextResponse.json(await agentNotes(g.sql, g.owner, req.nextUrl.searchParams.get("all") === "1"));
}

export async function POST(req: NextRequest) {
  const g = agentGate(req);
  if ("refused" in g) return g.refused;
  const input = await body<{ answers?: unknown; model?: unknown }>(req);
  try {
    return NextResponse.json(await writeAnswers(g.sql, g.owner, input ?? {}));
  } catch (e) {
    if (e instanceof AgentError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
