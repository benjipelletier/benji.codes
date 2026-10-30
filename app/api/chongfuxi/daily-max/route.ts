import { NextRequest, NextResponse } from "next/server";
import { ownerOnly } from "../guard";
import { bad, body } from "../params";
import { DAILY_MAX_TOP, setDailyMax } from "../review";
import type { DailyKind } from "@chongfuxi/lib/api";

export const dynamic = "force-dynamic";

/** { kind: read | recall | sentence, max: number | null }: the day's max of first-time cards of a kind (review.ts). Owner only. */
export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const input = await body<{ kind?: string; max?: number | null }>(req);
  const kind = input?.kind;
  if (kind !== "read" && kind !== "recall" && kind !== "sentence") return bad("kind is read, recall or sentence");
  const max = input?.max;
  if (max !== null && (typeof max !== "number" || !Number.isFinite(max) || max < 0 || max > DAILY_MAX_TOP)) return bad(`max is 0 to ${DAILY_MAX_TOP}, or null`);
  return NextResponse.json({ dailyMax: await setDailyMax(gate.sql, gate.owner, kind as DailyKind, max) });
}
