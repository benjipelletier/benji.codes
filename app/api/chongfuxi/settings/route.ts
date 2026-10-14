import { NextRequest, NextResponse } from "next/server";
import { ownerOnly } from "../guard";
import { bad, body } from "../params";
import { setNewPerDay } from "../review";

export const dynamic = "force-dynamic";

/** How many sentences are introduced a day. */
export async function PUT(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const b = await body<{ newPerDay?: number }>(req);
  if (!b || !Number.isInteger(b.newPerDay) || b.newPerDay! < 0 || b.newPerDay! > 200) return bad("newPerDay must be 0 to 200");
  await setNewPerDay(gate.sql, gate.owner, b.newPerDay!);
  return NextResponse.json({ ok: true });
}
