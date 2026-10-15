import { NextRequest, NextResponse } from "next/server";
import { ownerOnly } from "../guard";
import { LookupError, judgeLookup, listLookups, lookUpPhrase } from "../lookup";
import { bad, body } from "../params";

export const dynamic = "force-dynamic";
// A lookup is several model calls with the evidence in between.
export const maxDuration = 300;

/** Past lookups with their verdicts. Owner only, like every lookup. */
export async function GET() {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  return NextResponse.json({ lookups: await listLookups(gate.sql, gate.owner) });
}

/**
 * { q, fresh? }: look it up (the kept answer unless fresh).
 * { q, verdict: "right" | "wrong" | null, note? }: the owner's verdict on it.
 */
export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const input = await body<{ q?: string; fresh?: boolean; verdict?: "right" | "wrong" | null; note?: string }>(req);
  const q = input?.q?.trim();
  if (!q || q.length > 200) return bad("what do you want to say?");
  if (input && "verdict" in input) {
    const v = input.verdict;
    if (v !== "right" && v !== "wrong" && v !== null) return bad("verdict is right, wrong or null");
    await judgeLookup(gate.sql, gate.owner, q, v, input.note?.trim().slice(0, 500) || null);
    return NextResponse.json({ ok: true });
  }
  try {
    return NextResponse.json(await lookUpPhrase(gate.sql, gate.owner, q, Boolean(input?.fresh)));
  } catch (e) {
    if (e instanceof LookupError) return bad(e.message, 422);
    throw e;
  }
}
