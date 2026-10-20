import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { ownerOnly } from "../guard";
import { AdditionError } from "../additions";
import type { LookupFrom } from "@chongfuxi/lib/api";
import { LookupError, addFromLookup, judgeLookup, linkLookup, listLookups, lookUpPhrase } from "../lookup";
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
 * { q, add: word }: put one of its words in the deck (an addition, undone
 * through additions/[id]).
 * A lookup asked from a card carries `from` (LookupFrom), kept beside it once answered.
 */
export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const input = await body<{ q?: string; fresh?: boolean; verdict?: "right" | "wrong" | null; note?: string; add?: string; from?: LookupFrom }>(req);
  const q = input?.q?.trim();
  if (!q || q.length > 200) return bad("what do you want to say?");
  if (input && "verdict" in input) {
    const v = input.verdict;
    if (v !== "right" && v !== "wrong" && v !== null) return bad("verdict is right, wrong or null");
    await judgeLookup(gate.sql, gate.owner, q, v, input.note?.trim().slice(0, 500) || null);
    return NextResponse.json({ ok: true });
  }
  try {
    if (typeof input?.add === "string") {
      const added = await addFromLookup(gate.sql, gate.owner, q, input.add.trim());
      return NextResponse.json({ id: added?.id ?? null, added: added?.added ?? [], unlocked: added?.unlocked ?? 0 });
    }
    const answer = await lookUpPhrase(gate.sql, gate.owner, q, Boolean(input?.fresh));
    const from = fromCard(input?.from);
    if (from) await linkLookup(gate.sql, gate.owner, q, from);
    return NextResponse.json(answer);
  } catch (e) {
    if (e instanceof LookupError) return bad(e.message, 422);
    if (e instanceof AdditionError) return bad(e.message, 409);
    // Only the owner gets here, so the real reason is shown, not a bare 500.
    console.error("lookup failed", e);
    if (e instanceof Anthropic.APIError) {
      const detail = (e.error as { error?: { message?: string } } | undefined)?.error?.message ?? e.message;
      return bad(`The model call failed (${e.status ?? "no status"}): ${detail}`, 502);
    }
    return bad(`Look up failed: ${e instanceof Error ? e.message : String(e)}`, 500);
  }
}

/** A card a lookup was asked from, if `from` is one; anything else is left out. */
function fromCard(f: unknown): LookupFrom | null {
  if (!f || typeof f !== "object") return null;
  const x = f as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : null);
  if (!Number.isInteger(x.card) || !["read", "produce", "sentence"].includes(x.kind as string) || !["review", "learn"].includes(x.via as string)) {
    return null;
  }
  return {
    card: x.card as number,
    word: text(x.word, 40),
    kind: x.kind as LookupFrom["kind"],
    via: x.via as LookupFrom["via"],
    sentence: Number.isInteger(x.sentence) ? (x.sentence as number) : null,
    session: text(x.session, 100),
    step: text(x.step, 20),
  };
}
