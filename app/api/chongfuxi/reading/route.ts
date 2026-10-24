import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { loadDict } from "../dictfile";
import { ownerOnly, ownersLog } from "../guard";
import { bad, body } from "../params";
import { ReadingError, gradeRetell, listReadings, markReading, openReading } from "../reading";

export const dynamic = "force-dynamic";
// A page fetched and analysed, and a model call to grade a retelling.
export const maxDuration = 120;

/**
 * The week's readings Muse found, newest first (links only: readable by
 * anyone). With ?id=, that reading opened: its text fetched and marked
 * against the deck. Owner only, since the text isn't ours to serve.
 */
export async function GET(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!id) {
    const gate = ownersLog();
    if ("refused" in gate) return gate.refused;
    return NextResponse.json({ readings: await listReadings(gate.sql, gate.owner) });
  }
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  try {
    return NextResponse.json(await openReading(gate.sql, gate.owner, loadDict(), id));
  } catch (e) {
    if (e instanceof ReadingError) return bad(e.message, 422);
    throw e;
  }
}

/**
 * { id, tapped?, done? }: words tapped while reading, and read to the end.
 * { id, q, answer }: a retelling, graded by the model. Owner only.
 */
export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const input = (await body<{ id?: unknown; q?: unknown; answer?: unknown; tapped?: unknown; done?: unknown }>(req)) ?? {};
  const id = typeof input.id === "number" ? input.id : 0;
  if (!id) return bad("which reading?");
  try {
    if (typeof input.answer === "string") {
      if (typeof input.q !== "number") return bad("which question?");
      return NextResponse.json({ retell: await gradeRetell(gate.sql, gate.owner, loadDict(), id, input.q, input.answer) });
    }
    await markReading(gate.sql, gate.owner, id, input);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ReadingError) return bad(e.message, 422);
    if (e instanceof Anthropic.APIError) return bad(`The model call failed (${e.status ?? "no status"}): ${e.message}`, 502);
    throw e;
  }
}
