import { NextRequest, NextResponse } from "next/server";
import { AgentError } from "../agent";
import { answerDrill, latestDrill } from "../drill";
import { ownerOnly, ownersLog } from "../guard";
import { bad, body } from "../params";

export const dynamic = "force-dynamic";

/** Muse's latest review (drill.ts), with how each card went. Readable by anyone. */
export async function GET() {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  return NextResponse.json({ drill: await latestDrill(gate.sql, gate.owner) });
}

/** { day, idx, grade: "got" | "missed", given? }: how a card went. Owner only. */
export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  try {
    await answerDrill(gate.sql, gate.owner, (await body<Record<string, unknown>>(req)) ?? {});
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AgentError) return bad(e.message);
    throw e;
  }
}
