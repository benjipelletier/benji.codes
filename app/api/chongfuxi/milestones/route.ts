import { NextRequest, NextResponse } from "next/server";
import { ownerOnly } from "../guard";
import { milestones, seeMilestones } from "../milestones";
import { bad, body } from "../params";

export const dynamic = "force-dynamic";

/** What new words unlocked (milestones.ts), newest first; ?unseen=1 those not yet seen. Owner only. */
export async function GET(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  return NextResponse.json({ milestones: await milestones(gate.sql, gate.owner, req.nextUrl.searchParams.get("unseen") === "1") });
}

/** { seen: [ids] }: seen, so Today stops showing them. Owner only. */
export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const ids = (await body<{ seen?: unknown }>(req))?.seen;
  if (!Array.isArray(ids) || !ids.every((x) => Number.isInteger(x))) return bad("give { seen: [ids] }");
  await seeMilestones(gate.sql, gate.owner, ids as number[]);
  return NextResponse.json({ ok: true });
}
